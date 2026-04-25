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


export const AGGRESSIVENESS = {
  CHILL: { leverage: 2, label: 'Chill', desc: 'Big swing required', color: '#4a9eff' },
  BALANCED: { leverage: 10, label: 'Balanced', desc: 'Moderate move needed', color: '#f59e0b' },
  DEGEN: { leverage: 25, label: 'Degen', desc: 'Small price move wins', color: '#ef4444' },
};

export function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

export function formatDollar(amount) {
  const sign = amount >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

// Cross-margin perpetual liquidation price.
// long:  entry * (1 - 1/lev + MMR)
// short: entry * (1 + 1/lev - MMR)
export function liquidationPrice({ entryPrice, leverage, direction, mmr = 0.025 }) {
  if (!entryPrice || !leverage) return null;
  const dirSign = direction === 'up' || direction === 'long' ? 1 : -1;
  return entryPrice * (1 - dirSign * (1 / leverage - mmr));
}
