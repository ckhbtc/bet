import Decimal from 'decimal.js';
import {
  ChainGrpcWasmApi,
  IndexerGrpcRFQApi,
  MsgExecuteContractCompat,
  getEthereumAddress,
} from '@injectivelabs/sdk-ts';
import { getNetworkEndpoints, Network } from '@injectivelabs/networks';
import {
  RFQ_CHAIN_ID,
  RFQ_CONTRACT_ADDRESS,
  RFQ_EVM_CHAIN_ID,
  RFQ_TPSL_DEADLINE_MS,
  RFQ_TPSL_MIN_FILL_RATIO,
  RFQ_TPSL_NONCE_WINDOW_MS,
  RFQ_TPSL_SIGNED_INTENT_VERSION,
  RFQ_TPSL_SLIPPAGE,
  RFQ_TPSL_SUBACCOUNT_NONCE,
  RFQ_TPSL_TRIGGER,
} from './rfqConstants.js';
import { broadcastViaAuthz } from './trade.js';

const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);
const wasmApi = new ChainGrpcWasmApi(endpoints.grpc);
const rfqApi = new IndexerGrpcRFQApi(endpoints.indexer);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SIGNED_TAKER_INTENT_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  SignedTakerIntent: [
    { name: 'version', type: 'uint8' },
    { name: 'evmChainId', type: 'uint64' },
    { name: 'taker', type: 'address' },
    { name: 'epoch', type: 'uint64' },
    { name: 'rfqId', type: 'uint64' },
    { name: 'takerNonceTimeWindowMs', type: 'uint64' },
    { name: 'marketId', type: 'string' },
    { name: 'subaccountNonce', type: 'uint32' },
    { name: 'laneVersion', type: 'uint64' },
    { name: 'deadlineMs', type: 'uint64' },
    { name: 'direction', type: 'uint8' },
    { name: 'quantity', type: 'string' },
    { name: 'margin', type: 'string' },
    { name: 'worstPrice', type: 'string' },
    { name: 'minTotalFillQuantity', type: 'string' },
    { name: 'triggerKind', type: 'uint8' },
    { name: 'triggerPrice', type: 'string' },
    { name: 'unfilledActionKind', type: 'uint8' },
    { name: 'unfilledActionPrice', type: 'string' },
    { name: 'cid', type: 'string' },
    { name: 'allowedRelayer', type: 'address' },
  ],
};

const TRIGGER_KIND_BY_TYPE = {
  [RFQ_TPSL_TRIGGER.MARK_PRICE_GTE]: 1,
  [RFQ_TPSL_TRIGGER.MARK_PRICE_LTE]: 2,
};

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tpsl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function canonicalDecimal(value) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new Error(`Invalid decimal value: ${value}`);
  const fixed = decimal.toFixed();
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0';
}

function quantizeDecimal(value, tick, rounding = Decimal.ROUND_FLOOR) {
  const decimal = new Decimal(value);
  const minTick = new Decimal(tick || 0);
  if (!decimal.isFinite()) throw new Error(`Invalid decimal value: ${value}`);
  if (!minTick.isFinite() || minTick.lte(0)) return canonicalDecimal(decimal);
  return canonicalDecimal(decimal.div(minTick).toDecimalPlaces(0, rounding).mul(minTick));
}

function humanPriceTick(minPriceTickSize) {
  return new Decimal(minPriceTickSize || '1').div(1_000_000);
}

function readWasmJson(response) {
  const data = response?.data ?? response;
  if (!data) return {};
  if (typeof data === 'string') return JSON.parse(data);
  return JSON.parse(new TextDecoder().decode(data));
}

export function buildSignedTakerIntentTypedData(intent, {
  evmChainId = RFQ_EVM_CHAIN_ID,
  contractAddress = RFQ_CONTRACT_ADDRESS,
} = {}) {
  return {
    types: SIGNED_TAKER_INTENT_TYPES,
    primaryType: 'SignedTakerIntent',
    domain: {
      name: 'RFQ',
      version: '1',
      chainId: evmChainId,
      verifyingContract: getEthereumAddress(contractAddress),
    },
    message: {
      version: intent.version,
      evmChainId: String(evmChainId),
      taker: intent.takerEthAddress,
      epoch: String(intent.epoch),
      rfqId: String(intent.rfqId),
      takerNonceTimeWindowMs: String(intent.takerNonceTimeWindowMs),
      marketId: intent.marketId,
      subaccountNonce: intent.subaccountNonce,
      laneVersion: String(intent.laneVersion),
      deadlineMs: String(intent.deadlineMs),
      direction: intent.direction === 'long' ? 0 : 1,
      quantity: intent.quantity,
      margin: intent.margin,
      worstPrice: intent.worstPrice,
      minTotalFillQuantity: intent.minTotalFillQuantity,
      triggerKind: TRIGGER_KIND_BY_TYPE[intent.triggerType],
      triggerPrice: intent.triggerPrice,
      unfilledActionKind: 0,
      unfilledActionPrice: '0',
      cid: intent.cid,
      allowedRelayer: intent.allowedRelayer
        ? getEthereumAddress(intent.allowedRelayer)
        : ZERO_ADDRESS,
    },
  };
}

export function buildTpSlConditionalOrder({
  market,
  side,
  quantity,
  triggerPrice,
  kind = 'take_profit',
  slippage = RFQ_TPSL_SLIPPAGE,
  rfqId = Date.now(),
}) {
  const isLong = side === 'long';
  const closingDirection = isLong ? 'short' : 'long';
  const triggerType = kind === 'take_profit'
    ? (isLong ? RFQ_TPSL_TRIGGER.MARK_PRICE_GTE : RFQ_TPSL_TRIGGER.MARK_PRICE_LTE)
    : (isLong ? RFQ_TPSL_TRIGGER.MARK_PRICE_LTE : RFQ_TPSL_TRIGGER.MARK_PRICE_GTE);
  const priceTick = humanPriceTick(market.minPriceTickSize);
  const normalizedTrigger = quantizeDecimal(triggerPrice, priceTick);
  const normalizedQuantity = quantizeDecimal(quantity, market.minQuantityTickSize);
  const worstRaw = closingDirection === 'long'
    ? new Decimal(normalizedTrigger).mul(new Decimal(1).plus(slippage))
    : new Decimal(normalizedTrigger).mul(new Decimal(1).minus(slippage));
  const worstPrice = quantizeDecimal(
    worstRaw,
    priceTick,
    closingDirection === 'long' ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR
  );
  const minFillRaw = new Decimal(normalizedQuantity).mul(RFQ_TPSL_MIN_FILL_RATIO);
  const minFillQuantized = quantizeDecimal(minFillRaw, market.minQuantityTickSize);
  const minTotalFillQuantity = new Decimal(minFillQuantized).lt(market.minQuantityTickSize)
    ? canonicalDecimal(market.minQuantityTickSize)
    : minFillQuantized;

  return {
    rfqId,
    margin: '0',
    marketId: market.marketId,
    quantity: normalizedQuantity,
    direction: closingDirection,
    worstPrice,
    triggerPrice: normalizedTrigger,
    triggerType,
    minTotalFillQuantity,
  };
}

export async function fetchTakerIntentState({
  taker,
  marketId,
  wasmApiClient = wasmApi,
}) {
  const response = await wasmApiClient.fetchSmartContractState(
    RFQ_CONTRACT_ADDRESS,
    {
      taker_intent_state: {
        taker,
        market_id: marketId,
        subaccount_nonce: RFQ_TPSL_SUBACCOUNT_NONCE,
      },
    }
  );
  const data = readWasmJson(response);
  return {
    epoch: Number(data?.epoch ?? 0),
    laneVersion: Number(data?.lane_version ?? data?.laneVersion ?? 0),
  };
}

export async function listActiveConditionalOrders({
  taker,
  marketId = null,
  rfqApiClient = rfqApi,
}) {
  const response = await rfqApiClient.listConditionalOrders({
    requestAddress: taker,
    ...(marketId ? { marketId } : {}),
  });
  return (response.orders || []).filter(order => order.status === 'pending_trigger');
}

export async function cancelConditionalOrderLane({ session, marketId }) {
  const msg = MsgExecuteContractCompat.fromJSON({
    funds: [],
    contractAddress: RFQ_CONTRACT_ADDRESS,
    sender: session.granterAddress,
    msg: {
      cancel_intent_lane: {
        market_id: marketId,
        subaccount_nonce: RFQ_TPSL_SUBACCOUNT_NONCE,
      },
    },
  });
  return broadcastViaAuthz([msg], session);
}

export async function cancelActiveConditionalOrdersForMarket({ session, marketId }) {
  const activeOrders = await listActiveConditionalOrders({
    taker: session.granterAddress,
    marketId,
  }).catch(() => []);

  if (activeOrders.length === 0) return { txHash: null, skipped: true };
  return cancelConditionalOrderLane({ session, marketId });
}

async function ensureInjectiveSigningChain() {
  if (!window.ethereum) throw new Error('No wallet detected');

  const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(currentChain, 16) === RFQ_EVM_CHAIN_ID) return RFQ_EVM_CHAIN_ID;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${RFQ_EVM_CHAIN_ID.toString(16)}` }],
    });
  } catch (err) {
    if (err?.code !== 4902) throw err;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: `0x${RFQ_EVM_CHAIN_ID.toString(16)}`,
        chainName: 'Injective',
        nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
        rpcUrls: ['https://sentry.evm-rpc.injective.network/'],
        blockExplorerUrls: ['https://tcx.inj.so/'],
      }],
    });
  }

  const recheck = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(recheck, 16) !== RFQ_EVM_CHAIN_ID) {
    throw new Error('Please switch to Injective (chain ID 1776) in your wallet');
  }
  return RFQ_EVM_CHAIN_ID;
}

export async function signConditionalOrderIntent(intent, {
  expectedEthAddress,
  evmChainId = RFQ_EVM_CHAIN_ID,
} = {}) {
  if (!window.ethereum) throw new Error('No wallet detected');
  const activeChainId = await ensureInjectiveSigningChain();
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const from = accounts?.[0];
  if (!from) throw new Error('No wallet account available for TP signature');
  if (expectedEthAddress && from.toLowerCase() !== expectedEthAddress.toLowerCase()) {
    throw new Error('Connected wallet changed before take-profit signing');
  }

  const typedData = buildSignedTakerIntentTypedData(intent, {
    evmChainId: evmChainId || activeChainId,
  });
  return window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [from, JSON.stringify(typedData)],
  });
}

export async function submitConditionalOrder({
  session,
  order,
  laneState,
  deadlineMs = Date.now() + RFQ_TPSL_DEADLINE_MS,
  cid = randomId(),
  rfqApiClient = rfqApi,
}) {
  const intent = {
    cid,
    deadlineMs,
    takerEthAddress: session.ethAddress,
    allowedRelayer: '',
    rfqId: order.rfqId,
    margin: order.margin,
    epoch: laneState.epoch,
    marketId: order.marketId,
    quantity: order.quantity,
    direction: order.direction,
    triggerType: order.triggerType,
    triggerPrice: order.triggerPrice,
    laneVersion: laneState.laneVersion,
    version: RFQ_TPSL_SIGNED_INTENT_VERSION,
    subaccountNonce: RFQ_TPSL_SUBACCOUNT_NONCE,
    takerNonceTimeWindowMs: RFQ_TPSL_NONCE_WINDOW_MS,
    minTotalFillQuantity: order.minTotalFillQuantity,
    worstPrice: order.worstPrice,
  };
  const signature = await signConditionalOrderIntent(intent, {
    expectedEthAddress: session.ethAddress,
  });
  return rfqApiClient.createConditionalOrder({
    signature,
    signMode: 'v2',
    evmChainId: BigInt(RFQ_EVM_CHAIN_ID),
    order: {
      cid,
      chainId: RFQ_CHAIN_ID,
      taker: session.granterAddress,
      margin: order.margin,
      marketId: order.marketId,
      quantity: order.quantity,
      direction: order.direction,
      rfqId: BigInt(order.rfqId),
      deadlineMs: BigInt(deadlineMs),
      triggerType: order.triggerType,
      epoch: BigInt(laneState.epoch),
      triggerPrice: order.triggerPrice,
      version: RFQ_TPSL_SIGNED_INTENT_VERSION,
      contractAddress: RFQ_CONTRACT_ADDRESS,
      subaccountNonce: RFQ_TPSL_SUBACCOUNT_NONCE,
      laneVersion: BigInt(laneState.laneVersion),
      minTotalFillQuantity: order.minTotalFillQuantity,
      worstPrice: order.worstPrice,
      takerNonceTimeWindowMs: BigInt(RFQ_TPSL_NONCE_WINDOW_MS),
    },
  });
}

export async function submitTakeProfitIntent({
  session,
  market,
  side,
  quantity,
  triggerPrice,
}) {
  await cancelActiveConditionalOrdersForMarket({ session, marketId: market.marketId });

  const laneState = await fetchTakerIntentState({
    taker: session.granterAddress,
    marketId: market.marketId,
  });
  const order = buildTpSlConditionalOrder({
    market,
    side,
    quantity,
    triggerPrice,
    kind: 'take_profit',
  });
  const response = await submitConditionalOrder({
    session,
    order,
    laneState,
  });

  return {
    requested: true,
    placed: true,
    error: null,
    order,
    response,
  };
}
