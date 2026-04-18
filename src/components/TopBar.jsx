import useWalletStore from '../stores/walletStore';

export default function TopBar({ onNavigate, currentView, theme, onToggleTheme }) {
  const { connected, connecting, ethAddress, injAddress, usdtBalance, connect, error } = useWalletStore();

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
            style={{ width: 28, height: 28, display: 'block' }}
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
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="theme-toggle-thumb">
            <span className="icon-sun">☀</span>
            <span className="icon-moon">☾</span>
          </span>
        </button>
        {connected ? (
          <>
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
                padding: '6px 12px',
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: 'pointer',
                fontSize: 12, fontWeight: 500, color: '#fff',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {ethAddress.slice(0, 6)}...{ethAddress.slice(-4)}
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
