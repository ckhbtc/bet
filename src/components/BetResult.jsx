import { formatPrice } from '../data/mockData';

export default function BetResult({ bet, onPlaceAnother, onGoHome }) {
  const isWin = bet.pnl >= 0;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: isWin ? 'var(--green-dim)' : 'var(--red-dim)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200,
    }}>
      {/* Confetti for wins */}
      {isWin && Array.from({ length: 20 }).map((_, i) => (
        <div key={i} style={{
          position: 'fixed',
          left: `${Math.random() * 100}%`,
          top: -20,
          width: 8, height: 8,
          borderRadius: 2,
          background: ['#f59e0b', '#22c55e', '#4a9eff', '#f97316', '#a855f7'][i % 5],
          animation: `confetti-fall ${2 + Math.random() * 2}s linear ${Math.random() * 1}s forwards`,
          opacity: 0.8,
        }} />
      ))}

      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        borderRadius: 20, padding: 36, width: '100%', maxWidth: 400,
        textAlign: 'center', animation: 'slide-up 0.3s ease',
        position: 'relative', zIndex: 1,
      }}>
        {isWin ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--green)', marginBottom: 4 }}>
              You Won!
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)', marginBottom: 16 }}>
              +${bet.pnl.toFixed(2)}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 8, filter: 'grayscale(0.5)' }}>💸</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Bet Lost
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
              ${Math.abs(bet.pnl).toFixed(2)} lost. Better luck next time.
            </div>
          </>
        )}

        {/* Receipt */}
        <div style={{
          background: 'var(--bg-primary)', borderRadius: 10, padding: 14,
          border: '1px solid var(--border)', marginBottom: 20,
          textAlign: 'left',
        }}>
          {[
            [bet.direction === 'up' ? '🟢' : '🔴', `${bet.asset} ${bet.direction === 'up' ? 'Up' : 'Down'}`],
            ['Bet', `$${bet.stake}`],
            ['Entry', `$${formatPrice(bet.entryPrice)}`],
            ['Close', `$${formatPrice(bet.currentPrice)}`],
            ['P&L', `${bet.pnl >= 0 ? '+' : ''}$${bet.pnl.toFixed(2)}`],
          ].map(([label, value], i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 0',
              borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
              <span style={{
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
                color: i === 4 ? (bet.pnl >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-primary)',
              }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onGoHome} style={{
            flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 0', color: 'var(--text-secondary)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-heading)',
          }}>Home</button>
          {isWin && (
            <button
              onClick={() => {
                const text = `I just won +$${bet.pnl.toFixed(2)} betting ${bet.asset} ${bet.direction === 'up' ? '📈' : '📉'} on INJ Bet!`;
                if (navigator.share) {
                  navigator.share({ text }).catch(() => {});
                } else {
                  navigator.clipboard.writeText(text).catch(() => {});
                }
              }}
              style={{
                flex: 1, background: 'rgba(74, 158, 255, 0.1)', border: '1px solid var(--blue)',
                borderRadius: 10, padding: '12px 0', color: 'var(--blue)',
                fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-heading)',
              }}
            >Share Win</button>
          )}
          <button onClick={onPlaceAnother} style={{
            flex: 1, background: 'var(--accent-grad)',
            border: 'none', borderRadius: 10, padding: '12px 0', color: 'var(--on-accent)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-heading)',
          }}>Bet Again</button>
        </div>
      </div>
    </div>
  );
}
