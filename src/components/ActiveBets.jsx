import { useEffect, useState } from 'react';
import { formatDollar, formatPrice } from '../data/mockData';
import { derivePositionLiqPrice, isDangerouslyCloseToLiquidation } from '../services/liquidationRisk';
import ProgressBar from './ProgressBar';
import CoinLogo from './CoinLogo';

const STATUS_CONFIG = {
  winning: { label: 'WINNING', bg: 'var(--green-dim)', border: 'var(--green)', color: 'var(--green)' },
  at_risk: { label: 'AT RISK', bg: 'var(--orange-dim)', border: 'var(--orange)', color: 'var(--orange)' },
  danger:  { label: 'DANGER',  bg: 'var(--red-dim)', border: 'var(--red)', color: 'var(--red)' },
  close:   { label: 'CLOSE',   bg: 'var(--accent-dim)', border: 'var(--accent)', color: 'var(--accent)' },
  opening: { label: 'MATCHED', bg: 'var(--accent-dim)', border: 'var(--accent)', color: 'var(--accent)' },
};

export default function ActiveBets({ bets, onCashOut, onCashOutAll, devMode }) {
  const [now, setNow] = useState(() => Date.now());
  const hasOpenPnlGrace = bets.some(bet => Number(bet.pnlGraceExpiresAt || 0) > now);

  useEffect(() => {
    if (!hasOpenPnlGrace) return undefined;

    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [hasOpenPnlGrace]);

  if (!bets.length) {
    return (
      <div className="empty-bets-stage" aria-live="polite">
        <div className="empty-bets-banner">
          <span className="empty-bets-word">NO POSITIONS YET</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {devMode && (
        <button
          onClick={onCashOutAll}
          style={{
            background: 'var(--red-dim)',
            border: '1px solid var(--red)',
            borderRadius: 8,
            padding: '12px 0',
            color: 'var(--red)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            letterSpacing: 0.5,
          }}
        >Cash Out All ({bets.length})</button>
      )}
      {bets.map(bet => {
        const inOpenPnlGrace = Number(bet.pnlGraceExpiresAt || 0) > now;
        const displayPnl = inOpenPnlGrace ? 0 : bet.pnl;
        const displayPnlPct = inOpenPnlGrace ? 0 : bet.pnlPct;
        const isPositive = inOpenPnlGrace || displayPnl >= 0;
        const dangerClose = !isPositive && isDangerouslyCloseToLiquidation(bet);
        const status = bet.optimistic
          ? STATUS_CONFIG.opening
          : isPositive
            ? STATUS_CONFIG.winning
            : dangerClose
              ? STATUS_CONFIG.danger
              : STATUS_CONFIG.at_risk;
        const statusLabel = bet.optimistic
          ? (bet.optimisticConfirmed ? 'CONFIRMED' : 'MATCHED')
          : status.label;
        const lossColor = dangerClose ? 'var(--red)' : 'var(--orange)';
        const lossBg = dangerClose ? 'var(--red-dim)' : 'var(--orange-dim)';
        const pnlColor = isPositive ? 'var(--green)' : lossColor;
        const cashOutBg = isPositive ? 'var(--green-dim)' : lossBg;
        const liquidationColor = dangerClose ? 'var(--red)' : 'var(--orange)';
        const liquidationDim = dangerClose ? 'var(--red-dim)' : 'var(--orange-dim)';
        const liq = derivePositionLiqPrice(bet);
        const priceDecimals = bet.market?.priceDecimals;
        const cashOutDisabled = Boolean(bet.optimistic);

        return (
          <div key={bet.id} style={{
            background: 'var(--bg-card)',
            border: `1px solid ${status.border}`,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: bet.optimistic ? '6px 6px 0 var(--accent-light)' : 'none',
            animation: bet.optimistic ? 'slide-up 0.2s ease' : undefined,
          }}>
            {/* Status banner */}
            <div style={{
              background: status.bg,
              padding: '8px 16px',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 2,
                color: status.color, textTransform: 'uppercase',
              }}>{statusLabel}</span>
            </div>

            <div style={{ padding: 16 }}>
              {/* Asset + PnL */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <CoinLogo symbol={bet.asset} logoUrl={bet.logo || bet.market?.logo} size={32} />
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
                      Amount ${formatPrice(bet.stake)} · {bet.optimistic
                        ? (bet.optimisticConfirmed ? 'syncing position' : 'confirming on-chain')
                        : (displayPnlPct != null ? `${displayPnlPct.toFixed(1)}% PnL` : '')}
                    </div>
                  </div>
                </div>
                <div style={{
                  fontSize: 24, fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: pnlColor,
                }}>
                  {formatDollar(displayPnl)}
                </div>
              </div>

              {/* Price info */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginBottom: 12, fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Entry </span>
                  <span style={{ color: 'var(--text-secondary)' }}>${formatPrice(bet.entryPrice, priceDecimals)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Current </span>
                  <span style={{ color: pnlColor }}>${formatPrice(bet.markPrice || bet.currentPrice, priceDecimals)}</span>
                </div>
              </div>

              {/* Liq ←→ TP progress */}
              {(() => {
                if (!liq || !bet.entryPrice) return null;
                const hasTp = bet.tpPrice && bet.tpPrice > 0;
                if (!hasTp) {
                  return (
                    <div style={{
                      marginBottom: 16,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}>
                      <span style={{ color: liquidationColor }}>Liq ${formatPrice(liq, priceDecimals)}</span>
                      <span style={{ color: 'var(--text-muted)' }}>No TP</span>
                    </div>
                  );
                }
                return (
                  <div style={{ marginBottom: 16 }}>
                    <ProgressBar
                      liqPrice={liq}
                      tpPrice={bet.tpPrice}
                      markPrice={bet.markPrice || bet.currentPrice}
                      direction={bet.direction}
                      priceDecimals={priceDecimals}
                      liquidationColor={liquidationColor}
                      liquidationDim={liquidationDim}
                    />
                  </div>
                );
              })()}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => onCashOut(bet)}
                  disabled={cashOutDisabled}
                  style={{
                    flex: 2,
                    background: cashOutBg,
                    border: `1px solid ${pnlColor}`,
                    borderRadius: 8,
                    padding: '10px 0',
                    color: pnlColor,
                    fontSize: 13, fontWeight: 600, cursor: cashOutDisabled ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-heading)',
                    opacity: cashOutDisabled ? 0.58 : 1,
                  }}
                >{cashOutDisabled ? 'Confirming...' : `Cash Out (${formatDollar(displayPnl)})`}</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
