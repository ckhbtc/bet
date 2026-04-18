import { formatDollar, formatPrice, liquidationPrice } from '../data/mockData';
import ProgressBar from './ProgressBar';
import CoinLogo from './CoinLogo';

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
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 2,
                color: status.color, textTransform: 'uppercase',
              }}>{status.label}</span>
            </div>

            <div style={{ padding: 16 }}>
              {/* Asset + PnL */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <CoinLogo symbol={bet.asset} size={32} />
                  <div>
                    <div style={{
                      fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-heading)',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      {bet.asset}
                      <span style={{
                        fontSize: 13, fontWeight: 700,
                        padding: '4px 10px', borderRadius: 6,
                        background: bet.direction === 'up' ? 'var(--green-dim)' : 'var(--red-dim)',
                        color: bet.direction === 'up' ? 'var(--green)' : 'var(--red)',
                        textTransform: 'uppercase', letterSpacing: 0.6,
                        fontFamily: 'var(--font-heading)',
                        border: `1px solid ${bet.direction === 'up' ? 'var(--green)' : 'var(--red)'}`,
                      }}>
                        {bet.direction === 'up' ? 'Up' : 'Down'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      Amount ${formatPrice(bet.stake)} · {bet.pnlPct != null ? `${bet.pnlPct.toFixed(1)}% PnL` : ''}
                    </div>
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
                marginBottom: 12, fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Entry </span>
                  <span style={{ color: 'var(--text-secondary)' }}>${formatPrice(bet.entryPrice)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Current </span>
                  <span style={{ color: isPositive ? 'var(--green)' : 'var(--red)' }}>${formatPrice(bet.markPrice || bet.currentPrice)}</span>
                </div>
              </div>

              {/* Liq ←→ TP progress */}
              {(() => {
                const lev = (bet.entryPrice && bet.margin && Number(bet.quantity))
                  ? (bet.entryPrice * Number(bet.quantity)) / bet.margin
                  : null;
                const fallbackLiq = (lev && bet.entryPrice)
                  ? liquidationPrice({
                      entryPrice: bet.entryPrice,
                      leverage: lev,
                      direction: bet.direction,
                      mmr: Number(bet.market?.maintenanceMarginRatio) || 0.025,
                    })
                  : null;
                const liq = bet.liqPrice && bet.liqPrice > 0 ? bet.liqPrice : fallbackLiq;
                if (!liq || !bet.entryPrice) return null;
                // Mirror liq distance around entry as a default upside bound when
                // there's no on-chain TP (e.g. positions opened before TP support).
                const isLong = bet.direction === 'up' || bet.direction === 'long';
                const mirrorTp = isLong
                  ? bet.entryPrice + (bet.entryPrice - liq)
                  : bet.entryPrice - (liq - bet.entryPrice);
                const tp = bet.tpPrice && bet.tpPrice > 0 ? bet.tpPrice : mirrorTp;
                return (
                  <div style={{ marginBottom: 16 }}>
                    <ProgressBar
                      liqPrice={liq}
                      tpPrice={tp}
                      markPrice={bet.markPrice || bet.currentPrice}
                      direction={bet.direction}
                      tpIsImplicit={!bet.tpPrice || bet.tpPrice <= 0}
                    />
                  </div>
                );
              })()}

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
