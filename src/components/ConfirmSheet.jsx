import { formatPrice, AGGRESSIVENESS } from '../data/mockData';

export default function ConfirmSheet({ bet, onConfirm, onEdit }) {
  const aggrLabel = AGGRESSIVENESS[bet.aggr].label;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        borderRadius: 16, padding: 28, width: '100%', maxWidth: 400,
        animation: 'slide-up 0.25s ease',
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 4 }}>
          Confirm Your Bet
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
          {bet.direction === 'up' ? '🟢' : '🔴'} {bet.market.symbol} going {bet.direction === 'up' ? 'UP' : 'DOWN'}
        </div>

        <div style={{
          background: 'var(--bg-primary)', borderRadius: 10, padding: 16,
          display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16,
          border: '1px solid var(--border)',
        }}>
          {[
            ['Bet', `$${bet.stake}`],
            ['Win', `$${bet.winTarget}`],
            ['Target', `$${formatPrice(bet.targetPrice)}`],
            ['Style', aggrLabel],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{
          background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 20,
          fontSize: 12, color: '#f87171', textAlign: 'center',
        }}>
          Maximum loss: ${bet.stake} (your full bet)
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEdit} style={{
            flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 0', color: 'var(--text-secondary)',
            fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-heading)',
          }}>Edit</button>
          <button onClick={onConfirm} style={{
            flex: 2, background: 'linear-gradient(135deg, #f59e0b, #f97316)',
            border: 'none', borderRadius: 10, padding: '14px 0', color: '#000',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-heading)',
          }}>Lock In Bet 🔒</button>
        </div>
      </div>
    </div>
  );
}
