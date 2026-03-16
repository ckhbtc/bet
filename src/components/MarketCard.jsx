import Sparkline from './Sparkline';
import { formatPrice } from '../data/mockData';

const ICONS = {
  BTC: '₿', ETH: 'Ξ', SOL: '◎', INJ: '⟠', DOGE: 'Ð', AVAX: '▲',
};

const ICON_COLORS = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', INJ: '#00f2fe', DOGE: '#c3a634', AVAX: '#e84142',
};

export default function MarketCard({ market, onPlaceBet }) {
  const isUp = market.change24h >= 0;

  return (
    <div
      onClick={() => onPlaceBet(market)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-card-hover)';
        e.currentTarget.style.borderColor = 'var(--border-light)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--bg-card)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: `${ICON_COLORS[market.symbol]}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: ICON_COLORS[market.symbol],
          }}>{ICONS[market.symbol] || '●'}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{market.symbol}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{market.name}</div>
          </div>
        </div>
        <Sparkline data={market.sparkline} color={isUp ? 'var(--green)' : 'var(--red)'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            ${formatPrice(market.price)}
          </div>
          <div style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: isUp ? 'var(--green)' : 'var(--red)',
            fontWeight: 500,
          }}>
            {isUp ? '↑' : '↓'} {Math.abs(market.change24h).toFixed(2)}%
          </div>
        </div>
        <button style={{
          background: 'linear-gradient(135deg, #f59e0b, #f97316)',
          color: '#000',
          border: 'none',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-heading)',
          letterSpacing: 0.3,
        }}>
          Place Bet →
        </button>
      </div>
    </div>
  );
}
