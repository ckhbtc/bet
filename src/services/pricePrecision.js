import Decimal from 'decimal.js';

export function normalizePriceDecimals(decimals) {
  const n = Number(decimals);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(12, Math.floor(n)));
}

export function priceDecimalsFromTickSize(minPriceTickSize, quoteDecimals = 6) {
  try {
    const tick = new Decimal(minPriceTickSize || 0);
    if (!tick.isFinite() || tick.lte(0)) return null;
    const humanTick = tick.div(new Decimal(10).pow(quoteDecimals));
    return normalizePriceDecimals(humanTick.decimalPlaces());
  } catch {
    return null;
  }
}
