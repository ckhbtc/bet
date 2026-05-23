/**
 * Injective read-only API calls — markets, prices, balances, positions.
 * Adapted from easyperps injective.ts.
 */

import {
  IndexerGrpcDerivativesApi,
  IndexerGrpcOracleApi,
  IndexerGrpcAccountPortfolioApi,
  IndexerRestDerivativesChronosApi,
  Address,
} from '@injectivelabs/sdk-ts';
import { getNetworkEndpoints, Network } from '@injectivelabs/networks';
import Decimal from 'decimal.js';

const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);

const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);
const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
const portfolioApi = new IndexerGrpcAccountPortfolioApi(endpoints.indexer);
const chronosDerivativesApi = new IndexerRestDerivativesChronosApi(`${endpoints.chronos}/api/chronos/v1/derivative`);

const USDT_DECIMALS = 6;
const INJ_DECIMALS = 18;

// ─── Token registry for Peggy-bridged tokens ─────────────────────────────────

const PEGGY_REGISTRY = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
  '0x87ab3b4c8661e07d6372361211b96ed4dc36b1b5': { symbol: 'USDT', decimals: 6 },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
};

function resolveDenom(denom) {
  if (denom === 'inj') return { symbol: 'INJ', decimals: INJ_DECIMALS };
  if (denom.startsWith('peggy0x') || denom.startsWith('peggy0X')) {
    const addr = denom.slice('peggy'.length).toLowerCase();
    return PEGGY_REGISTRY[addr] || null;
  }
  return null;
}

// ─── Markets cache ────────────────────────────────────────────────────────────

let _marketsCache = null;
let _marketsCacheTs = 0;
const CACHE_TTL_MS = 60_000;

export async function listMarkets() {
  if (_marketsCache && Date.now() - _marketsCacheTs < CACHE_TTL_MS) {
    return _marketsCache;
  }

  const markets = await derivativesApi.fetchMarkets({ marketStatus: 'active' });

  const perps = [];
  for (const m of markets) {
    const isPerpetual =
      m.isPerpetual === true ||
      String(m.ticker || '').toUpperCase().includes('PERP') ||
      (m.initialMarginRatio != null && m.settlementPrice == null);

    if (!isPerpetual) continue;

    const ticker = String(m.ticker || '');
    const symbolFromTicker = ticker.split('/')[0] || '';
    const oracleBase = String(m.oracleBase || symbolFromTicker);

    perps.push({
      symbol: symbolFromTicker || oracleBase,
      ticker,
      marketId: String(m.marketId || ''),
      minPriceTickSize: String(m.minPriceTickSize || '0.001'),
      minQuantityTickSize: String(m.minQuantityTickSize || '0.001'),
      initialMarginRatio: String(m.initialMarginRatio || '0.05'),
      maintenanceMarginRatio: String(m.maintenanceMarginRatio || '0.02'),
      takerFeeRate: String(m.takerFeeRate || '0.001'),
      oracleBase,
      oracleQuote: String(m.oracleQuote || 'USDC'),
      oracleType: String(m.oracleType || 'bandibc'),
    });
  }

  _marketsCache = perps;
  _marketsCacheTs = Date.now();
  return perps;
}

export async function resolveMarket(symbol) {
  const markets = await listMarkets();
  const s = symbol.toUpperCase();
  return markets.find(m =>
    m.symbol.toUpperCase() === s ||
    m.ticker.toUpperCase().startsWith(s + '/')
  ) || null;
}

// ─── Oracle prices ────────────────────────────────────────────────────────────

export async function fetchOraclePrice(market) {
  try {
    const result = await oracleApi.fetchOraclePrice({
      baseSymbol: market.oracleBase,
      quoteSymbol: market.oracleQuote,
      oracleType: market.oracleType,
    });
    return result.price ? new Decimal(result.price).toNumber() : null;
  } catch {
    return null;
  }
}

export async function fetchAllPrices(markets) {
  const prices = {};
  const pricePromises = markets.map(async (m) => {
    const price = await fetchOraclePrice(m);
    if (price) prices[m.marketId] = price;
  });
  await Promise.allSettled(pricePromises);
  return prices;
}

// ─── 24h market summary (price, open, change) ─────────────────────────────────
//
// Returns a Map keyed by marketId with { price, open, change24hPct } —
// change24hPct is a percentage (e.g. -1.32 = -1.32%) computed from open/price
// so the value is unambiguous regardless of how the SDK's `.change` field
// happens to be encoded.

export async function fetchMarketsSummary() {
  try {
    const summaries = await chronosDerivativesApi.fetchMarketsSummary();
    const map = {};
    for (const s of summaries) {
      if (!s.marketId) continue;
      const open = Number(s.open ?? 0);
      const price = Number(s.price ?? 0);
      // Chronos returns `change` already as a percentage (-0.75 = -0.75%);
      // fall back to computing from open/price if the field is missing.
      const change24hPct = Number.isFinite(s.change) && s.change !== 0
        ? Number(s.change)
        : (open > 0 && price > 0 ? ((price - open) / open) * 100 : 0);
      map[s.marketId] = { price, open, change24hPct };
    }
    return map;
  } catch (err) {
    console.error('fetchMarketsSummary failed:', err);
    return {};
  }
}

// ─── Balances ────────────────────────────────────────────────────────────────

export async function fetchBalances(injAddress) {
  const portfolio = await portfolioApi.fetchAccountPortfolioBalances(injAddress);

  const result = { bank: [], subaccount: [], usdtTotal: 0 };

  // Bank balances
  for (const b of portfolio.bankBalancesList || []) {
    const token = resolveDenom(b.denom || '');
    if (!token) continue;
    const amt = new Decimal(b.amount || '0').div(new Decimal(10).pow(token.decimals));
    if (amt.gt(0.0001)) {
      result.bank.push({ symbol: token.symbol, amount: amt.toNumber(), denom: b.denom });
      if (token.symbol === 'USDT') result.usdtTotal += amt.toNumber();
    }
  }

  // Subaccount balances
  for (const s of portfolio.subaccountsList || []) {
    const token = resolveDenom(s.denom || '');
    if (!token) continue;
    const avail = new Decimal(s.deposit?.availableBalance || '0').div(new Decimal(10).pow(token.decimals));
    if (avail.gt(0.0001)) {
      result.subaccount.push({ symbol: token.symbol, amount: avail.toNumber(), denom: s.denom });
      if (token.symbol === 'USDT') result.usdtTotal += avail.toNumber();
    }
  }

  return result;
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function fetchPositions(injAddress) {
  const markets = await listMarkets();
  const marketMap = new Map(markets.map(m => [m.marketId, m]));

  const [posRes, ordersRes] = await Promise.all([
    derivativesApi.fetchPositionsV2({ address: injAddress }),
    fetchOpenOrders(injAddress).catch(() => ({ orders: [] })),
  ]);

  const SCALE = new Decimal(10).pow(USDT_DECIMALS);

  // Index reduce-only limit orders by marketId so we can attach TPs per position.
  const tpByMarket = new Map();
  for (const o of ordersRes.orders || []) {
    const isReduceOnly = String(o.margin || '0') === '0';
    if (!isReduceOnly) continue;
    const orderPrice = new Decimal(o.price).div(SCALE).toNumber();
    const list = tpByMarket.get(o.marketId) || [];
    list.push({ price: orderPrice, side: o.orderSide, quantity: o.quantity });
    tpByMarket.set(o.marketId, list);
  }

  const result = [];
  for (const p of posRes.positions || []) {
    const market = marketMap.get(p.marketId);
    const side = p.direction === 'long' ? 'long' : 'short';

    const entryPrice = new Decimal(p.entryPrice).div(SCALE);
    const markPrice = new Decimal(p.markPrice || p.entryPrice).div(SCALE);
    const quantity = new Decimal(p.quantity);
    const margin = new Decimal(p.margin).div(SCALE);
    const liqPrice = p.liquidationPrice
      ? new Decimal(p.liquidationPrice).div(SCALE).toNumber()
      : null;

    const dir = side === 'long' ? 1 : -1;
    const pnl = markPrice.minus(entryPrice).mul(quantity).mul(dir);
    const pnlPct = margin.gt(0) ? pnl.div(margin).mul(100) : new Decimal(0);

    // TP for a long is a SELL reduce-only above entry; for a short, a BUY below.
    const candidates = tpByMarket.get(p.marketId) || [];
    const wantedSide = side === 'long' ? 'sell' : 'buy';
    const tpOrder = candidates.find(c => String(c.side).toLowerCase() === wantedSide);

    result.push({
      symbol: market?.symbol || p.marketId.slice(0, 6),
      ticker: market?.ticker || p.ticker || p.marketId,
      marketId: p.marketId,
      market,
      side,
      direction: side === 'long' ? 'up' : 'down',
      quantity: quantity.toFixed(4),
      entryPrice: entryPrice.toNumber(),
      markPrice: markPrice.toNumber(),
      margin: margin.toNumber(),
      liqPrice,
      tpPrice: tpOrder ? tpOrder.price : null,
      pnl: pnl.toNumber(),
      pnlPct: pnlPct.toNumber(),
      stake: margin.toNumber(),
      currentPrice: markPrice.toNumber(),
      asset: market?.symbol || p.marketId.slice(0, 6),
      status: pnl.gte(0) ? 'winning' : 'at_risk',
      id: p.marketId + '_' + side,
    });
  }
  return result;
}

// ─── Open orders (used to surface TP per position) ────────────────────────────

async function fetchOpenOrders(injAddress) {
  const ethAddress = Address.fromBech32(injAddress).toHex();
  const subaccountId = Address.fromHex(ethAddress).getSubaccountId(0);
  return derivativesApi.fetchOrders({ subaccountId });
}
