import Decimal from 'decimal.js';

export const RFQ_OPEN_SLIPPAGE = 0.01;
export const DEFAULT_INITIAL_MARGIN_RATIO = '0.05';
export const STANDARD_MAX_LEVERAGE_STEPS = [5, 10, 25, 50, 100];

export const LEVERAGE_PRESET_ROWS = [
  { maxLeverage: 5, levels: { LOW: 1, MEDIUM: 2, HIGH: 3, MAX: 5 } },
  { maxLeverage: 10, levels: { LOW: 2, MEDIUM: 3, HIGH: 5, MAX: 10 } },
  { maxLeverage: 25, levels: { LOW: 2, MEDIUM: 5, HIGH: 10, MAX: 25 } },
  { maxLeverage: 50, levels: { LOW: 5, MEDIUM: 10, HIGH: 25, MAX: 50 } },
  { maxLeverage: 100, levels: { LOW: 10, MEDIUM: 25, HIGH: 50, MAX: 100 } },
];

export const LEVERAGE_LEVEL_META = {
  LOW: { label: 'Low', desc: 'Big swing required', color: '#4a9eff' },
  MEDIUM: { label: 'Medium', desc: 'Moderate move needed', color: '#f59e0b' },
  HIGH: { label: 'High', desc: 'Small price move wins', color: '#ef4444' },
  MAX: { label: 'Max', desc: 'Smallest price move wins', color: '#dc2626' },
};

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

export function steppedMaxOpenLeverage(initialMarginRatio, slippage = RFQ_OPEN_SLIPPAGE) {
  const rawMax = maxOpenLeverage(initialMarginRatio, slippage);
  if (!Number.isFinite(rawMax)) return STANDARD_MAX_LEVERAGE_STEPS[STANDARD_MAX_LEVERAGE_STEPS.length - 1];

  const safeStep = [...STANDARD_MAX_LEVERAGE_STEPS]
    .reverse()
    .find(step => step <= rawMax);

  return safeStep ?? 1;
}

export function leveragePresetRowForMax(maxLeverage) {
  const max = Number(maxLeverage);
  const fallback = LEVERAGE_PRESET_ROWS[0];
  if (!Number.isFinite(max)) return LEVERAGE_PRESET_ROWS[LEVERAGE_PRESET_ROWS.length - 1];
  return [...LEVERAGE_PRESET_ROWS].reverse().find(row => row.maxLeverage <= max) || fallback;
}

export function leverageOptionsForMarket(initialMarginRatio, slippage = RFQ_OPEN_SLIPPAGE) {
  const steppedMax = steppedMaxOpenLeverage(initialMarginRatio, slippage);
  const row = leveragePresetRowForMax(steppedMax);

  return Object.entries(row.levels).map(([key, leverage]) => {
    const meta = LEVERAGE_LEVEL_META[key];
    return {
      key,
      leverage,
      ...meta,
      allowed: isOpenLeverageAllowed({
        initialMarginRatio,
        leverage,
        slippage,
      }),
    };
  });
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
  const maxLeverage = formatLeverage(steppedMaxOpenLeverage(market?.initialMarginRatio, slippage));
  throw new Error(
    `Selected leverage is too high for ${label}. Max is ${maxLeverage}x on this market. Choose a lower aggressiveness.`
  );
}
