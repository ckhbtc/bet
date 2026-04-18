import { formatPrice } from '../data/mockData';

export default function ProgressBar({ entryPrice, targetPrice, currentPrice, direction }) {
  const totalDistance = Math.abs(targetPrice - entryPrice);
  const currentDistance = direction === 'up'
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  const progress = Math.max(0, Math.min(100, (currentDistance / totalDistance) * 100));
  const isPositive = currentDistance > 0;

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        marginBottom: 6,
      }}>
        <span>Entry ${formatPrice(entryPrice)}</span>
        <span>Target ${formatPrice(targetPrice)}</span>
      </div>
      <div style={{
        height: 8,
        background: 'var(--bg-primary)',
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: isPositive ? 'var(--green)' : 'var(--red)',
          borderRadius: 4,
          transition: 'width 0.5s ease',
        }} />
        <div style={{
          position: 'absolute',
          left: `${progress}%`,
          top: -3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: isPositive ? 'var(--green)' : 'var(--red)',
          border: '2px solid var(--bg-card)',
          transform: 'translateX(-50%)',
        }} />
      </div>
      <div style={{
        textAlign: 'center',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        marginTop: 4,
      }}>
        Now ${formatPrice(currentPrice)} — {progress.toFixed(0)}% to target
      </div>
    </div>
  );
}
