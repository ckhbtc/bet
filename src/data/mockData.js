import Decimal from 'decimal.js';
import {
  normalizePriceDecimals,
  priceDecimalsFromTickSize,
} from '../services/pricePrecision.js';

export { priceDecimalsFromTickSize };

export function formatPrice(price, decimals = null) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '0.00';

  const normalizedDecimals = normalizePriceDecimals(decimals);
  if (normalizedDecimals != null) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: normalizedDecimals,
      maximumFractionDigits: normalizedDecimals,
    });
  }

  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

export function formatDollar(amount) {
  const sign = amount >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function formatUsdcBalance(amount, decimals = 2) {
  try {
    const n = new Decimal(amount || 0);
    if (!n.isFinite()) return '0.00';

    return n
      .toDecimalPlaces(decimals, Decimal.ROUND_DOWN)
      .toNumber()
      .toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  } catch {
    return '0.00';
  }
}

// Cross-margin perpetual liquidation price.
// long:  entry * (1 - 1/lev + MMR)
// short: entry * (1 + 1/lev - MMR)
export function liquidationPrice({ entryPrice, leverage, direction, mmr = 0.025 }) {
  if (!entryPrice || !leverage) return null;
  const dirSign = direction === 'up' || direction === 'long' ? 1 : -1;
  return entryPrice * (1 - dirSign * (1 / leverage - mmr));
}
