import { formatPrice } from '../data/mockData';

/**
 * Bidirectional progress: left edge = liquidation, right edge = take-profit.
 * Fill grows from the center toward whichever edge the current mark is closer to,
 * so the user sees at a glance which side is winning.
 */
export default function ProgressBar({ liqPrice, tpPrice, markPrice, direction }) {
  if (liqPrice == null || tpPrice == null || markPrice == null) return null;

  const isLong = direction === 'up' || direction === 'long';

  // For a long: liq (low) ← mark → tp (high). For a short: tp (low) ← mark → liq (high).
  const low = isLong ? liqPrice : tpPrice;
  const high = isLong ? tpPrice : liqPrice;
  const span = high - low;
  if (span <= 0) return null;

  const clamped = Math.max(low, Math.min(high, markPrice));
  const pct = ((clamped - low) / span) * 100;
  const markerPct = Math.max(2, Math.min(98, pct));

  const liqOnLeft = isLong;

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)', marginBottom: 6,
      }}>
        <span style={{ color: liqOnLeft ? 'var(--red)' : 'var(--green)' }}>
          {liqOnLeft ? 'Liq' : 'TP'} ${formatPrice(low)}
        </span>
        <span style={{ color: liqOnLeft ? 'var(--green)' : 'var(--red)' }}>
          {liqOnLeft ? 'TP' : 'Liq'} ${formatPrice(high)}
        </span>
      </div>

      <div style={{
        position: 'relative', height: 8,
        borderRadius: 4, overflow: 'hidden',
        background: liqOnLeft
          ? 'linear-gradient(to right, var(--red-dim), var(--bg-primary) 50%, var(--green-dim))'
          : 'linear-gradient(to right, var(--green-dim), var(--bg-primary) 50%, var(--red-dim))',
      }}>
        <div style={{
          position: 'absolute',
          left: `${markerPct}%`, top: -2,
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--text-primary)',
          border: '2px solid var(--bg-card)',
          transform: 'translateX(-50%)',
          transition: 'left 0.4s ease',
        }} />
      </div>

      <div style={{
        textAlign: 'center', fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)', marginTop: 6,
      }}>
        Mark ${formatPrice(markPrice)}
      </div>
    </div>
  );
}
