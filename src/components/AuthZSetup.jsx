import useSessionStore from '../stores/sessionStore';

export default function AuthZSetup({ onAuthorize, onClose }) {
  const { granting } = useSessionStore();

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 250,
        background: 'var(--overlay)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        animation: 'modal-fade-in 0.18s ease',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="authorize-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '3px solid var(--border)',
          borderRadius: 0,
          padding: '32px 34px 34px',
          maxWidth: 480,
          width: '100%',
          boxShadow: '10px 10px 0 var(--border)',
          animation: 'modal-pop-in 0.2s ease',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss authorization"
          style={{
            position: 'absolute',
            top: 14,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 30,
            lineHeight: 1,
            fontFamily: 'var(--font-heading)',
          }}
        >
          x
        </button>

        <div style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 5,
          marginBottom: 10,
          fontFamily: 'var(--font-mono)',
        }}>
          One-time setup
        </div>

        <div
          id="authorize-title"
          style={{
            fontSize: 30,
            fontWeight: 700,
            marginBottom: 12,
            fontFamily: 'var(--font-heading)',
            lineHeight: 1.05,
          }}
        >
          Authorize Wallet
        </div>

        <div style={{
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.45,
          marginBottom: 20,
        }}>
          Sign once to place bets without a wallet popup every time.
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 24,
        }}>
          {['Funds stay put', 'Revoke anytime'].map((label) => (
            <div
              key={label}
              style={{
                border: '2px solid var(--border)',
                padding: '10px 12px',
                fontSize: 13,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-heading)',
                textAlign: 'center',
              }}
            >
              {label}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onAuthorize}
          disabled={granting}
          style={{
            width: '100%',
            background: granting ? 'var(--bg-primary)' : 'var(--accent-grad)',
            color: granting ? 'var(--text-muted)' : 'var(--on-accent)',
            border: granting ? '2px solid var(--border)' : '2px solid var(--accent)',
            borderRadius: 0,
            padding: '17px 0',
            fontSize: 17,
            fontWeight: 700,
            cursor: granting ? 'wait' : 'pointer',
            fontFamily: 'var(--font-heading)',
          }}
        >
          {granting ? 'Authorizing...' : 'Authorize Wallet'}
        </button>
      </div>
    </div>
  );
}
