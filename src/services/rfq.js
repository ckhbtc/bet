import Decimal from 'decimal.js';
import {
  ChainGrpcAuthApi,
  CosmosTxV1Beta1TxPb,
  IndexerGrpcRfqGwApi,
  MsgExecuteContractCompat,
  PrivateKey,
  TxGrpcApi,
  base64ToUint8Array,
  createSignDoc,
  uint8ArrayToBase64,
  uint8ArrayToHex,
} from '@injectivelabs/sdk-ts';
import { MsgExec as AuthzMsgExecPb } from '@injectivelabs/core-proto-ts-v2/generated/cosmos/authz/v1beta1/tx_pb.js';
import { MsgExecuteContractCompat as WasmxMsgExecuteContractCompatPb } from '@injectivelabs/core-proto-ts-v2/generated/injective/wasmx/v1/tx_pb.js';
import { getNetworkEndpoints, Network } from '@injectivelabs/networks';
import {
  CreateRFQRequestType,
  TakerStreamResponse,
  TakerStreamStreamingRequest,
} from '../vendor/rfq/injective_rfq_rpc_pb.js';
import {
  RFQ_CHAIN_ID,
  RFQ_COLLECT_QUOTES_MS,
  RFQ_CONTRACT_ADDRESS,
  RFQ_EVM_CHAIN_ID,
  RFQ_GATEWAY_URL,
  RFQ_MIN_QUOTE_TTL_MS,
  RFQ_PREQUOTE_IDLE_DISCONNECT_MS,
  RFQ_PREPARE_MAX_ATTEMPTS,
  RFQ_PREPARE_RETRY_DELAY_MS,
  RFQ_RELAY_HEAD_START_MS,
  RFQ_REQUEST_TIMEOUT_MS,
  RFQ_WS_URL,
} from './rfqConstants.js';
import { AUTHZ_SCOPE_VERSION } from './authzMessages.js';
import {
  cleanupReduceOnlyOrdersForMarket,
  fetchOraclePriceForMarket,
  getMarket,
  requireSession,
} from './trade.js';
import {
  cancelActiveConditionalOrdersForMarket,
  submitTakeProfitIntent,
} from './rfqConditional.js';
import {
  DEFAULT_INITIAL_MARGIN_RATIO,
  assertOpenMarginAllowed,
  initialMarginCheckPrice,
} from './leverageLimits.js';

const GRPC_HEADER_SIZE = 5;
const GRPC_COMPRESSION_NONE = 0;
const GRPC_COMPRESSION_TRAILER = 128;
const MAX_QUOTES_PER_ACCEPT = 8;
const NETWORK = Network.MainnetSentry;
const RFQ_TIMING_PREFIX = '[RFQ-TIMING]';
const RFQ_ACCOUNT_DETAILS_TTL_MS = 5 * 60_000;
const endpoints = getNetworkEndpoints(NETWORK);
const authApi = new ChainGrpcAuthApi(endpoints.grpc);
const txApi = new TxGrpcApi(endpoints.grpc);
const rfqGatewayApi = new IndexerGrpcRfqGwApi(RFQ_GATEWAY_URL);
const textDecoder = new TextDecoder();
const rfqAccountDetailsCache = new Map();
let rfqPrequoteSocket = null;
let rfqPrequoteAddress = null;
let rfqPrequoteConnectPromise = null;
let rfqPrequoteIdleTimer = null;
let rfqPrequoteLastWarningAt = 0;

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rfq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timingNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function roundMs(value) {
  return Math.round(Number(value || 0));
}

function createRfqTiming(flow, details = {}) {
  const now = timingNow();
  return {
    id: randomId(),
    flow,
    startedAt: new Date().toISOString(),
    startMs: now,
    lastMs: now,
    details,
    marks: [],
  };
}

function compactQuoteExpiryReport(report) {
  if (!report) return null;
  return {
    ok: report.ok,
    inspected: report.inspected,
    quoteCount: report.quoteCount,
    timestampQuoteCount: report.timestampQuoteCount,
    shortestTtlMs: report.shortestTtlMs === null || report.shortestTtlMs === undefined
      ? null
      : roundMs(report.shortestTtlMs),
    minTtlMs: report.minTtlMs,
    unsafeQuotes: (report.unsafeQuotes || []).slice(0, 5).map((quote) => ({
      index: quote.index,
      maker: quote.maker ? `${quote.maker.slice(0, 10)}...${quote.maker.slice(-4)}` : '',
      price: quote.price,
      ttlMs: roundMs(quote.ttlMs),
      expiryMs: quote.expiryMs,
    })),
  };
}

function compactPrepared(prepared, nowMs = Date.now()) {
  if (!prepared) return null;
  const quotes = prepared.quotes || [];
  return {
    rfqId: prepared.rfqId ?? null,
    quoteCount: quotes.length,
    quotesWaitMs: prepared.quotesWaitMs ?? null,
    prices: quotes.slice(0, 5).map((quote) => quote.price),
    quoteTtlsMs: quotes.slice(0, 5).map((quote) => {
      const expiryMs = normalizeExpiryMs(quote.expiry?.timestamp);
      return expiryMs > 0 ? roundMs(expiryMs - nowMs) : null;
    }),
  };
}

function safeTimingDetails(details = {}) {
  const safe = { ...details };
  delete safe.privateKeyHex;
  delete safe.tx;
  delete safe.feePayerSig;
  return safe;
}

function markRfqTiming(timing, label, details = {}) {
  if (!timing) return null;
  const now = timingNow();
  const mark = {
    label,
    at: new Date().toISOString(),
    elapsedMs: roundMs(now - timing.startMs),
    deltaMs: roundMs(now - timing.lastMs),
    ...safeTimingDetails(details),
  };
  timing.lastMs = now;
  timing.marks.push(mark);
  console.info(`${RFQ_TIMING_PREFIX} ${timing.flow}.${label}`, {
    id: timing.id,
    flow: timing.flow,
    ...timing.details,
    ...mark,
  });
  return mark;
}

function postRfqTimingSummary(summary) {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify(summary);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/rfq-timing', blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }
  if (typeof fetch !== 'function') return;
  fetch('/api/rfq-timing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

function flushRfqTiming(timing, status, details = {}) {
  if (!timing || timing.flushed) return;
  timing.flushed = true;
  const summary = {
    id: timing.id,
    flow: timing.flow,
    status,
    startedAt: timing.startedAt,
    finishedAt: new Date().toISOString(),
    totalMs: roundMs(timingNow() - timing.startMs),
    ...timing.details,
    details: safeTimingDetails(details),
    marks: timing.marks,
  };
  console.info(`${RFQ_TIMING_PREFIX} ${timing.flow}.${status}`, summary);
  postRfqTimingSummary(summary);
}

function canonicalDecimal(value) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new Error(`Invalid decimal value: ${value}`);
  const fixed = decimal.toFixed();
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0';
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function base64ToHex(base64) {
  return uint8ArrayToHex(base64ToUint8Array(base64));
}

function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstSuccessful(promises) {
  return new Promise((resolve, reject) => {
    const errors = [];
    let pending = promises.length;
    if (pending === 0) {
      reject(new Error('No broadcast paths available'));
      return;
    }
    for (const promise of promises) {
      Promise.resolve(promise).then(resolve, (err) => {
        errors.push(err);
        pending -= 1;
        if (pending === 0) {
          reject(new Error(errors.map((error) => error?.message || String(error)).join('; ')));
        }
      });
    }
  });
}

function extractRawPubKeyBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  if (!bytes.length) return bytes;

  if (bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) return bytes;
  if (bytes[0] !== 0x0a) return bytes;

  let length = 0;
  let shift = 0;
  let offset = 1;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    length += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  if (length > 0 && offset + length <= bytes.length) {
    return bytes.slice(offset, offset + length);
  }
  return bytes;
}

function pubKeyBytesToBase64(value) {
  return bytesToBase64(extractRawPubKeyBytes(value));
}

function pubKeyInputToBase64(value) {
  if (!value) return '';
  if (value instanceof Uint8Array || Array.isArray(value)) return pubKeyBytesToBase64(value);

  const text = String(value).trim();
  const cleanHex = text.replace(/^0x/i, '');
  if (/^[0-9a-f]+$/i.test(cleanHex) && (cleanHex.length === 66 || cleanHex.length === 70)) {
    return pubKeyBytesToBase64(signatureHexToBytes(cleanHex));
  }

  try {
    return pubKeyBytesToBase64(base64ToUint8Array(text));
  } catch {
    return text;
  }
}

function getSignerPubKeyBase64(signerInfo) {
  const value = signerInfo?.publicKey?.value;
  return value?.length ? pubKeyBytesToBase64(value) : '';
}

async function fetchAccountDetailsNoThrow(address) {
  try {
    return await authApi.fetchAccount(address);
  } catch {
    return null;
  }
}

function accountCacheKey(address) {
  return String(address || '').toLowerCase();
}

function cloneAccountDetails(accountDetails) {
  if (!accountDetails) return null;
  return {
    ...accountDetails,
    baseAccount: accountDetails.baseAccount
      ? { ...accountDetails.baseAccount }
      : accountDetails.baseAccount,
  };
}

function rememberRfqAccountDetails(address, accountDetails) {
  const key = accountCacheKey(address);
  const account = accountDetails?.baseAccount;
  if (!key || !account) return;
  rfqAccountDetailsCache.set(key, {
    accountDetails: cloneAccountDetails(accountDetails),
    ts: Date.now(),
  });
}

function readCachedRfqAccountDetails(address) {
  const key = accountCacheKey(address);
  if (!key) return null;
  const cached = rfqAccountDetailsCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > RFQ_ACCOUNT_DETAILS_TTL_MS) {
    rfqAccountDetailsCache.delete(key);
    return null;
  }
  return cloneAccountDetails(cached.accountDetails);
}

function advanceCachedRfqAccountSequence(address) {
  const key = accountCacheKey(address);
  const cached = key ? rfqAccountDetailsCache.get(key) : null;
  const baseAccount = cached?.accountDetails?.baseAccount;
  const sequence = optionalNumber(baseAccount?.sequence);
  if (!baseAccount || sequence === undefined) return null;
  baseAccount.sequence = sequence + 1;
  cached.ts = Date.now();
  return baseAccount.sequence;
}

export function invalidateRfqAccountCache(address = null) {
  if (!address) {
    rfqAccountDetailsCache.clear();
    return;
  }
  rfqAccountDetailsCache.delete(accountCacheKey(address));
}

export async function primeRfqAccountCache(granterAddress) {
  const session = requireSession(granterAddress);
  const privateKey = PrivateKey.fromHex(session.privateKeyHex);
  const address = privateKey.toBech32();
  const cached = readCachedRfqAccountDetails(address);
  if (cached) return { accountDetails: cached, source: 'cache' };
  const accountDetails = await fetchAccountDetailsNoThrow(address);
  rememberRfqAccountDetails(address, accountDetails);
  return { accountDetails, source: 'network' };
}

async function getRfqAccountDetailsForPrepare(address) {
  const cached = readCachedRfqAccountDetails(address);
  if (cached) return { accountDetails: cached, source: 'cache' };
  const accountDetails = await fetchAccountDetailsNoThrow(address);
  rememberRfqAccountDetails(address, accountDetails);
  return { accountDetails, source: 'network' };
}

function marketHasTradingFields(market, marketId) {
  if (!market || String(market.marketId || '') !== String(marketId || '')) return false;
  return Boolean(market.minPriceTickSize && market.minQuantityTickSize && market.initialMarginRatio);
}

function normalizePositiveDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.gt(0) ? decimal : null;
  } catch {
    return null;
  }
}

async function resolveRfqMarket({ marketId, providedMarket = null, timing = null }) {
  if (marketHasTradingFields(providedMarket, marketId)) {
    markRfqTiming(timing, 'preflight.market.cached', {
      ticker: providedMarket.ticker ?? providedMarket.symbol ?? null,
    });
    return providedMarket;
  }

  const started = timingNow();
  markRfqTiming(timing, 'preflight.market.start');
  const market = await getMarket(marketId);
  markRfqTiming(timing, 'preflight.market.end', {
    source: 'network',
    marketMs: roundMs(timingNow() - started),
    ticker: market.ticker ?? market.symbol ?? null,
  });
  return market;
}

async function resolveRfqOraclePrice({
  market,
  providedOraclePrice = null,
  timing = null,
}) {
  const cachedPrice = normalizePositiveDecimal(providedOraclePrice);
  if (cachedPrice) {
    markRfqTiming(timing, 'preflight.oracle.cached', {
      oraclePrice: cachedPrice.toFixed(),
    });
    return cachedPrice;
  }

  const started = timingNow();
  markRfqTiming(timing, 'preflight.oracle.start');
  const oraclePrice = await fetchOraclePriceForMarket(market);
  markRfqTiming(timing, 'preflight.oracle.end', {
    source: 'network',
    oracleMs: roundMs(timingNow() - started),
    oraclePrice: oraclePrice.toFixed(),
  });
  return oraclePrice;
}

export function quantizeDecimal(value, tick, rounding = Decimal.ROUND_FLOOR) {
  const decimal = new Decimal(value);
  const minTick = new Decimal(tick || 0);
  if (!decimal.isFinite()) throw new Error(`Invalid decimal value: ${value}`);
  if (!minTick.isFinite() || minTick.lte(0)) return canonicalDecimal(decimal);
  return canonicalDecimal(decimal.div(minTick).toDecimalPlaces(0, rounding).mul(minTick));
}

function humanPriceTick(minPriceTickSize) {
  return new Decimal(minPriceTickSize || '1').div(1_000_000);
}

function encodeGrpcFrame(payload) {
  const frame = new Uint8Array(GRPC_HEADER_SIZE + payload.length);
  frame[0] = GRPC_COMPRESSION_NONE;
  new DataView(frame.buffer).setUint32(1, payload.length, false);
  frame.set(payload, GRPC_HEADER_SIZE);
  return frame;
}

function decodeGrpcFrame(bytes) {
  if (bytes.byteLength < GRPC_HEADER_SIZE) {
    throw new Error(`RFQ frame too short: ${bytes.byteLength} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressionFlag = view.getUint8(0);
  const isTrailer = (compressionFlag & GRPC_COMPRESSION_TRAILER) !== 0;
  const payloadLength = view.getUint32(1, false);
  const totalLength = GRPC_HEADER_SIZE + payloadLength;

  if (bytes.byteLength < totalLength) {
    throw new Error(`Incomplete RFQ frame: expected ${totalLength}, got ${bytes.byteLength}`);
  }

  const payload = bytes.subarray(GRPC_HEADER_SIZE, totalLength);
  if (isTrailer) return null;
  if (compressionFlag !== GRPC_COMPRESSION_NONE) {
    throw new Error(`Unsupported RFQ compression flag: ${compressionFlag}`);
  }

  return TakerStreamResponse.fromBinary(payload);
}

function encodeTakerPing() {
  const message = TakerStreamStreamingRequest.create({ messageType: 'ping' });
  return encodeGrpcFrame(TakerStreamStreamingRequest.toBinary(message));
}

function encodeTakerRequest(input) {
  const request = CreateRFQRequestType.create({
    clientId: input.clientId,
    marketId: input.marketId,
    direction: input.direction,
    margin: input.margin,
    quantity: input.quantity,
    worstPrice: input.worstPrice,
    expiry: BigInt(input.expiry || 0),
    priceCheck: input.priceCheck ?? true,
  });
  const message = TakerStreamStreamingRequest.create({
    messageType: 'request',
    request,
  });
  return encodeGrpcFrame(TakerStreamStreamingRequest.toBinary(message));
}

function wsUrlWithMetadata(requestAddress) {
  const url = `${RFQ_WS_URL.replace(/\/$/, '')}/injective_rfq_rpc.InjectiveRfqRPC/TakerStream`;
  const params = new URLSearchParams({
    request_address: requestAddress,
    subscribe_to_conditional_order_updates: 'true',
  });
  return `${url}?${params.toString()}`;
}

async function eventDataToBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error('Unsupported RFQ websocket payload');
}

function grpcQuoteToQuote(quote) {
  return {
    chainId: quote.chainId,
    contractAddress: quote.contractAddress,
    marketId: quote.marketId,
    rfqId: Number(quote.rfqId || 0n),
    takerDirection: quote.takerDirection,
    margin: quote.margin,
    quantity: quote.quantity,
    price: quote.price,
    expiry: quote.expiry
      ? {
        timestamp: Number(quote.expiry.timestamp || 0n),
        height: Number(quote.expiry.height || 0n),
      }
      : null,
    maker: quote.maker,
    taker: quote.taker,
    signature: quote.signature,
    status: quote.status,
    makerSubaccountNonce: Number(quote.makerSubaccountNonce || 0),
    minFillQuantity: quote.minFillQuantity,
    clientId: quote.clientId,
    signMode: quote.signMode,
    evmChainId: Number(quote.evmChainId || 0n),
  };
}

class RfqTakerSocket {
  constructor({ requestAddress, onResponse, onError }) {
    this.requestAddress = requestAddress;
    this.onResponse = onResponse;
    this.onError = onError;
    this.ws = null;
    this.pingTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket === 'undefined') {
        reject(new Error('RFQ requires a browser WebSocket environment'));
        return;
      }

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.disconnect();
        reject(new Error('RFQ websocket connection timed out'));
      }, 10_000);

      const ws = new WebSocket(wsUrlWithMetadata(this.requestAddress), 'grpc-ws');
      this.ws = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.startPing();
        resolve();
      };
      ws.onerror = () => {
        const err = new Error('RFQ websocket error');
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
          return;
        }
        this.onError?.(err);
      };
      ws.onclose = (event) => {
        const err = new Error(event.reason || `RFQ websocket closed (${event.code})`);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
          return;
        }
        if (event.code !== 1000) this.onError?.(err);
      };
      ws.onmessage = async (event) => {
        try {
          const bytes = await eventDataToBytes(event.data);
          const response = decodeGrpcFrame(bytes);
          if (response) this.onResponse?.(response);
        } catch (err) {
          this.onError?.(err);
        }
      };
    });
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.sendRaw(encodeTakerPing());
      } catch {
        this.stopPing();
      }
    }, 1_000);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  sendRaw(data) {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new Error('RFQ websocket is not connected');
    }
    this.ws.send(data);
  }

  sendRequest(input) {
    this.sendRaw(encodeTakerRequest(input));
  }

  disconnect() {
    this.stopPing();
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    this.ws.onmessage = null;
    if (this.ws.readyState === 0 || this.ws.readyState === 1) {
      this.ws.close(1000, 'done');
    }
    this.ws = null;
  }
}

function isQuoteWithinWorstPrice(quote, direction, worstPrice) {
  const quotePrice = new Decimal(quote.price);
  const worst = new Decimal(worstPrice);
  return direction === 'long' ? quotePrice.lte(worst) : quotePrice.gte(worst);
}

export function getRfqQuoteRejectReason(quote, { rfqId, marketId, direction, worstPrice }) {
  if (!quote) return 'quote missing';
  if (!quote.signature) return 'signature missing';
  if (!quote.maker) return 'maker missing';
  if (quote.chainId !== RFQ_CHAIN_ID) return `chain ${quote.chainId || '<empty>'} != ${RFQ_CHAIN_ID}`;
  if (quote.contractAddress !== RFQ_CONTRACT_ADDRESS) {
    return `contract ${quote.contractAddress || '<empty>'} != ${RFQ_CONTRACT_ADDRESS}`;
  }
  if (quote.marketId !== marketId) return `market ${quote.marketId || '<empty>'} != ${marketId}`;
  if (Number(quote.rfqId) !== Number(rfqId)) return `rfq ${quote.rfqId || '<empty>'} != ${rfqId}`;
  if (String(quote.takerDirection).toLowerCase() !== direction) {
    return `direction ${quote.takerDirection || '<empty>'} != ${direction}`;
  }
  if (!isQuoteWithinWorstPrice(quote, direction, worstPrice)) {
    return `price ${quote.price} outside worst ${worstPrice} for ${direction}`;
  }

  const expiresAtMs = Number(quote.expiry?.timestamp || 0);
  if (expiresAtMs > 0 && expiresAtMs <= Date.now() + 250) {
    return `expiry ${expiresAtMs} too close`;
  }

  return null;
}

export function isRfqQuoteUsable(quote, { rfqId, marketId, direction, worstPrice }) {
  return !getRfqQuoteRejectReason(quote, { rfqId, marketId, direction, worstPrice });
}

export function sortRfqQuotes(quotes, direction) {
  return [...quotes].sort((a, b) => {
    const diff = new Decimal(a.price).cmp(new Decimal(b.price));
    return direction === 'long' ? diff : -diff;
  });
}

export function selectRfqQuotesForAccept(quotes, request) {
  return sortRfqQuotes(
    quotes.filter(quote => isRfqQuoteUsable(quote, request)),
    request.direction
  ).slice(0, MAX_QUOTES_PER_ACCEPT);
}

export function buildRfqQuoteResult({
  clientId,
  ack,
  quotes,
  marketId,
  direction,
  worstPrice,
}) {
  const candidateRfqIds = [
    Number(ack?.rfqId || 0) > 0 ? Number(ack.rfqId) : null,
    ...quotes.map(quote => Number(quote.rfqId || 0)).filter(rfqId => rfqId > 0),
  ].filter((rfqId, index, list) => rfqId && list.indexOf(rfqId) === index);

  let rfqId = candidateRfqIds[0] ?? null;
  let selectedQuotes = [];

  for (const candidateRfqId of candidateRfqIds) {
    const candidateQuotes = selectRfqQuotesForAccept(
      quotes,
      { rfqId: candidateRfqId, marketId, direction, worstPrice }
    );
    if (candidateQuotes.length > 0 || !selectedQuotes.length) {
      rfqId = candidateRfqId;
      selectedQuotes = candidateQuotes;
    }
    if (candidateQuotes.length > 0) break;
  }

  const rejectionReasons = quotes
    .slice(0, 3)
    .map(quote => getRfqQuoteRejectReason(quote, { rfqId, marketId, direction, worstPrice }))
    .filter(Boolean);

  return {
    clientId,
    rfqId,
    ackRfqId: ack?.rfqId ?? null,
    status: ack?.status ?? null,
    rawQuoteCount: quotes.length,
    rejectionReasons,
    quotes: selectedQuotes,
  };
}

export async function requestRfqQuotes({
  requestAddress,
  marketId,
  direction,
  margin,
  quantity,
  worstPrice,
  collectMs = RFQ_COLLECT_QUOTES_MS,
  requestTimeoutMs = RFQ_REQUEST_TIMEOUT_MS,
  socketFactory = (args) => new RfqTakerSocket(args),
}) {
  const clientId = randomId();
  const quotes = [];
  let ack = null;
  let settleTimer = null;
  let timeoutTimer = null;
  let settled = false;
  let rejectPromise = null;
  let resolvePromise = null;
  let pendingError = null;
  let collectionStarted = false;

  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(settleTimer);
    clearTimeout(timeoutTimer);
    resolvePromise(buildRfqQuoteResult({
      clientId,
      ack,
      quotes,
      marketId,
      direction,
      worstPrice,
    }));
  };

  const rejectOnce = (err) => {
    if (settled) return;
    if (!rejectPromise) {
      pendingError = err;
      return;
    }
    settled = true;
    clearTimeout(settleTimer);
    clearTimeout(timeoutTimer);
    rejectPromise(err);
  };

  const startCollectionWindow = () => {
    if (settled) return;
    collectionStarted = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, collectMs);
  };

  const socket = socketFactory({
    requestAddress,
    onResponse: (response) => {
      if (settled) return;

      if (response.messageType === 'request_ack' && response.requestAck) {
        if (response.requestAck.clientId && response.requestAck.clientId !== clientId) return;
        ack = {
          clientId,
          rfqId: Number(response.requestAck.rfqId),
          status: response.requestAck.status,
        };
        const status = String(ack.status || '').toLowerCase();
        if (status.includes('reject') || status.includes('error')) {
          rejectOnce(new Error(`RFQ request rejected: ${ack.status}`));
          return;
        }
        startCollectionWindow();
      }

      if (response.messageType === 'quote' && response.quote) {
        const quote = grpcQuoteToQuote(response.quote);
        if (quote.marketId === marketId && String(quote.takerDirection).toLowerCase() === direction) {
          quotes.push(quote);
          if (!collectionStarted) startCollectionWindow();
        }
      }

      if (response.messageType === 'error' && response.error) {
        rejectOnce(new Error(`RFQ stream error: ${response.error.message || response.error.code}`));
      }
    },
    onError: rejectOnce,
  });

  try {
    await socket.connect();
    return await new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
      if (pendingError) {
        rejectOnce(pendingError);
        return;
      }
      timeoutTimer = setTimeout(() => {
        if (ack || quotes.length > 0) {
          settle();
          return;
        }
        rejectOnce(new Error('RFQ quote request timed out'));
      }, requestTimeoutMs);
      socket.sendRequest({
        clientId,
        marketId,
        direction,
        margin,
        quantity,
        worstPrice,
        expiry: 0,
        priceCheck: true,
      });
    });
  } finally {
    socket.disconnect();
  }
}

function warnRfqPrequote(err) {
  const now = Date.now();
  if (now - rfqPrequoteLastWarningAt < 10_000) return;
  rfqPrequoteLastWarningAt = now;
  console.warn('RFQ prequote stream issue:', err.message || err);
}

function scheduleRfqPrequoteIdleDisconnect() {
  clearTimeout(rfqPrequoteIdleTimer);
  rfqPrequoteIdleTimer = setTimeout(() => {
    disconnectRfqPrequoteSocket();
  }, RFQ_PREQUOTE_IDLE_DISCONNECT_MS);
}

export function disconnectRfqPrequoteSocket() {
  clearTimeout(rfqPrequoteIdleTimer);
  rfqPrequoteIdleTimer = null;
  rfqPrequoteConnectPromise = null;
  rfqPrequoteAddress = null;
  if (rfqPrequoteSocket) {
    rfqPrequoteSocket.disconnect();
    rfqPrequoteSocket = null;
  }
}

async function getRfqPrequoteSocket(requestAddress) {
  if (!requestAddress) throw new Error('RFQ prequote request address is required');
  if (rfqPrequoteSocket && rfqPrequoteAddress === requestAddress) {
    if (rfqPrequoteConnectPromise) await rfqPrequoteConnectPromise;
    return rfqPrequoteSocket;
  }

  disconnectRfqPrequoteSocket();
  const socket = new RfqTakerSocket({
    requestAddress,
    onResponse: (response) => {
      if (response.messageType === 'error' && response.error) {
        warnRfqPrequote(new Error(response.error.message || response.error.code || 'RFQ stream error'));
      }
    },
    onError: (err) => {
      warnRfqPrequote(err);
      if (rfqPrequoteSocket === socket) {
        rfqPrequoteSocket = null;
        rfqPrequoteConnectPromise = null;
        rfqPrequoteAddress = null;
      }
      socket.disconnect();
    },
  });

  rfqPrequoteSocket = socket;
  rfqPrequoteAddress = requestAddress;
  rfqPrequoteConnectPromise = socket.connect()
    .catch((err) => {
      if (rfqPrequoteSocket === socket) {
        rfqPrequoteSocket = null;
        rfqPrequoteAddress = null;
      }
      socket.disconnect();
      throw err;
    })
    .finally(() => {
      if (rfqPrequoteSocket === socket) {
        rfqPrequoteConnectPromise = null;
      }
    });

  await rfqPrequoteConnectPromise;
  return socket;
}

export async function sendRfqPrequoteRequest({
  requestAddress,
  marketId,
  direction,
  margin,
  quantity,
  worstPrice,
}) {
  const socket = await getRfqPrequoteSocket(requestAddress);
  const input = {
    clientId: randomId(),
    marketId,
    direction,
    margin: canonicalDecimal(margin),
    quantity: canonicalDecimal(quantity),
    worstPrice: canonicalDecimal(worstPrice),
    expiry: 0,
    priceCheck: true,
  };

  try {
    socket.sendRequest(input);
    scheduleRfqPrequoteIdleDisconnect();
    return { clientId: input.clientId };
  } catch (err) {
    disconnectRfqPrequoteSocket();
    throw err;
  }
}

export function signatureHexToBytes(signature) {
  const clean = String(signature || '').replace(/^0x/i, '');
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    return null;
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function signatureHexToBase64(signature) {
  const bytes = signatureHexToBytes(signature);
  if (!bytes) return signature;
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function normalizeRfqQuoteForContract(quote) {
  const expiry = Number(quote.expiry?.timestamp || 0) > 0
    ? { ts: Number(quote.expiry.timestamp) }
    : { h: Number(quote.expiry?.height || 0) };

  const normalized = {
    maker: quote.maker,
    margin: canonicalDecimal(quote.margin),
    price: canonicalDecimal(quote.price),
    quantity: canonicalDecimal(quote.quantity),
    expiry,
    signature: signatureHexToBase64(quote.signature),
    sign_mode: quote.signMode || 'v2',
    evm_chain_id: Number(quote.evmChainId || RFQ_EVM_CHAIN_ID),
    maker_subaccount_nonce: Number(quote.makerSubaccountNonce || 0),
  };

  if (quote.minFillQuantity && new Decimal(quote.minFillQuantity).gt(0)) {
    normalized.min_fill_quantity = canonicalDecimal(quote.minFillQuantity);
  }

  return normalized;
}

export function buildAcceptQuoteMessage({
  sender,
  rfqId,
  marketId,
  direction,
  margin,
  quantity,
  worstPrice,
  quotes,
  cid = randomId(),
}) {
  return MsgExecuteContractCompat.fromJSON({
    sender,
    contractAddress: RFQ_CONTRACT_ADDRESS,
    funds: [],
    msg: {
      accept_quote: {
        rfq_id: Number(rfqId),
        market_id: marketId,
        direction,
        margin: canonicalDecimal(margin),
        quantity: canonicalDecimal(quantity),
        worst_price: canonicalDecimal(worstPrice),
        quotes: quotes.map(normalizeRfqQuoteForContract),
        unfilled_action: null,
        cid,
      },
    },
  });
}

function normalizeExpiryMs(value) {
  const expiry = Number(value || 0);
  if (!Number.isFinite(expiry) || expiry <= 0) return 0;
  return expiry < 10_000_000_000 ? expiry * 1000 : expiry;
}

function decodeExecuteContractCompatMsg(anyMessage) {
  const typeUrl = String(anyMessage?.typeUrl || '');
  if (!typeUrl.endsWith('injective.wasmx.v1.MsgExecuteContractCompat')) return null;
  const execute = WasmxMsgExecuteContractCompatPb.fromBinary(anyMessage.value);
  if (!execute?.msg?.length) return null;
  const message = typeof execute.msg === 'string'
    ? execute.msg
    : textDecoder.decode(execute.msg);
  return JSON.parse(message);
}

function extractAcceptQuoteMessagesFromAny(anyMessage) {
  const typeUrl = String(anyMessage?.typeUrl || '');
  if (typeUrl.endsWith('cosmos.authz.v1beta1.MsgExec')) {
    const exec = AuthzMsgExecPb.fromBinary(anyMessage.value);
    return (exec.msgs || []).flatMap(extractAcceptQuoteMessagesFromAny);
  }

  const msg = decodeExecuteContractCompatMsg(anyMessage);
  if (msg?.accept_quote) return [msg.accept_quote];
  return [];
}

export function extractPreparedAcceptQuoteMessages(txBytes) {
  const txRaw = CosmosTxV1Beta1TxPb.TxRaw.fromBinary(txBytes);
  const txBody = CosmosTxV1Beta1TxPb.TxBody.fromBinary(txRaw.bodyBytes);
  return (txBody.messages || []).flatMap(extractAcceptQuoteMessagesFromAny);
}

export function getPreparedQuoteExpiryReport(prepared, {
  nowMs = Date.now(),
  minTtlMs = RFQ_MIN_QUOTE_TTL_MS,
} = {}) {
  let acceptQuotes = [];
  try {
    acceptQuotes = extractPreparedAcceptQuoteMessages(prepared.tx);
  } catch (err) {
    return {
      ok: false,
      inspected: false,
      decodeError: err.message,
      quoteCount: 0,
      timestampQuoteCount: 0,
      unsafeQuotes: [],
      minTtlMs,
    };
  }

  const quotes = acceptQuotes.flatMap((message) => message.quotes || []);
  const timestampQuotes = quotes
    .map((quote, index) => ({
      index,
      maker: quote.maker || '',
      price: quote.price || '',
      expiryMs: normalizeExpiryMs(quote.expiry?.ts ?? quote.expiry?.timestamp),
    }))
    .filter((quote) => quote.expiryMs > 0)
    .map((quote) => ({
      ...quote,
      ttlMs: quote.expiryMs - nowMs,
    }));
  const unsafeQuotes = timestampQuotes.filter((quote) => quote.ttlMs < minTtlMs);
  const shortestTtlMs = timestampQuotes.length
    ? Math.min(...timestampQuotes.map((quote) => quote.ttlMs))
    : null;

  return {
    ok: unsafeQuotes.length === 0,
    inspected: true,
    quoteCount: quotes.length,
    timestampQuoteCount: timestampQuotes.length,
    unsafeQuotes,
    shortestTtlMs,
    minTtlMs,
  };
}

export function assertPreparedQuoteFreshness(prepared, options) {
  const report = getPreparedQuoteExpiryReport(prepared, options);
  if (!report.inspected) {
    throw new Error(`RFQ settlement tx could not be inspected for quote expiry: ${report.decodeError}`);
  }
  if (!report.ok) {
    const ttl = Math.max(0, Math.round(report.shortestTtlMs ?? 0));
    throw new Error(`RFQ quotes expire too soon (${ttl}ms left; need ${report.minTtlMs}ms). Try again.`);
  }
  return report;
}

export function buildRfqGatewayPrepareRequest({
  session,
  input,
  marketId,
  clientId = randomId(),
  cid = randomId(),
  accountDetails = null,
  quotesWaitTimeMs = RFQ_COLLECT_QUOTES_MS,
}) {
  const privateKey = PrivateKey.fromHex(session.privateKeyHex);
  const account = accountDetails?.baseAccount ?? null;
  const autosignAccountNumber = optionalNumber(account?.accountNumber);
  const autosignAccountSequence = optionalNumber(account?.sequence);

  const request = {
    cid,
    clientId,
    marketId,
    direction: input.direction,
    margin: canonicalDecimal(input.margin),
    quantity: canonicalDecimal(input.quantity),
    worstPrice: canonicalDecimal(input.worstPrice),
    takerAddress: session.granterAddress,
    autosignAddress: session.granteeAddress,
    autosignPubKey: base64ToHex(privateKey.toPublicKey().toBase64()),
    quotesWaitTimeMs,
  };

  if (autosignAccountNumber !== undefined) {
    request.autosignAccountNumber = autosignAccountNumber;
  }
  if (autosignAccountSequence !== undefined) {
    request.autosignAccountSequence = autosignAccountSequence;
  }

  return request;
}

export function getPreparedTxSignatureIndexes(txRaw, {
  autosignPubKeyBase64,
  feePayerPubKeyBase64,
}) {
  const authInfo = CosmosTxV1Beta1TxPb.AuthInfo.fromBinary(txRaw.authInfoBytes);
  const signerInfos = authInfo.signerInfos || [];
  if (!signerInfos.length) {
    throw new Error('RFQ gateway prepared a transaction without signer info');
  }

  const autosignPubKey = pubKeyInputToBase64(autosignPubKeyBase64);
  const feePayerPubKey = pubKeyInputToBase64(feePayerPubKeyBase64);
  const autosignIndex = signerInfos.findIndex((signerInfo) => (
    getSignerPubKeyBase64(signerInfo) === autosignPubKey
  ));
  let feePayerIndex = signerInfos.findIndex((signerInfo) => (
    feePayerPubKey && getSignerPubKeyBase64(signerInfo) === feePayerPubKey
  ));

  if (autosignIndex < 0) {
    throw new Error('RFQ gateway prepared a transaction without the autosign signer');
  }

  if (feePayerIndex < 0) {
    feePayerIndex = signerInfos.findIndex((_, index) => index !== autosignIndex);
  }
  if (feePayerIndex < 0) {
    throw new Error('RFQ gateway prepared a transaction without the fee payer signer');
  }
  if (feePayerIndex === autosignIndex && signerInfos.length > 1) {
    throw new Error('RFQ gateway prepared ambiguous signer indexes');
  }

  return {
    autosignIndex,
    feePayerIndex,
    signerCount: signerInfos.length,
  };
}

export async function signPreparedAutoSignTxRaw({
  tx,
  feePayerSig,
  privateKeyHex,
  accountNumber,
  chainId = RFQ_CHAIN_ID,
  feePayerPubKey = null,
}) {
  const privateKey = PrivateKey.fromHex(privateKeyHex);
  const txRaw = CosmosTxV1Beta1TxPb.TxRaw.fromBinary(tx);
  const signDoc = createSignDoc({
    bodyBytes: txRaw.bodyBytes,
    authInfoBytes: txRaw.authInfoBytes,
    chainId,
    accountNumber,
  });
  const autosignSignature = await privateKey.sign(CosmosTxV1Beta1TxPb.SignDoc.toBinary(signDoc));
  const feePayerSignature = signatureHexToBytes(feePayerSig);

  if (!feePayerSignature) {
    throw new Error('RFQ gateway returned an invalid fee payer signature');
  }

  const { autosignIndex, feePayerIndex, signerCount } = getPreparedTxSignatureIndexes(txRaw, {
    autosignPubKeyBase64: privateKey.toPublicKey().toBase64(),
    feePayerPubKeyBase64: feePayerPubKey?.key ?? '',
  });
  const signatures = Array.from({ length: Math.max(signerCount, autosignIndex + 1, feePayerIndex + 1) }, () => new Uint8Array(0));
  signatures[autosignIndex] = autosignSignature;
  signatures[feePayerIndex] = feePayerSignature;
  txRaw.signatures = signatures;

  return txRaw;
}

export async function relaySignedRfqTxRaw(txRaw) {
  if (typeof fetch !== 'function') throw new Error('RFQ relay unavailable');
  const txBytes = uint8ArrayToBase64(CosmosTxV1Beta1TxPb.TxRaw.toBinary(txRaw));
  const started = timingNow();
  const response = await fetch('/api/rfq-broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txBytes }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok || !body.txHash) {
    throw new Error(body?.error || `RFQ relay broadcast failed (${response.status})`);
  }
  return {
    txHash: body.txHash,
    relayMs: Number.isFinite(Number(body.relayMs)) ? Number(body.relayMs) : null,
    clientRelayMs: roundMs(timingNow() - started),
    duplicate: Boolean(body.duplicate),
  };
}

function directBroadcastSignedRfqTxRaw({ txRaw, txApiClient, timing = null }) {
  return new Promise((resolve, reject) => {
    const started = timingNow();
    markRfqTiming(timing, 'broadcast.direct.start');
    txApiClient.broadcast(txRaw, {
      onBroadcast: (txHash) => {
        resolve({
          txHash,
          confirmed: false,
          broadcastPath: 'direct',
          ackMs: roundMs(timingNow() - started),
        });
      },
    }).then((response) => {
      resolve({
        txHash: response.txHash,
        txResponse: response,
        confirmed: true,
        broadcastPath: 'direct',
        ackMs: roundMs(timingNow() - started),
      });
    }, (err) => {
      markRfqTiming(timing, 'broadcast.direct.error', { message: err.message });
      reject(err);
    });
  });
}

export async function broadcastSignedRfqTxRaw({
  txRaw,
  txApiClient = txApi,
  relayBroadcast = relaySignedRfqTxRaw,
  timing = null,
  relayHeadStartMs = RFQ_RELAY_HEAD_START_MS,
}) {
  markRfqTiming(timing, 'broadcast.start');
  const attempts = [];
  let broadcastAccepted = false;

  if (relayBroadcast) {
    const relayStarted = timingNow();
    markRfqTiming(timing, 'broadcast.relay.start');
    const relayAttempt = relayBroadcast(txRaw).then((response) => ({
      ...response,
      confirmed: false,
      broadcastPath: 'relay',
      ackMs: roundMs(timingNow() - relayStarted),
    }), (err) => {
      markRfqTiming(timing, 'broadcast.relay.error', { message: err.message });
      throw err;
    });
    attempts.push(
      relayAttempt.then((response) => {
        broadcastAccepted = true;
        return response;
      })
    );

    const directTrigger = relayHeadStartMs > 0
      ? Promise.race([
        sleep(relayHeadStartMs),
        relayAttempt.catch(() => null),
      ])
      : Promise.resolve();
    attempts.push(
      directTrigger
        .then(() => {
          if (broadcastAccepted) return new Promise(() => {});
          return directBroadcastSignedRfqTxRaw({ txRaw, txApiClient, timing });
        })
        .then((response) => {
          broadcastAccepted = true;
          return response;
        })
    );
  } else {
    attempts.push(
      directBroadcastSignedRfqTxRaw({ txRaw, txApiClient, timing }).then((response) => {
        broadcastAccepted = true;
        return response;
      })
    );
  }

  const accepted = await firstSuccessful(attempts);
  markRfqTiming(timing, 'broadcast.accepted', {
    path: accepted.broadcastPath || 'unknown',
    txHash: accepted.txHash,
    ackMs: accepted.ackMs ?? null,
    relayMs: accepted.relayMs ?? null,
    clientRelayMs: accepted.clientRelayMs ?? null,
    duplicate: Boolean(accepted.duplicate),
  });
  if (accepted.confirmed) {
    markRfqTiming(timing, 'confirm.already_confirmed', {
      path: accepted.broadcastPath || 'unknown',
      txHash: accepted.txHash,
    });
    return {
      txHash: accepted.txHash,
      txResponse: accepted.txResponse,
      broadcastPath: accepted.broadcastPath || 'unknown',
      ackMs: accepted.ackMs ?? null,
      relayMs: accepted.relayMs ?? null,
    };
  }

  const pollStarted = timingNow();
  markRfqTiming(timing, 'confirm.poll.start', { txHash: accepted.txHash });
  const txResponse = await txApiClient.fetchTxPoll(accepted.txHash);
  markRfqTiming(timing, 'confirm.poll.end', {
    txHash: txResponse.txHash || accepted.txHash,
    pollMs: roundMs(timingNow() - pollStarted),
    height: txResponse.height ?? null,
    code: txResponse.code ?? null,
  });
  return {
    txHash: txResponse.txHash || accepted.txHash,
    txResponse,
    broadcastPath: accepted.broadcastPath || 'unknown',
    ackMs: accepted.ackMs ?? null,
    relayMs: accepted.relayMs ?? null,
    clientRelayMs: accepted.clientRelayMs ?? null,
  };
}

export async function broadcastPreparedRfqAutoSign({
  prepared,
  session,
  txApiClient = txApi,
  relayBroadcast = relaySignedRfqTxRaw,
  timing = null,
}) {
  const signStarted = timingNow();
  markRfqTiming(timing, 'sign.start');
  const txRaw = await signPreparedAutoSignTxRaw({
    tx: prepared.tx,
    feePayerSig: prepared.feePayerSig,
    privateKeyHex: session.privateKeyHex,
    accountNumber: prepared.autosignAccountNumber,
    feePayerPubKey: prepared.feePayerPubKey,
  });
  markRfqTiming(timing, 'sign.end', {
    signMs: roundMs(timingNow() - signStarted),
    txBytes: CosmosTxV1Beta1TxPb.TxRaw.toBinary(txRaw).length,
  });

  const response = await broadcastSignedRfqTxRaw({
    txRaw,
    txApiClient,
    relayBroadcast,
    timing,
  });
  return {
    txHash: response.txHash,
    broadcastPath: response.broadcastPath,
    ackMs: response.ackMs,
    relayMs: response.relayMs,
    clientRelayMs: response.clientRelayMs,
  };
}

export async function executeRfqGatewayAutoSign({
  session,
  marketId,
  input,
  onProgress = null,
  gatewayApi = rfqGatewayApi,
  txApiClient = txApi,
  relayBroadcast = relaySignedRfqTxRaw,
  minQuoteTtlMs = RFQ_MIN_QUOTE_TTL_MS,
  maxPrepareAttempts = RFQ_PREPARE_MAX_ATTEMPTS,
  timing = null,
}) {
  const activeTiming = timing || createRfqTiming('rfq-execute', {
    marketId,
    direction: input.direction,
  });
  const ownsTiming = !timing;

  try {
    const privateKey = PrivateKey.fromHex(session.privateKeyHex);
    const autosignAddress = privateKey.toBech32();
    markRfqTiming(activeTiming, 'account.fetch.start', {
      autosignAddress,
    });
    const accountLookup = await getRfqAccountDetailsForPrepare(autosignAddress);
    const accountDetails = accountLookup.accountDetails;
    markRfqTiming(activeTiming, 'account.fetch.end', {
      source: accountLookup.source,
      accountFound: Boolean(accountDetails?.baseAccount),
      sequence: accountDetails?.baseAccount?.sequence ?? null,
    });
    const request = buildRfqGatewayPrepareRequest({
      session,
      input,
      marketId,
      accountDetails,
    });
    markRfqTiming(activeTiming, 'prepare.request.ready', {
      quotesWaitTimeMs: request.quotesWaitTimeMs,
      quantity: request.quantity,
      margin: request.margin,
      worstPrice: request.worstPrice,
    });

    let prepared = null;
    let lastFreshnessError = null;
    for (let attempt = 1; attempt <= maxPrepareAttempts; attempt += 1) {
      const prepareStarted = timingNow();
      markRfqTiming(activeTiming, 'prepare.start', { attempt });
      prepared = await gatewayApi.fetchPrepareAutoSign(request);
      const expiryReport = prepared?.tx?.length
        ? getPreparedQuoteExpiryReport(prepared, { minTtlMs: minQuoteTtlMs })
        : null;
      markRfqTiming(activeTiming, 'prepare.end', {
        attempt,
        prepareMs: roundMs(timingNow() - prepareStarted),
        prepared: compactPrepared(prepared),
        expiry: compactQuoteExpiryReport(expiryReport),
      });

      if (!prepared?.tx?.length) {
        throw new Error('RFQ gateway did not return a prepared settlement transaction');
      }
      if (!prepared.quotes?.length) {
        throw new Error('No executable RFQ quote returned. RFQ gateway selected 0 quote(s).');
      }

      try {
        assertPreparedQuoteFreshness(prepared, { minTtlMs: minQuoteTtlMs });
        lastFreshnessError = null;
        break;
      } catch (err) {
        lastFreshnessError = err;
        markRfqTiming(activeTiming, 'prepare.freshness_retry', {
          attempt,
          message: err.message,
        });
        prepared = null;
        if (attempt < maxPrepareAttempts) {
          await sleep(RFQ_PREPARE_RETRY_DELAY_MS);
        }
      }
    }

    if (!prepared) {
      throw lastFreshnessError || new Error('RFQ gateway did not return a fresh settlement transaction');
    }
    markRfqTiming(activeTiming, 'matched', {
      prepared: compactPrepared(prepared),
    });
    onProgress?.({ phase: 'matched', prepared });

    const result = await broadcastPreparedRfqAutoSign({
      prepared,
      session,
      txApiClient,
      relayBroadcast,
      timing: activeTiming,
    });
    markRfqTiming(activeTiming, 'confirmed', {
      txHash: result.txHash,
      broadcastPath: result.broadcastPath ?? null,
    });
    const nextSequence = advanceCachedRfqAccountSequence(autosignAddress);
    if (nextSequence !== null) {
      markRfqTiming(activeTiming, 'account.cache.advance', {
        sequence: nextSequence,
      });
    }
    onProgress?.({ phase: 'confirmed', prepared, result });

    if (ownsTiming) {
      flushRfqTiming(activeTiming, 'success', {
        txHash: result.txHash,
        prepared: compactPrepared(prepared),
        broadcastPath: result.broadcastPath ?? null,
      });
    }

    return {
      ...result,
      prepared,
    };
  } catch (err) {
    markRfqTiming(activeTiming, 'error', { message: err.message });
    try {
      const privateKey = PrivateKey.fromHex(session.privateKeyHex);
      invalidateRfqAccountCache(privateKey.toBech32());
    } catch {
      // best effort only
    }
    if (ownsTiming) {
      flushRfqTiming(activeTiming, 'error', { message: err.message });
    }
    throw err;
  }
}

export function buildRfqOrderInput({ market, oraclePrice, side, stakeUsdt, leverage, slippage = 0.01 }) {
  const isLong = side === 'long';
  const stake = new Decimal(stakeUsdt);
  const lev = new Decimal(leverage);
  const price = new Decimal(oraclePrice);

  const worstRaw = price.mul(isLong ? new Decimal(1).plus(slippage) : new Decimal(1).minus(slippage));
  const worstPrice = quantizeDecimal(
    worstRaw,
    humanPriceTick(market.minPriceTickSize),
    isLong ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR
  );
  const requestedQuantity = stake.mul(lev).div(price);
  const marginCheckPrice = initialMarginCheckPrice({
    oraclePrice: price,
    worstPrice,
    side,
    slippage,
  });
  const imr = new Decimal(market?.initialMarginRatio ?? DEFAULT_INITIAL_MARGIN_RATIO);
  const maxQuantityByMargin = imr.isFinite() && imr.gt(0)
    ? stake.div(marginCheckPrice.mul(imr))
    : requestedQuantity;
  const quantity = quantizeDecimal(
    Decimal.min(requestedQuantity, maxQuantityByMargin),
    market.minQuantityTickSize,
    Decimal.ROUND_FLOOR
  );
  if (new Decimal(quantity).lte(0)) throw new Error('Quantity rounds to zero - try a larger size');

  assertOpenMarginAllowed({
    market,
    stake,
    quantity,
    oraclePrice: price,
    worstPrice,
    side,
    slippage,
  });

  return {
    direction: isLong ? 'long' : 'short',
    margin: canonicalDecimal(stake),
    quantity,
    worstPrice,
  };
}

export function buildRfqCloseInput({ market, oraclePrice, side, quantity, slippage = 0.02 }) {
  const direction = side === 'long' ? 'short' : 'long';
  const price = new Decimal(oraclePrice);
  const closeQty = quantizeDecimal(
    quantity,
    market.minQuantityTickSize,
    Decimal.ROUND_FLOOR
  );
  if (new Decimal(closeQty).lte(0)) throw new Error('Quantity rounds to zero - try a larger size');

  const worstRaw = direction === 'long'
    ? price.mul(new Decimal(1).plus(slippage))
    : price.mul(new Decimal(1).minus(slippage));
  const worstPrice = quantizeDecimal(
    worstRaw,
    humanPriceTick(market.minPriceTickSize),
    direction === 'long' ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR
  );

  return {
    direction,
    margin: '0',
    quantity: closeQty,
    worstPrice,
  };
}

export async function tradeOpenRfq({
  granterAddress,
  marketId,
  side,
  stakeUsdt,
  leverage,
  slippage = 0.01,
  tpPrice = null,
  market: providedMarket = null,
  oraclePrice: providedOraclePrice = null,
  onProgress = null,
}) {
  const timing = createRfqTiming('rfq-open', {
    marketId,
    side,
  });
  const session = requireSession(granterAddress);
  if (Number(session.scopeVersion || 1) < AUTHZ_SCOPE_VERSION) {
    flushRfqTiming(timing, 'error', { message: 'AuthZ scope upgrade required' });
    throw new Error('Trading needs updated autosign permissions. Revoke autosign, then authorize again.');
  }

  try {
    const market = await resolveRfqMarket({
      marketId,
      providedMarket,
      timing,
    });
    const oraclePrice = await resolveRfqOraclePrice({
      market,
      providedOraclePrice,
      timing,
    });
    const input = buildRfqOrderInput({ market, oraclePrice, side, stakeUsdt, leverage, slippage });
    const marginCheckPrice = initialMarginCheckPrice({
      oraclePrice,
      worstPrice: input.worstPrice,
      side,
      slippage,
    });
    const marginCheckNotional = new Decimal(input.quantity).mul(marginCheckPrice);
    const imr = new Decimal(market?.initialMarginRatio ?? DEFAULT_INITIAL_MARGIN_RATIO);
    markRfqTiming(timing, 'input.ready', {
      direction: input.direction,
      quantity: input.quantity,
      margin: input.margin,
      worstPrice: input.worstPrice,
      requestedLeverage: String(leverage),
      initialMarginRatio: market.initialMarginRatio ?? null,
      initialMarginCheckPrice: canonicalDecimal(marginCheckPrice),
      initialMarginCheckNotional: canonicalDecimal(marginCheckNotional),
      requiredInitialMargin: imr.isFinite() && imr.gt(0)
        ? canonicalDecimal(marginCheckNotional.mul(imr))
        : null,
    });

    const openResult = await executeRfqGatewayAutoSign({
      session,
      marketId: market.marketId,
      input,
      onProgress,
      timing,
    });

    let takeProfit = tpPrice && Number(tpPrice) > 0
      ? { requested: true, placed: false, error: null }
      : { requested: false, placed: false, error: null };

    if (tpPrice && Number(tpPrice) > 0) {
      const tpStarted = timingNow();
      markRfqTiming(timing, 'take_profit.start', { triggerPrice: tpPrice });
      try {
        const tpResult = await submitTakeProfitIntent({
          session,
          market,
          side,
          quantity: input.quantity,
          triggerPrice: tpPrice,
        });
        takeProfit = tpResult;
        markRfqTiming(timing, 'take_profit.end', {
          tpMs: roundMs(timingNow() - tpStarted),
          placed: Boolean(tpResult?.placed),
          verified: Boolean(tpResult?.verified),
          status: tpResult?.status ?? null,
          rfqId: tpResult?.rfqId ?? null,
          verificationError: tpResult?.verificationError ?? null,
        });
      } catch (err) {
        console.warn('RFQ conditional TP placement failed (open succeeded):', err.message);
        markRfqTiming(timing, 'take_profit.error', { message: err.message });
        takeProfit = {
          requested: true,
          placed: false,
          error: err.message || 'Take-profit intent failed',
        };
      }
    }

    flushRfqTiming(timing, 'success', {
      txHash: openResult.txHash,
      prepared: compactPrepared(openResult.prepared),
      takeProfit,
    });

    return {
      ...openResult,
      takeProfit,
      rfq: {
        rfqId: openResult.prepared.rfqId,
        quotesAccepted: openResult.prepared.quotes?.length ?? 0,
        bestPrice: openResult.prepared.quotes?.[0]?.price ?? null,
        quotesWaitMs: openResult.prepared.quotesWaitMs,
      },
    };
  } catch (err) {
    flushRfqTiming(timing, 'error', { message: err.message });
    throw err;
  }
}

export async function tradeCloseRfq({
  granterAddress,
  marketId,
  side,
  quantity,
  slippage = 0.02,
  market: providedMarket = null,
  oraclePrice: providedOraclePrice = null,
  onProgress = null,
}) {
  const timing = createRfqTiming('rfq-cash-out', {
    marketId,
    side,
  });
  const session = requireSession(granterAddress);
  if (Number(session.scopeVersion || 1) < AUTHZ_SCOPE_VERSION) {
    flushRfqTiming(timing, 'error', { message: 'AuthZ scope upgrade required' });
    throw new Error('Trading needs updated autosign permissions. Revoke autosign, then authorize again.');
  }

  try {
    const market = await resolveRfqMarket({
      marketId,
      providedMarket,
      timing,
    });
    const oraclePrice = await resolveRfqOraclePrice({
      market,
      providedOraclePrice,
      timing,
    });
    const input = buildRfqCloseInput({ market, oraclePrice, side, quantity, slippage });
    markRfqTiming(timing, 'input.ready', {
      direction: input.direction,
      quantity: input.quantity,
      margin: input.margin,
      worstPrice: input.worstPrice,
    });
    const closeResult = await executeRfqGatewayAutoSign({
      session,
      marketId: market.marketId,
      input,
      onProgress,
      timing,
    });
    try {
      const cleanupStarted = timingNow();
      markRfqTiming(timing, 'cleanup.reduce_only.start');
      const cleanupResult = await cleanupReduceOnlyOrdersForMarket({ session, market });
      if (Number(cleanupResult?.cancelled || 0) > 0) {
        const nextSequence = advanceCachedRfqAccountSequence(session.granteeAddress);
        if (nextSequence !== null) {
          markRfqTiming(timing, 'account.cache.advance', {
            source: 'reduce_only_cleanup',
            sequence: nextSequence,
          });
        }
      }
      markRfqTiming(timing, 'cleanup.reduce_only.end', {
        cleanupMs: roundMs(timingNow() - cleanupStarted),
        cancelled: cleanupResult?.cancelled ?? 0,
      });
    } catch (err) {
      console.warn('cash-out reduce-only cleanup failed after close succeeded:', err.message);
      markRfqTiming(timing, 'cleanup.reduce_only.error', { message: err.message });
    }
    try {
      const cleanupStarted = timingNow();
      markRfqTiming(timing, 'cleanup.conditional.start');
      const cleanupResult = await cancelActiveConditionalOrdersForMarket({ session, marketId: market.marketId });
      if (cleanupResult?.txHash) {
        const nextSequence = advanceCachedRfqAccountSequence(session.granteeAddress);
        if (nextSequence !== null) {
          markRfqTiming(timing, 'account.cache.advance', {
            source: 'conditional_cleanup',
            sequence: nextSequence,
          });
        }
      }
      markRfqTiming(timing, 'cleanup.conditional.end', {
        cleanupMs: roundMs(timingNow() - cleanupStarted),
        skipped: Boolean(cleanupResult?.skipped),
        txHash: cleanupResult?.txHash ?? null,
      });
    } catch (err) {
      console.warn('cash-out conditional cleanup failed after close succeeded:', err.message);
      markRfqTiming(timing, 'cleanup.conditional.error', { message: err.message });
    }

    flushRfqTiming(timing, 'success', {
      txHash: closeResult.txHash,
      prepared: compactPrepared(closeResult.prepared),
      broadcastPath: closeResult.broadcastPath ?? null,
    });

    return {
      ...closeResult,
      rfq: {
        rfqId: closeResult.prepared.rfqId,
        quotesAccepted: closeResult.prepared.quotes?.length ?? 0,
        bestPrice: closeResult.prepared.quotes?.[0]?.price ?? null,
        quotesWaitMs: closeResult.prepared.quotesWaitMs,
        reduceOnly: true,
      },
    };
  } catch (err) {
    flushRfqTiming(timing, 'error', { message: err.message });
    throw err;
  }
}
