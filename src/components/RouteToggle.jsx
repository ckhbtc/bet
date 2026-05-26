const ROUTES = [
  { id: 'orderbook', label: 'Book' },
  { id: 'rfq', label: 'RFQ' },
];

export default function RouteToggle({ value, onChange, compact = false }) {
  return (
    <div
      role="group"
      aria-label="Trade route"
      style={{
        display: 'inline-grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
        padding: 4,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        minWidth: compact ? 132 : 168,
      }}
    >
      {ROUTES.map(route => {
        const active = value === route.id;
        return (
          <button
            key={route.id}
            type="button"
            onClick={() => onChange(route.id)}
            aria-pressed={active}
            style={{
              background: active ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
              borderRadius: 6,
              padding: compact ? '6px 10px' : '8px 12px',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: compact ? 12 : 13,
              fontWeight: 700,
              fontFamily: 'var(--font-heading)',
              letterSpacing: 0.4,
            }}
          >
            {route.label}
          </button>
        );
      })}
    </div>
  );
}
