import { formatPrice } from '../data/mockData';
import { formatLeverage } from '../services/leverageLimits';
import CoinLogo from './CoinLogo';

export default function ConfirmSheet({ bet, onConfirm, onEdit }) {
  const aggrLabel = bet.aggrLabel || bet.aggr || 'Medium';
  const aggrColor = bet.aggrColor || '#f59e0b';
  const leverageLabel = bet.leverage ? `${formatLeverage(bet.leverage)}x` : null;
  const isUp = bet.direction === 'up';
  const color = isUp ? 'var(--green)' : 'var(--red)';
  const colorDim = isUp ? 'var(--green-dim)' : 'var(--red-dim)';
  const multiplier = bet.stake > 0 ? bet.winTarget / bet.stake : 0;
  const priceDecimals = bet.market.priceDecimals;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        borderRadius: 20, padding: 0, width: '100%', maxWidth: 420,
        animation: 'slide-up 0.25s ease',
        overflow: 'hidden',
      }}>
        {/* Hero: direction tint with coin + verdict */}
        <div style={{
          background: `linear-gradient(180deg, ${colorDim}, transparent)`,
          padding: '24px 28px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 2.5, marginBottom: 14,
          }}>
            Confirm your bet
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <CoinLogo symbol={bet.market.symbol} logoUrl={bet.market.logo} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 22, fontWeight: 700,
                fontFamily: 'var(--font-heading)', letterSpacing: -0.3,
                lineHeight: 1.1,
              }}>
                {bet.market.symbol}
              </div>
              <div style={{
                fontSize: 13, fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)', marginTop: 2,
                fontVariantNumeric: 'tabular-nums',
              }}>
                ${formatPrice(bet.market.price, priceDecimals)}
              </div>
            </div>
            <span style={{
              fontSize: 14, fontWeight: 800,
              padding: '8px 14px', borderRadius: 8,
              background: colorDim,
              color,
              textTransform: 'uppercase', letterSpacing: 1.2,
              fontFamily: 'var(--font-heading)',
              border: `1px solid ${color}`,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 16, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                {isUp ? '↑' : '↓'}
              </span>
              {isUp ? 'Up' : 'Down'}
            </span>
          </div>
        </div>

        <div style={{ padding: '20px 28px' }}>
          {/* Hero numbers: bet → win, with multiplier chip */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center', gap: 12, marginBottom: 16,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4,
              }}>You bet</div>
              <div style={{
                fontSize: 28, fontWeight: 700,
                fontFamily: 'var(--font-heading)', letterSpacing: -0.5,
                fontVariantNumeric: 'tabular-nums',
              }}>${bet.stake}</div>
            </div>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                fontSize: 18, color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)', lineHeight: 1,
              }}>→</span>
              {multiplier > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 999,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {multiplier.toFixed(multiplier < 10 ? 1 : 0)}×
                </span>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4,
              }}>To win</div>
              <div style={{
                fontSize: 28, fontWeight: 700,
                fontFamily: 'var(--font-heading)', letterSpacing: -0.5,
                color: 'var(--green)',
                fontVariantNumeric: 'tabular-nums',
              }}>${bet.winTarget}</div>
            </div>
          </div>

          {/* Target + style row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto',
            gap: 10, marginBottom: 16,
          }}>
            <div style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 14px',
            }}>
              <div style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 2,
              }}>Target price</div>
              <div style={{
                fontSize: 16, fontWeight: 700,
                fontFamily: 'var(--font-heading)', color: 'var(--accent)',
                fontVariantNumeric: 'tabular-nums',
              }}>${formatPrice(bet.targetPrice, priceDecimals)}</div>
            </div>
            <div style={{
              background: `${aggrColor}15`, border: `1px solid ${aggrColor}`,
              borderRadius: 10, padding: '10px 14px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              minWidth: 100,
            }}>
              <div style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 2,
              }}>Style</div>
              <div style={{
                fontSize: 14, fontWeight: 700,
                fontFamily: 'var(--font-heading)', color: aggrColor,
              }}>{aggrLabel}</div>
              {leverageLabel && (
                <div style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)', marginTop: 2,
                }}>{leverageLabel}</div>
              )}
            </div>
          </div>

          {/* Risk line */}
          <div style={{
            background: 'var(--red-dim)', border: '1px solid var(--red)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 20,
            fontSize: 12, color: 'var(--red)', textAlign: 'center', lineHeight: 1.5,
          }}>
            If {bet.market.symbol} reaches{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              ${formatPrice(bet.liqPrice, priceDecimals)}
            </span>{' '}before{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              ${formatPrice(bet.targetPrice, priceDecimals)}
            </span>, you may lose your ${bet.stake} bet.
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onEdit} style={{
              flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 0', color: 'var(--text-secondary)',
              fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-heading)',
            }}>Edit</button>
            <button onClick={onConfirm} style={{
              flex: 2, background: 'var(--accent-grad)',
              border: 'none', borderRadius: 10, padding: '14px 0', color: 'var(--on-accent)',
              fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-heading)',
              letterSpacing: 0.3,
            }}>Lock In Bet 🔒</button>
          </div>
        </div>
      </div>
    </div>
  );
}
