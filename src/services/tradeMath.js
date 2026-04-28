import Decimal from 'decimal.js';

const QUOTE_SCALE = new Decimal(10).pow(6);

export function toChainPrice(humanPrice, minPriceTickSize) {
  const chainPrice = new Decimal(humanPrice).mul(QUOTE_SCALE);
  const tick = new Decimal(minPriceTickSize);
  return chainPrice.div(tick).floor().mul(tick).toFixed(0, Decimal.ROUND_DOWN);
}

export function toChainQty(humanQty, minQuantityTickSize) {
  const tick = new Decimal(minQuantityTickSize);
  const quantized = new Decimal(humanQty).div(tick).floor().mul(tick);
  return quantized.toFixed(18).replace(/\.?0+$/, '') || '0';
}

export function toChainMargin(humanMargin) {
  return new Decimal(humanMargin).mul(QUOTE_SCALE).toFixed(0, Decimal.ROUND_DOWN);
}
