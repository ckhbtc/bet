import Decimal from 'decimal.js';

export function canonicalDecimal(value) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new Error(`Invalid decimal value: ${value}`);
  const fixed = decimal.toFixed();
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0';
}

export function quantizeDecimal(value, tick, rounding = Decimal.ROUND_FLOOR) {
  const decimal = new Decimal(value);
  const minTick = new Decimal(tick || 0);
  if (!decimal.isFinite()) throw new Error(`Invalid decimal value: ${value}`);
  if (!minTick.isFinite() || minTick.lte(0)) return canonicalDecimal(decimal);
  return canonicalDecimal(decimal.div(minTick).toDecimalPlaces(0, rounding).mul(minTick));
}

export function humanPriceTick(minPriceTickSize) {
  return new Decimal(minPriceTickSize || '1').div(1_000_000);
}
