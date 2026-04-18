import { formatDollar, formatPrice } from '../data/mockData';

const STATUS_CONFIG = {
  winning: { label: 'WINNING', bg: 'var(--green-dim)', border: 'var(--green)', color: 'var(--green)' },
  at_risk: { label: 'AT RISK', bg: 'var(--red-dim)', border: 'var(--red)', color: 'var(--red)' },
  close:   { label: 'CLOSE',   bg: 'var(--accent-dim)', border: 'var(--accent)', color: 'var(--accent)' },
};

export default function ActiveBets({ bets, onCashOut }) {
  if (!bets.length) {
    return (
      <div style={{
        textAlign: 'center', padding: '60px 20px',
        color: 'var(--text-muted)', fontSize: 14,
      }}>
        No active positions. Place your first bet to get started!
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {bets.map(bet => {
        const status = STATUS_CONFIG[bet.status] || STATUS_CONFIG.close;
        const isPositive = bet.pnl >= 0;

        return (
          <div key={bet.id} style={{
            background: 'var(--bg-card)',
            border: `1px solid ${status.border}`,
            borderRadius: 12,
            overflow: 'hidden',
          }}>
            {/* Status banner */}
            <div style={{
              background: status.bg,
              padding: '8px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 2,
                color: status.color, textTransform: 'uppercase',
              }}>{status.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {bet.side?.toUpperCase()} {bet.quantity} {bet.symbol}
              </span>
            </div>

            <div style={{ padding: 16 }}>
              {/* Asset + PnL */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 16,
              }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {bet.direction === 'up' ? '🟢' : '🔴'} {bet.asset}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                      {bet.direction === 'up' ? 'Long' : 'Short'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    Margin ${formatPrice(bet.stake)} · {bet.pnlPct != null ? `${bet.pnlPct.toFixed(1)}% PnL` : ''}
                  </div>
                </div>
                <div style={{
                  fontSize: 24, fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: isPositive ? 'var(--green)' : 'var(--red)',
                }}>
                  {formatDollar(bet.pnl)}
                </div>
              </div>

              {/* Price info */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginBottom: 16, fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Entry </span>
                  <span style={{ color: 'var(--text-secondary)' }}>${formatPrice(bet.entryPrice)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Mark </span>
                  <span style={{ color: isPositive ? 'var(--green)' : 'var(--red)' }}>${formatPrice(bet.markPrice || bet.currentPrice)}</span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => onCashOut(bet)}
                  style={{
                    flex: 2,
                    background: isPositive ? 'var(--green-dim)' : 'var(--red-dim)',
                    border: `1px solid ${isPositive ? 'var(--green)' : 'var(--red)'}`,
                    borderRadius: 8,
                    padding: '10px 0',
                    color: isPositive ? 'var(--green)' : 'var(--red)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--font-heading)',
                  }}
                >Close Position ({formatDollar(bet.pnl)})</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
