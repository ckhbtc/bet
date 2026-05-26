/**
 * Client-side trade execution — signs and broadcasts MsgAuthzExec from
 * the browser using the locally-stored grantee key. Mirrors what the
 * server's executor.js used to do, but with the private key never
 * leaving the user's machine.
 *
 * Uses Injective's fee-delegation relay so trades are gas-free for the
 * grantee — same UX as the old server-broadcast path.
 */

import {
  MsgCreateDerivativeMarketOrder,
  MsgCreateDerivativeLimitOrder,
  MsgCancelDerivativeOrder,
  MsgAuthzExec,
  MsgBroadcasterWithPk,
  OrderTypeMap,
  Address,
  IndexerGrpcOracleApi,
  IndexerGrpcDerivativesApi,
} from '@injectivelabs/sdk-ts';
import { getNetworkEndpoints, Network } from '@injectivelabs/networks';
import Decimal from 'decimal.js';
import { getGrantee } from './grantee.js';
import { toChainPrice, toChainQty, toChainMargin } from './tradeMath.js';

const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);
const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);

// ─── Markets cache ─────────────────────────────────────────────────────────

let _marketsCache = null;
let _marketsCacheTs = 0;
const MARKETS_TTL_MS = 60_000;

export async function getMarket(marketId) {
  if (!_marketsCache || Date.now() - _marketsCacheTs > MARKETS_TTL_MS) {
    const all = await derivativesApi.fetchMarkets({ marketStatus: 'active' });
    _marketsCache = new Map();
    for (const m of all) {
      _marketsCache.set(String(m.marketId), {
        marketId: String(m.marketId),
        ticker: String(m.ticker || ''),
        symbol: String(m.ticker || '').split('/')[0] || '',
        minPriceTickSize: String(m.minPriceTickSize || '0.001'),
        minQuantityTickSize: String(m.minQuantityTickSize || '0.001'),
        initialMarginRatio: String(m.initialMarginRatio || '0.05'),
        oracleBase: String(m.oracleBase || ''),
        oracleQuote: String(m.oracleQuote || 'USDC'),
        oracleType: String(m.oracleType || 'bandibc'),
      });
    }
    _marketsCacheTs = Date.now();
  }
  const m = _marketsCache.get(marketId);
  if (!m) throw new Error(`Unknown marketId: ${marketId}`);
  return m;
}

// ─── Broadcast via AuthZ + fee delegation ──────────────────────────────────

export async function broadcastViaAuthz(msgs, session) {
  const msgExec = MsgAuthzExec.fromJSON({
    grantee: session.granteeAddress,
    msgs,
  });

  for (const gasBuffer of [12.0, 20.0]) {
    const broadcaster = new MsgBroadcasterWithPk({
      network: NETWORK,
      endpoints,
      privateKey: session.privateKeyHex,
      evmChainId: session.evmChainId,
      simulateTx: true,
      gasBufferCoefficient: gasBuffer,
    });
    try {
      const response = await broadcaster.broadcastWithFeeDelegation({ msgs: msgExec });
      if (response.code !== 0) {
        const rawLog = response.rawLog ?? '';
        if (rawLog.includes('out of gas') && gasBuffer < 20.0) continue;
        throw new Error(`Tx failed (code ${response.code}): ${rawLog}`);
      }
      return { txHash: response.txHash };
    } catch (err) {
      if ((err.message || '').includes('out of gas') && gasBuffer < 20.0) continue;
      throw err;
    }
  }
  throw new Error('Broadcast retry budget exhausted');
}

export function requireSession(granterAddress) {
  const s = getGrantee(granterAddress);
  if (!s) throw new Error('No active session — please re-authorize.');
  return s;
}

export async function fetchOraclePriceForMarket(market) {
  const oracleRes = await oracleApi.fetchOraclePrice({
    baseSymbol: market.oracleBase,
    quoteSymbol: market.oracleQuote,
    oracleType: market.oracleType,
  }).catch(() => null);
  const oraclePrice = oracleRes?.price ? new Decimal(oracleRes.price) : null;
  if (!oraclePrice) throw new Error(`Cannot fetch oracle price for ${market.symbol}`);
  return oraclePrice;
}

export async function placeTakeProfitOrder({ session, market, isLong, quantity, tpPrice }) {
  const subaccountId = Address.fromHex(session.ethAddress).getSubaccountId(0);
  const tpChainPrice = toChainPrice(new Decimal(tpPrice), market.minPriceTickSize);
  const tpChainQty = toChainQty(new Decimal(quantity), market.minQuantityTickSize);
  const tpMsg = MsgCreateDerivativeLimitOrder.fromJSON({
    marketId: market.marketId,
    subaccountId,
    injectiveAddress: session.granterAddress,
    orderType: isLong ? OrderTypeMap.SELL : OrderTypeMap.BUY,
    price: tpChainPrice,
    margin: '0',
    quantity: tpChainQty,
    feeRecipient: session.granterAddress,
  });
  return broadcastViaAuthz([tpMsg], session);
}

export async function cleanupReduceOnlyOrdersForMarket({ session, market }) {
  const subaccountId = Address.fromHex(session.ethAddress).getSubaccountId(0);

  try {
    const { orders } = await derivativesApi.fetchOrders({ subaccountId, marketId: market.marketId });
    for (const o of orders || []) {
      const isReduceOnly = String(o.margin || '0') === '0';
      if (!isReduceOnly || !o.orderHash) continue;
      const cancelMsg = MsgCancelDerivativeOrder.fromJSON({
        injectiveAddress: session.granterAddress,
        marketId: market.marketId,
        subaccountId,
        orderHash: o.orderHash,
      });
      try {
        await broadcastViaAuthz([cancelMsg], session);
      } catch (err) {
        console.warn('cancel failed for', o.orderHash, '-', err.message);
      }
    }
  } catch (err) {
    console.warn('order lookup for cancel failed:', err.message);
  }
}

// ─── Open trade (market order) + optional reduce-only TP limit ─────────────

export async function tradeOpen({
  granterAddress, marketId, side, stakeUsdt, leverage, slippage = 0.01, tpPrice = null,
}) {
  const session = requireSession(granterAddress);
  const market = await getMarket(marketId);
  const isBuy = side === 'long';

  const oraclePrice = await fetchOraclePriceForMarket(market);

  const stake = new Decimal(stakeUsdt);
  const lev = new Decimal(leverage);

  const slipMul = isBuy ? new Decimal(1).plus(slippage) : new Decimal(1).minus(slippage);
  const priceWithSlip = oraclePrice.mul(slipMul);
  const qty = stake.mul(lev).div(oraclePrice);
  if (qty.lte(0)) throw new Error('Computed quantity is zero');

  const IMR = new Decimal(market.initialMarginRatio || '0.033333');
  const markSafeMargin = qty.mul(priceWithSlip.mul(IMR.plus(1)).minus(oraclePrice));
  const humanMargin = Decimal.max(stake, markSafeMargin).mul(new Decimal('1.05'));

  const chainPrice = toChainPrice(priceWithSlip, market.minPriceTickSize);
  const chainQty = toChainQty(qty, market.minQuantityTickSize);
  const chainMargin = toChainMargin(humanMargin);
  if (chainQty === '0') throw new Error('Quantity rounds to zero — try a larger size');

  const subaccountId = Address.fromHex(session.ethAddress).getSubaccountId(0);

  const openMsg = MsgCreateDerivativeMarketOrder.fromJSON({
    marketId: market.marketId,
    subaccountId,
    injectiveAddress: session.granterAddress,
    orderType: isBuy ? OrderTypeMap.BUY : OrderTypeMap.SELL,
    price: chainPrice,
    margin: chainMargin,
    quantity: chainQty,
    feeRecipient: session.granterAddress,
  });

  const openResult = await broadcastViaAuthz([openMsg], session);
  let takeProfit = tpPrice && Number(tpPrice) > 0
    ? { requested: true, placed: false, error: null }
    : { requested: false, placed: false, error: null };

  // Reduce-only TP placed in a second tx — bundling with open fails because the
  // chain validates the reduce-only against pre-tx state where no position exists.
  if (tpPrice && Number(tpPrice) > 0) {
    try {
      await placeTakeProfitOrder({
        session,
        market,
        isLong: isBuy,
        quantity: qty,
        tpPrice,
      });
      takeProfit = { requested: true, placed: true, error: null };
    } catch (err) {
      console.warn('TP placement failed (open succeeded):', err.message);
      takeProfit = {
        requested: true,
        placed: false,
        error: err.message || 'Take-profit placement failed',
      };
    }
  }

  return { ...openResult, takeProfit };
}

// ─── Close position (market order) ─────────────────────────────────────────

export async function tradeClose({
  granterAddress, marketId, side, quantity, slippage = 0.02,
}) {
  const session = requireSession(granterAddress);
  const market = await getMarket(marketId);
  const isClosingLong = side === 'long';

  const oracleRes = await oracleApi.fetchOraclePrice({
    baseSymbol: market.oracleBase,
    quoteSymbol: market.oracleQuote,
    oracleType: market.oracleType,
  }).catch(() => null);
  const oraclePrice = oracleRes?.price ? new Decimal(oracleRes.price) : null;
  if (!oraclePrice) throw new Error(`Cannot fetch oracle price for ${market.symbol}`);

  const slipMul = isClosingLong
    ? new Decimal(1).minus(slippage)
    : new Decimal(1).plus(slippage);
  const priceWithSlip = oraclePrice.mul(slipMul);

  const chainPrice = toChainPrice(priceWithSlip, market.minPriceTickSize);
  const chainQty = toChainQty(new Decimal(quantity), market.minQuantityTickSize);

  const subaccountId = Address.fromHex(session.ethAddress).getSubaccountId(0);

  const closeMsg = MsgCreateDerivativeMarketOrder.fromJSON({
    marketId: market.marketId,
    subaccountId,
    injectiveAddress: session.granterAddress,
    orderType: isClosingLong ? OrderTypeMap.SELL : OrderTypeMap.BUY,
    price: chainPrice,
    margin: '0',
    quantity: chainQty,
    feeRecipient: session.granterAddress,
  });

  const closeResult = await broadcastViaAuthz([closeMsg], session);

  // Best-effort cleanup of orphaned reduce-only TPs in a separate tx — bundling
  // would atomically fail the close if the cancel hits a stale order hash.
  await cleanupReduceOnlyOrdersForMarket({ session, market });

  return closeResult;
}
