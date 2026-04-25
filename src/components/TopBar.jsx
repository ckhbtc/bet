import useWalletStore from '../stores/walletStore';

const THEME_SEGS = [
  { id: 'light',   glyph: '☀', label: 'Light' },
  { id: 'dark',    glyph: '☾', label: 'Dark' },
  { id: 'bauhaus', glyph: '◐', label: 'Bauhaus' },
];

export default function TopBar({ onNavigate, currentView, theme, onSetTheme, onAddFunds }) {
  const { connected, connecting, ethAddress, injAddress, usdtBalance, connect, disconnect, error } = useWalletStore();

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      height: 56,
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => onNavigate('home')}>
          <img
            src="/iso.png"
            alt="INJ Bet"
            width={28}
            height={28}
            style={{ width: 28, height: 28, display: 'block', borderRadius: '50%' }}
          />
          <span style={{
            fontSize: 16, fontWeight: 700, letterSpacing: -0.5,
            fontFamily: 'var(--font-heading)',
          }}>INJ Bet</span>
        </div>

        <nav style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'home', label: 'Markets' },
            { id: 'bets', label: 'My Bets' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                background: currentView === item.id ? 'var(--accent-dim)' : 'transparent',
                color: currentView === item.id ? 'var(--accent)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                transition: 'all 0.15s',
              }}
            >{item.label}</button>
          ))}
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="theme-toggle" role="group" aria-label="Theme">
          {THEME_SEGS.map(seg => (
            <button
              key={seg.id}
              type="button"
              onClick={() => onSetTheme(seg.id)}
              className={`seg ${theme === seg.id ? 'on' : ''}`}
              aria-pressed={theme === seg.id}
              aria-label={`${seg.label} theme`}
              title={`${seg.label} theme`}
            >
              {seg.glyph}
            </button>
          ))}
        </div>
        {connected ? (
          <>
            <button
              onClick={onAddFunds}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '6px 12px',
                color: 'var(--accent)',
                fontSize: 12, fontWeight: 600,
                fontFamily: 'var(--font-heading)',
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >+ Add funds</button>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 14px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Balance</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                ${usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div
              title={injAddress}
              style={{
                background: 'var(--blue-grad)',
                borderRadius: 8,
                display: 'flex', alignItems: 'center',
                overflow: 'hidden',
                fontSize: 12, fontWeight: 500, color: '#fff',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span style={{ padding: '6px 10px 6px 12px' }}>
                {ethAddress.slice(0, 6)}...{ethAddress.slice(-4)}
              </span>
              <button
                onClick={disconnect}
                title="Disconnect wallet"
                aria-label="Disconnect wallet"
                style={{
                  background: 'rgba(0,0,0,0.2)',
                  border: 'none', borderLeft: '1px solid rgba(255,255,255,0.18)',
                  color: '#fff', cursor: 'pointer',
                  padding: '6px 10px',
                  fontSize: 14, lineHeight: 1,
                  fontFamily: 'var(--font-mono)',
                }}
              >✕</button>
            </div>
          </>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            style={{
              background: connecting ? 'var(--bg-primary)' : 'linear-gradient(135deg, #f59e0b, #f97316)',
              color: connecting ? 'var(--text-muted)' : 'var(--on-accent)',
              border: connecting ? '1px solid var(--border)' : 'none',
              borderRadius: 8,
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 600,
              cursor: connecting ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-heading)',
            }}
          >
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
      </div>
    </header>
  );
}
