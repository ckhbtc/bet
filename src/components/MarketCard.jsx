import Sparkline from './Sparkline';
import CoinLogo from './CoinLogo';
import { formatPrice } from '../data/mockData';

export default function MarketCard({ market, onPlaceBet }) {
  const isUp = market.change24h >= 0;

  return (
    <div
      className="bauhaus-deco"
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
        position: 'relative',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CoinLogo symbol={market.symbol} logoUrl={market.logo} size={40} />
          <div>
            <div style={{
              fontSize: 18, fontWeight: 700, letterSpacing: -0.3,
              fontFamily: 'var(--font-heading)',
              lineHeight: 1.2,
            }}>{market.symbol}</div>
            <div style={{
              fontSize: 10, fontWeight: 500,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              marginTop: 2,
            }}>{market.name}</div>
          </div>
        </div>
        <Sparkline data={market.sparkline} color={isUp ? 'var(--green)' : 'var(--red)'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{
            fontSize: 30, fontWeight: 700, letterSpacing: -1,
            fontFamily: 'var(--font-heading)',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            ${formatPrice(market.price)}
          </div>
          <div style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: isUp ? 'var(--green)' : 'var(--red)',
            fontWeight: 500,
            marginTop: 6,
          }}>
            {isUp ? '↑' : '↓'} {Math.abs(market.change24h).toFixed(2)}%
          </div>
        </div>
        <button style={{
          background: 'var(--accent-grad)',
          color: 'var(--on-accent)',
          border: 'none',
          borderRadius: 8,
          padding: '10px 18px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-heading)',
          letterSpacing: 0.2,
        }}>
          Place Bet →
        </button>
      </div>
    </div>
  );
}
