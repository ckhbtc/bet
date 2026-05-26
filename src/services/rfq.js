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
  RFQ_REQUEST_TIMEOUT_MS,
  RFQ_WS_URL,
} from './rfqConstants.js';
import { AUTHZ_SCOPE_VERSION } from './authzMessages.js';
import {
  cleanupReduceOnlyOrdersForMarket,
  fetchOraclePriceForMarket,
  getMarket,
  placeTakeProfitOrder,
  requireSession,
} from './trade.js';

const GRPC_HEADER_SIZE = 5;
const GRPC_COMPRESSION_NONE = 0;
const GRPC_COMPRESSION_TRAILER = 128;
const MAX_QUOTES_PER_ACCEPT = 8;
const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);
const authApi = new ChainGrpcAuthApi(endpoints.grpc);
const txApi = new TxGrpcApi(endpoints.grpc);
const rfqGatewayApi = new IndexerGrpcRfqGwApi(RFQ_GATEWAY_URL);

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rfq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function getSignerPubKeyBase64(signerInfo) {
  const value = signerInfo?.publicKey?.value;
  return value?.length ? uint8ArrayToBase64(value) : '';
}

async function fetchAccountDetailsNoThrow(address) {
  try {
    return await authApi.fetchAccount(address);
  } catch {
    return null;
  }
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
  const autosignIndex = signerInfos.findIndex((signerInfo) => (
    getSignerPubKeyBase64(signerInfo) === autosignPubKeyBase64
  ));
  const feePayerIndex = signerInfos.findIndex((signerInfo) => (
    feePayerPubKeyBase64 && getSignerPubKeyBase64(signerInfo) === feePayerPubKeyBase64
  ));

  return {
    autosignIndex: autosignIndex >= 0 ? autosignIndex : 0,
    feePayerIndex: feePayerIndex >= 0 ? feePayerIndex : (autosignIndex === 0 ? 1 : 0),
    signerCount: signerInfos.length || 2,
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

export async function broadcastPreparedRfqAutoSign({
  prepared,
  session,
  txApiClient = txApi,
}) {
  const txRaw = await signPreparedAutoSignTxRaw({
    tx: prepared.tx,
    feePayerSig: prepared.feePayerSig,
    privateKeyHex: session.privateKeyHex,
    accountNumber: prepared.autosignAccountNumber,
    feePayerPubKey: prepared.feePayerPubKey,
  });

  const response = await txApiClient.broadcast(txRaw);
  if (response.code !== 0) {
    throw new Error(`RFQ settlement failed (code ${response.code}): ${response.rawLog}`);
  }
  return { txHash: response.txHash };
}

export async function executeRfqGatewayAutoSign({
  session,
  marketId,
  input,
  gatewayApi = rfqGatewayApi,
  txApiClient = txApi,
}) {
  const privateKey = PrivateKey.fromHex(session.privateKeyHex);
  const accountDetails = await fetchAccountDetailsNoThrow(privateKey.toBech32());
  const request = buildRfqGatewayPrepareRequest({
    session,
    input,
    marketId,
    accountDetails,
  });
  const prepared = await gatewayApi.fetchPrepareAutoSign(request);

  if (!prepared?.tx?.length) {
    throw new Error('RFQ gateway did not return a prepared settlement transaction');
  }
  if (!prepared.quotes?.length) {
    throw new Error('No executable RFQ quote returned. RFQ gateway selected 0 quote(s).');
  }

  const result = await broadcastPreparedRfqAutoSign({
    prepared,
    session,
    txApiClient,
  });

  return {
    ...result,
    prepared,
  };
}

export function buildRfqOrderInput({ market, oraclePrice, side, stakeUsdt, leverage, slippage = 0.01 }) {
  const isLong = side === 'long';
  const stake = new Decimal(stakeUsdt);
  const lev = new Decimal(leverage);
  const price = new Decimal(oraclePrice);

  const quantity = quantizeDecimal(
    stake.mul(lev).div(price),
    market.minQuantityTickSize,
    Decimal.ROUND_FLOOR
  );
  if (new Decimal(quantity).lte(0)) throw new Error('Quantity rounds to zero - try a larger size');

  const worstRaw = price.mul(isLong ? new Decimal(1).plus(slippage) : new Decimal(1).minus(slippage));
  const worstPrice = quantizeDecimal(
    worstRaw,
    humanPriceTick(market.minPriceTickSize),
    isLong ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR
  );

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
}) {
  const session = requireSession(granterAddress);
  if (Number(session.scopeVersion || 1) < AUTHZ_SCOPE_VERSION) {
    throw new Error('RFQ needs updated autosign permissions. Revoke autosign, then authorize again to add the RFQ contract grants.');
  }

  const market = await getMarket(marketId);
  const oraclePrice = await fetchOraclePriceForMarket(market);
  const input = buildRfqOrderInput({ market, oraclePrice, side, stakeUsdt, leverage, slippage });

  const openResult = await executeRfqGatewayAutoSign({
    session,
    marketId: market.marketId,
    input,
  });

  let takeProfit = tpPrice && Number(tpPrice) > 0
    ? { requested: true, placed: false, error: null }
    : { requested: false, placed: false, error: null };

  if (tpPrice && Number(tpPrice) > 0) {
    try {
      await placeTakeProfitOrder({
        session,
        market,
        isLong: side === 'long',
        quantity: input.quantity,
        tpPrice,
      });
      takeProfit = { requested: true, placed: true, error: null };
    } catch (err) {
      console.warn('RFQ TP placement failed (open succeeded):', err.message);
      takeProfit = {
        requested: true,
        placed: false,
        error: err.message || 'Take-profit placement failed',
      };
    }
  }

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
}

export async function tradeCloseRfq({
  granterAddress,
  marketId,
  side,
  quantity,
  slippage = 0.02,
}) {
  const session = requireSession(granterAddress);
  if (Number(session.scopeVersion || 1) < AUTHZ_SCOPE_VERSION) {
    throw new Error('RFQ needs updated autosign permissions. Revoke autosign, then authorize again to add the RFQ contract grants.');
  }

  const market = await getMarket(marketId);
  const oraclePrice = await fetchOraclePriceForMarket(market);
  const input = buildRfqCloseInput({ market, oraclePrice, side, quantity, slippage });
  const closeResult = await executeRfqGatewayAutoSign({
    session,
    marketId: market.marketId,
    input,
  });
  await cleanupReduceOnlyOrdersForMarket({ session, market });

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
}
