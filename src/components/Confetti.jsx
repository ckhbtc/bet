import { useMemo } from 'react';

const COLORS = [
  'var(--green)',
  'var(--accent)',
  'var(--accent-light)',
  '#f59e0b', // amber
  '#60a5fa', // blue
];

/**
 * One-shot confetti burst. Renders a fixed number of falling chips with
 * randomized per-chip timing and trajectory; parent unmounts after ~3s.
 */
export default function Confetti({ count = 80 }) {
  const pieces = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 2.4 + Math.random() * 1.6,
      size: 6 + Math.random() * 8,
      color: COLORS[i % COLORS.length],
      drift: (Math.random() - 0.5) * 30,
      rotate: Math.random() * 360,
    }));
  }, [count]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      pointerEvents: 'none', overflow: 'hidden',
    }}>
      {pieces.map(p => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: -20,
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            borderRadius: 2,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s cubic-bezier(0.3, 0, 0.7, 1) ${p.delay}s forwards`,
            '--drift': `${p.drift}vw`,
          }}
        />
      ))}
    </div>
  );
}
