import Decimal from 'decimal.js';

export const RFQ_OPEN_SLIPPAGE = 0.01;
export const DEFAULT_INITIAL_MARGIN_RATIO = '0.05';

function positiveDecimal(value, fallback) {
  try {
    const decimal = new Decimal(value ?? fallback);
    return decimal.isFinite() && decimal.gt(0) ? decimal : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

function nonNegativeDecimal(value, fallback = '0') {
  try {
    const decimal = new Decimal(value ?? fallback);
    return decimal.isFinite() && decimal.gte(0) ? decimal : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

export function effectiveOpenMarginRatio(initialMarginRatio, slippage = RFQ_OPEN_SLIPPAGE) {
  const imr = positiveDecimal(initialMarginRatio, DEFAULT_INITIAL_MARGIN_RATIO);
  const slip = nonNegativeDecimal(slippage);
  return slip.plus(imr.mul(slip.plus(1)));
}

export function maxOpenLeverage(initialMarginRatio, slippage = RFQ_OPEN_SLIPPAGE) {
  const effectiveRatio = effectiveOpenMarginRatio(initialMarginRatio, slippage);
  if (!effectiveRatio.isFinite() || effectiveRatio.lte(0)) return Infinity;
  return Number(new Decimal(1).div(effectiveRatio).toDecimalPlaces(2, Decimal.ROUND_FLOOR));
}

export function formatLeverage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'unlimited';
  return n.toFixed(1).replace(/\.0$/, '');
}

export function isOpenLeverageAllowed({
  initialMarginRatio,
  leverage,
  slippage = RFQ_OPEN_SLIPPAGE,
}) {
  try {
    const lev = new Decimal(leverage);
    if (!lev.isFinite() || lev.lte(0)) return false;
    const effectiveRatio = effectiveOpenMarginRatio(initialMarginRatio, slippage);
    return lev.mul(effectiveRatio).lte(1);
  } catch {
    return false;
  }
}

export function requiredOpenMargin({
  quantity,
  oraclePrice,
  worstPrice,
  initialMarginRatio,
  side,
}) {
  const qty = positiveDecimal(quantity, '0');
  const oracle = positiveDecimal(oraclePrice, '0');
  const worst = positiveDecimal(worstPrice, '0');
  const imr = positiveDecimal(initialMarginRatio, DEFAULT_INITIAL_MARGIN_RATIO);
  const adverseMove = side === 'short' ? oracle.minus(worst) : worst.minus(oracle);
  const priceGap = Decimal.max(adverseMove, 0);
  return qty.mul(worst.mul(imr).plus(priceGap));
}

export function assertOpenMarginAllowed({
  market,
  stake,
  quantity,
  oraclePrice,
  worstPrice,
  side,
  slippage = RFQ_OPEN_SLIPPAGE,
}) {
  const margin = positiveDecimal(stake, '0');
  const requiredMargin = requiredOpenMargin({
    quantity,
    oraclePrice,
    worstPrice,
    initialMarginRatio: market?.initialMarginRatio,
    side,
  });

  if (margin.gte(requiredMargin)) return;

  const label = market?.symbol || String(market?.ticker || '').split('/')[0] || 'this market';
  const maxLeverage = formatLeverage(maxOpenLeverage(market?.initialMarginRatio, slippage));
  throw new Error(
    `Selected leverage is too high for ${label}. Max is about ${maxLeverage}x on this market. Choose a lower aggressiveness.`
  );
}
