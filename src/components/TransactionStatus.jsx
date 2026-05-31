import { shortTxHash, txExplorerUrl } from '../services/explorer';

function bannerText(message) {
  return String(message || 'Working').replace(/\.$/, '').toUpperCase();
}

function phaseLabels(message) {
  const lower = String(message || '').toLowerCase();
  if (lower.includes('cash-out')) return ['QUOTE', 'MATCH', 'BROADCAST', 'CONFIRM'];
  if (lower.includes('take profit') || lower.includes('wallet')) return ['WALLET', 'SUBMIT', 'VERIFY'];
  if (lower.includes('matched')) return ['MATCHED', 'BROADCAST', 'CONFIRM'];
  if (lower.includes('revoking')) return ['BUILD', 'SIGN', 'CONFIRM'];
  return ['SUBMIT', 'MATCH', 'CONFIRM'];
}

function ribbonDuration(message) {
  const lower = String(message || '').toLowerCase();
  if (lower.includes('take profit') || lower.includes('wallet')) return '12s';
  return '5.5s';
}

function StatusTxLink({ txHash }) {
  if (!txHash) return null;

  return (
    <a
      href={txExplorerUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      title={txHash}
      aria-label={`View transaction ${txHash} on explorer`}
      className="tx-status-link"
    >
      Tx: {shortTxHash(txHash)}
    </a>
  );
}

function LoadingStatus({ status }) {
  const text = bannerText(status.message);
  const phases = phaseLabels(status.message);
  const duration = ribbonDuration(status.message);

  return (
    <div
      className="tx-loading-stage"
      role="status"
      aria-live="polite"
      aria-label={status.message}
    >
      <div className="tx-loading-ribbon" aria-hidden="true">
        <div
          className="tx-loading-track"
          style={{ '--tx-ribbon-duration': duration }}
        >
          {Array.from({ length: 8 }).map((_, index) => (
            <span className="tx-loading-word" key={index}>
              {text}
            </span>
          ))}
        </div>
      </div>

      <div className="tx-loading-panel">
        <div className="tx-loading-message">
          <span className="tx-loading-dot" />
          <span>{status.message}</span>
        </div>
        <div className="tx-loading-phases" aria-hidden="true">
          {phases.map((phase, index) => (
            <span
              className="tx-loading-phase"
              style={{ animationDelay: `${index * 0.18}s` }}
              key={phase}
            >
              {phase}
            </span>
          ))}
        </div>
        <StatusTxLink txHash={status.txHash} />
      </div>
    </div>
  );
}

function ToastStatus({ status }) {
  return (
    <div className={`tx-status-toast tx-status-${status.type}`}>
      {status.type === 'warning' && '! '}
      {status.message}
      <StatusTxLink txHash={status.txHash} />
    </div>
  );
}

export default function TransactionStatus({ status }) {
  if (!status) return null;
  if (status.type === 'loading') return <LoadingStatus status={status} />;
  return <ToastStatus status={status} />;
}
