import Decimal from 'decimal.js';

// Leaderboard feed (mock — real leaderboard would need indexer queries)
export const LEADERBOARD_FEED = [
  { user: '@degen_dan', amount: 420, asset: 'ETH', direction: '↑' },
  { user: '@whale99', amount: 1200, asset: 'BTC', direction: '↑' },
  { user: '@solsurfer', amount: 85, asset: 'SOL', direction: '↑' },
  { user: '@inj_maxi', amount: 310, asset: 'INJ', direction: '↑' },
  { user: '@moonshot', amount: 2500, asset: 'BTC', direction: '↓' },
  { user: '@cryptokid', amount: 150, asset: 'AVAX', direction: '↑' },
  { user: '@yolo_trader', amount: 600, asset: 'ETH', direction: '↓' },
  { user: '@diamond_hands', amount: 890, asset: 'SOL', direction: '↑' },
];

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
