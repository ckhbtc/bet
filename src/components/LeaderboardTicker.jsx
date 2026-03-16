import { LEADERBOARD_FEED } from '../data/mockData';

export default function LeaderboardTicker() {
  const items = [...LEADERBOARD_FEED, ...LEADERBOARD_FEED];

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      overflow: 'hidden',
      height: 36,
      display: 'flex',
      alignItems: 'center',
    }}>
      <div style={{
        display: 'flex',
        gap: 32,
        animation: 'ticker-scroll 30s linear infinite',
        whiteSpace: 'nowrap',
        paddingLeft: 16,
      }}>
        {items.map((item, i) => (
          <span key={i} style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
          }}>
            <span style={{ color: 'var(--accent)' }}>{item.user}</span>
            {' won '}
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>${item.amount}</span>
            {' on '}
            <span style={{ color: 'var(--text-primary)' }}>{item.asset} {item.direction}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
