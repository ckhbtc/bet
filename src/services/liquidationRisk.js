import { liquidationPrice } from '../data/mockData.js';

export const DANGEROUS_LIQUIDATION_CUSHION_RATIO = 0.2;

export function derivePositionLiqPrice(position) {
  const directLiq = Number(position?.liqPrice);
  if (Number.isFinite(directLiq) && directLiq > 0) return directLiq;

  const entryPrice = Number(position?.entryPrice);
  const margin = Number(position?.margin);
  const quantity = Math.abs(Number(position?.quantity));
  if (!entryPrice || !margin || !quantity) return null;

  const leverage = (entryPrice * quantity) / margin;
  if (!Number.isFinite(leverage) || leverage <= 0) return null;

  return liquidationPrice({
    entryPrice,
    leverage,
    direction: position.direction,
    mmr: Number(position?.market?.maintenanceMarginRatio) || 0.025,
  });
}

export function liquidationCushionRatio({ entryPrice, markPrice, liqPrice, direction }) {
  const entry = Number(entryPrice);
  const mark = Number(markPrice);
  const liq = Number(liqPrice);
  if (![entry, mark, liq].every(Number.isFinite) || entry <= 0 || mark <= 0 || liq <= 0 || entry === liq) {
    return null;
  }

  const isLong = direction === 'up' || direction === 'long';
  const isShort = direction === 'down' || direction === 'short';
  if (isLong && entry > liq) {
    const ratio = (mark - liq) / (entry - liq);
    return Math.max(0, Math.min(1, ratio));
  }

  if (isShort && entry < liq) {
    const ratio = (liq - mark) / (liq - entry);
    return Math.max(0, Math.min(1, ratio));
  }

  return null;
}

export function isDangerouslyCloseToLiquidation(
  position,
  threshold = DANGEROUS_LIQUIDATION_CUSHION_RATIO,
) {
  const liqPrice = derivePositionLiqPrice(position);
  const ratio = liquidationCushionRatio({
    entryPrice: position?.entryPrice,
    markPrice: position?.markPrice || position?.currentPrice,
    liqPrice,
    direction: position?.direction,
  });

  return ratio != null && ratio <= threshold;
}
