import useSessionStore from '../stores/sessionStore';
import useWalletStore from '../stores/walletStore';

export default function AuthZSetup() {
  const { granting, status, error, grant } = useSessionStore();
  const { injAddress, ethAddress } = useWalletStore();

  const handleGrant = () => grant({ injAddress, ethAddress }).catch(() => {});

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: 28,
      maxWidth: 480,
      width: '100%',
      margin: '40px auto',
      animation: 'slide-up 0.25s ease',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 6 }}>
        One-time setup
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, fontFamily: 'var(--font-heading)' }}>
        Enable autosign
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
        Sign once to authorize trading from this app for 3 days — no wallet popup per bet.
      </div>

      <ul style={{
        fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7,
        padding: 0, margin: '0 0 20px 0', listStyle: 'none',
      }}>
        <li>· Funds stay in your wallet</li>
        <li>· Permission limited to derivative trading messages</li>
        <li>· Auto-expires in 3 days, revoke anytime</li>
        <li>· Gas-free trading via fee delegation</li>
      </ul>

      <button
        onClick={handleGrant}
        disabled={granting || !injAddress}
        style={{
          width: '100%',
          background: granting ? 'var(--bg-primary)' : 'var(--accent-grad)',
          color: granting ? 'var(--text-muted)' : 'var(--on-accent)',
          border: granting ? '1px solid var(--border)' : 'none',
          borderRadius: 10, padding: '14px 0',
          fontSize: 15, fontWeight: 700, cursor: granting ? 'wait' : 'pointer',
          fontFamily: 'var(--font-heading)', letterSpacing: 0.3,
        }}
      >
        {granting ? 'Signing...' : 'Authorize & Continue'}
      </button>

      {status && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
          {status}
        </div>
      )}
      {error && (
        <div style={{
          fontSize: 12, color: 'var(--red)', background: 'var(--red-dim)',
          border: '1px solid var(--red)', borderRadius: 8,
          padding: '8px 12px', marginTop: 12, textAlign: 'center',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
