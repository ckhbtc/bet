/**
 * Server-side AuthZ executor — multi-tenant in-memory sessions.
 * Granter signs one MsgGrant; subsequent trades are broadcast by the
 * ephemeral grantee key via MsgAuthzExec + fee delegation.
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
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const NETWORK = Network.MainnetSentry;
const endpoints = getNetworkEndpoints(NETWORK);
const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);

const QUOTE_SCALE = new Decimal(10).pow(6);

// ─── Sessions ───────────────────────────────────────────────────────────────
//
// Sessions are persisted to a JSON file so a server restart (PM2 redeploy)
// doesn't force every connected user to re-sign their AuthZ grant. The grantee
// private key inside is *ephemeral and scoped* (time-limited AuthZ on a
// trading message-type), so the threat model is comparable to FAUCET_PRIVATE_KEY
// already living in .env. The file is chmod 600 by us on write.

const _sessions = new Map(); // granterAddress → SessionState
const _tokens = new Map();   // sessionToken → granterAddress

const SESSIONS_FILE = process.env.SESSIONS_FILE
  || path.join(process.cwd(), 'sessions.json');

function nowSec() { return Math.floor(Date.now() / 1000); }

function persistSessions() {
  try {
    const data = JSON.stringify({ sessions: [..._sessions.values()] });
    fs.writeFileSync(SESSIONS_FILE, data, { mode: 0o600 });
  } catch (err) {
    console.error('persistSessions failed:', err.message);
  }
}

function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const { sessions = [] } = JSON.parse(raw);
    const now = nowSec();
    let pruned = 0;
    for (const s of sessions) {
      if (!s || !s.granterAddress || !s.sessionToken) continue;
      if (s.expiration <= now) { pruned += 1; continue; }
      _sessions.set(s.granterAddress, s);
      _tokens.set(s.sessionToken, s.granterAddress);
    }
    console.log(`loadSessions: restored ${_sessions.size} active session(s)${pruned ? `, pruned ${pruned} expired` : ''}`);
  } catch (err) {
    console.error('loadSessions failed:', err.message);
  }
}

loadSessions();

export function activateSession({
  privateKeyHex, granteeAddress, granterAddress, ethAddress, evmChainId, expiration,
}) {
  if (expiration <= nowSec()) throw new Error('Session expiration is in the past');

  // Revoke any existing token for this granter
  const existing = _sessions.get(granterAddress);
  if (existing) _tokens.delete(existing.sessionToken);

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const session = {
    privateKeyHex, granteeAddress, granterAddress, ethAddress,
    evmChainId, expiration, sessionToken,
  };
  _sessions.set(granterAddress, session);
  _tokens.set(sessionToken, granterAddress);
  persistSessions();
  return { sessionToken, expiration };
}

export function deactivateSession(granterAddress) {
  const s = _sessions.get(granterAddress);
  if (s) _tokens.delete(s.sessionToken);
  _sessions.delete(granterAddress);
  persistSessions();
}

export function getSessionByToken(token) {
  const granter = _tokens.get(token);
  if (!granter) return null;
  const s = _sessions.get(granter);
  if (!s) return null;
  if (s.expiration <= nowSec()) {
    deactivateSession(granter);
    return null;
  }
  return s;
}

export function getSessionStatus(granterAddress) {
  const s = _sessions.get(granterAddress);
  if (!s) return { active: false };
  if (s.expiration <= nowSec()) {
    deactivateSession(granterAddress);
    return { active: false };
  }
  return { active: true, expiration: s.expiration };
}

// ─── Chain conversion ──────────────────────────────────────────────────────

function toChainPrice(humanPrice, minPriceTickSize) {
  const chainPrice = humanPrice.mul(QUOTE_SCALE);
  const tick = new Decimal(minPriceTickSize);
  return chainPrice.div(tick).floor().mul(tick).toFixed(0, Decimal.ROUND_DOWN);
}

function toChainQty(humanQty, minQuantityTickSize) {
  const tick = new Decimal(minQuantityTickSize);
  const quantized = humanQty.div(tick).floor().mul(tick);
  return quantized.toFixed(18).replace(/\.?0+$/, '') || '0';
}

function toChainMargin(humanMargin) {
  return humanMargin.mul(QUOTE_SCALE).toFixed(0, Decimal.ROUND_DOWN);
}

// ─── Market lookup (cached) ────────────────────────────────────────────────

let _marketsCache = null;
let _marketsCacheTs = 0;
const MARKETS_TTL_MS = 60_000;

async function getMarket(marketId) {
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
        oracleQuote: String(m.oracleQuote || 'USDT'),
        oracleType: String(m.oracleType || 'bandibc'),
      });
    }
    _marketsCacheTs = Date.now();
  }
  const m = _marketsCache.get(marketId);
  if (!m) throw new Error(`Unknown marketId: ${marketId}`);
  return m;
}

// ─── Open trade (market order) + optional reduce-only TP limit ─────────────

export async function executeOpen({
  session, marketId, side, stakeUsdt, leverage, slippage = 0.01, tpPrice = null,
}) {
  const market = await getMarket(marketId);
  const isBuy = side === 'long';

  const oracleRes = await oracleApi.fetchOraclePrice({
    baseSymbol: market.oracleBase,
    quoteSymbol: market.oracleQuote,
    oracleType: market.oracleType,
  }).catch(() => null);
  const oraclePrice = oracleRes?.price ? new Decimal(oracleRes.price) : null;
  if (!oraclePrice) throw new Error(`Cannot fetch oracle price for ${market.symbol}`);

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

  // Reduce-only TP placed in a second tx — bundling with open fails because the
  // chain validates the reduce-only against pre-tx state where no position exists.
  if (tpPrice && Number(tpPrice) > 0) {
    try {
      const tpChainPrice = toChainPrice(new Decimal(tpPrice), market.minPriceTickSize);
      const tpMsg = MsgCreateDerivativeLimitOrder.fromJSON({
        marketId: market.marketId,
        subaccountId,
        injectiveAddress: session.granterAddress,
        orderType: isBuy ? OrderTypeMap.SELL : OrderTypeMap.BUY,
        price: tpChainPrice,
        margin: '0',
        quantity: chainQty,
        feeRecipient: session.granterAddress,
      });
      await broadcastViaAuthz([tpMsg], session);
    } catch (err) {
      // Open succeeded; TP placement failed. Surface the position txHash anyway.
      console.warn('[executor] TP placement failed (open succeeded):', err.message);
    }
  }

  return openResult;
}

// ─── Close position (market order) ─────────────────────────────────────────

export async function executeClose({
  session, marketId, side, quantity, slippage = 0.02,
}) {
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
        console.warn('[executor] cancel failed for', o.orderHash, '-', err.message);
      }
    }
  } catch (err) {
    console.warn('[executor] order lookup for cancel failed:', err.message);
  }

  return closeResult;
}

// ─── Broadcast via AuthZ + fee delegation ──────────────────────────────────

async function broadcastViaAuthz(msgs, session) {
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
  throw new Error('Transaction failed after gas retries');
}
