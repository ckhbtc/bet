import { useState, useCallback, useEffect } from 'react';

const THEMES = ['bauhaus', 'bauhaus-dark'];
const readInitialTheme = () => {
  if (typeof document === 'undefined') return 'bauhaus';
  const attr = document.documentElement.dataset.theme;
  return THEMES.includes(attr) ? attr : 'bauhaus';
};
import TopBar from './components/TopBar';
import MarketCard from './components/MarketCard';
import BetPanel from './components/BetPanel';
import ConfirmSheet from './components/ConfirmSheet';
import ActiveBets from './components/ActiveBets';
import BetResult from './components/BetResult';
import AuthZSetup from './components/AuthZSetup';
import BridgeModal from './components/BridgeModal';
import Confetti from './components/Confetti';
import { tradeCloseRfq, tradeOpenRfq } from './services/rfq';
import { shortTxHash, txExplorerUrl } from './services/explorer';
import { getOpenTradeStatus } from './services/tradeResult';
import useWalletStore from './stores/walletStore';
import useMarketStore from './stores/marketStore';
import useSessionStore from './stores/sessionStore';

export default function App() {
  const [view, setView] = useState('home');
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [pendingBet, setPendingBet] = useState(null);
  const [showResult, setShowResult] = useState(null);
  const [txStatus, setTxStatus] = useState(null); // { type: 'loading'|'success'|'warning'|'error', message, txHash? }
  const [confetti, setConfetti] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [theme, setTheme] = useState(readInitialTheme);
  const [devMode, setDevMode] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('bet-dev-mode') === '1';
  });

  // Sync theme to <html data-theme> + localStorage
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('bet-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const setThemeTo = useCallback((next) => {
    if (THEMES.includes(next)) setTheme(next);
  }, []);

  // D-E-V keystroke (sequence within ~1.5s, ignored while typing in form fields) toggles devMode.
  useEffect(() => {
    let buf = '';
    let timer = null;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      buf = (buf + e.key.toUpperCase()).slice(-3);
      if (buf === 'DEV') {
        setDevMode(d => {
          const next = !d;
          try { localStorage.setItem('bet-dev-mode', next ? '1' : '0'); } catch { /* ignore */ }
          return next;
        });
        buf = '';
      }
      clearTimeout(timer);
      timer = setTimeout(() => { buf = ''; }, 1500);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, []);

  const { connected, injAddress, usdcBalance, refreshBalances } = useWalletStore();
  const { markets, positions, loading, startPolling, stopPolling } = useMarketStore();
  const session = useSessionStore();

  const clearTxStatusSoon = useCallback(() => {
    setTimeout(() => setTxStatus(null), 5000);
  }, []);

  // Re-validate the session token against the currently-connected wallet.
  // Prevents a stale sessionToken (bound to a prior granter) from being
  // treated as active after the user swaps MetaMask accounts.
  useEffect(() => {
    useSessionStore.getState().refresh(injAddress);
  }, [injAddress]);

  // Start polling when wallet connects
  useEffect(() => {
    if (connected && injAddress) {
      startPolling(injAddress);
      return () => stopPolling();
    }
  }, [connected, injAddress, startPolling, stopPolling]);


  const handlePlaceBet = useCallback((market) => {
    setSelectedMarket(market);
  }, []);

  const handleBetConfirm = useCallback((bet) => {
    setPendingBet(bet);
  }, []);

  const handleLockIn = useCallback(async () => {
    if (!pendingBet || !connected) return;

    setTxStatus({
      type: 'loading',
      message: 'Order submitted',
    });
    setPendingBet(null);

    let openConfirmed = false;
    const settleOpenConfirmed = (result) => {
      if (openConfirmed) return;
      openConfirmed = true;
      setTxStatus({
        type: 'success',
        message: 'Order confirmed.',
        txHash: result?.txHash,
      });
      setSelectedMarket(null);
      setView('bets');
      setConfetti(true);
      setTimeout(() => setConfetti(false), 3500);
      refreshBalances();
      useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);
    };

    try {
      const result = await tradeOpenRfq({
        granterAddress: injAddress,
        marketId: pendingBet.market.marketId,
        side: pendingBet.direction === 'up' ? 'long' : 'short',
        stakeUsdt: pendingBet.stake,
        leverage: pendingBet.leverage,
        tpPrice: pendingBet.targetPrice,
        onProgress: ({ phase, result: progressResult }) => {
          if (phase === 'matched') {
            setTxStatus({ type: 'loading', message: 'Order matched.' });
          }
          if (phase === 'confirmed') {
            settleOpenConfirmed(progressResult);
          }
        },
      });

      const status = getOpenTradeStatus(result);
      if (!openConfirmed) settleOpenConfirmed(result);
      setTxStatus(status);

      clearTxStatusSoon();
    } catch (err) {
      setTxStatus({ type: 'error', message: err.message });
      clearTxStatusSoon();
    }
  }, [pendingBet, connected, injAddress, refreshBalances, clearTxStatusSoon]);

  const handleCashOut = useCallback(async (position) => {
    if (!connected || !position.market) return;

    setTxStatus({ type: 'loading', message: 'Requesting RFQ cash-out quote...' });

    try {
      const result = await tradeCloseRfq({
        granterAddress: injAddress,
        marketId: position.marketId,
        side: position.side,
        quantity: position.quantity,
      });

      setTxStatus({
        type: 'success',
        message: 'Position closed!',
        txHash: result.txHash,
      });

      refreshBalances();
      useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);

      clearTxStatusSoon();
    } catch (err) {
      setTxStatus({ type: 'error', message: err.message });
      clearTxStatusSoon();
    }
  }, [connected, injAddress, refreshBalances, clearTxStatusSoon]);

  // Sequential close — avoids nonce races on the same wallet. One failure
  // doesn't abort the rest; the final toast summarizes successes vs failures.
  const handleCashOutAll = useCallback(async () => {
    if (!connected) return;
    const list = useMarketStore.getState().positions.filter(p => p.market);
    if (!list.length) return;
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      const pos = list[i];
      setTxStatus({ type: 'loading', message: `RFQ cash out ${i + 1}/${list.length}: ${pos.asset}...` });
      try {
        await tradeCloseRfq({
          granterAddress: injAddress,
          marketId: pos.marketId,
          side: pos.side,
          quantity: pos.quantity,
        });
        ok += 1;
      } catch (err) {
        fail += 1;
        console.error(`cash-out-all: ${pos.asset} failed`, err);
      }
    }
    setTxStatus({
      type: fail === 0 ? 'success' : 'error',
      message: fail === 0
        ? `Closed ${ok} position${ok === 1 ? '' : 's'}`
        : `Closed ${ok}, ${fail} failed`,
    });
    refreshBalances();
    useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);
    clearTxStatusSoon();
  }, [connected, injAddress, refreshBalances, clearTxStatusSoon]);

  const handleRevokeAutosign = useCallback(async () => {
    if (!connected || !injAddress || session.revoking) return;

    setTxStatus({ type: 'loading', message: 'Revoking autosign...' });
    try {
      const result = await session.revoke(injAddress);
      setTxStatus({
        type: 'success',
        message: result.txHash
          ? 'Autosign revoked.'
          : 'Autosign cleared.',
        txHash: result.txHash || null,
      });
      clearTxStatusSoon();
    } catch (err) {
      setTxStatus({ type: 'error', message: err.message });
      clearTxStatusSoon();
    }
  }, [connected, injAddress, session, clearTxStatusSoon]);

  return (
    <>
      <TopBar
        onNavigate={setView}
        currentView={view}
        theme={theme}
        onSetTheme={setThemeTo}
        onAddFunds={() => setShowBridge(true)}
        onRevokeAutosign={handleRevokeAutosign}
        sessionActive={session.active}
        revokingAutosign={session.revoking}
        devMode={devMode}
      />

      {/* Transaction status toast */}
      {confetti && <Confetti />}

      {txStatus && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          zIndex: 300, padding: '12px 24px', borderRadius: 10,
          background: txStatus.type === 'loading' ? 'var(--bg-card)'
            : txStatus.type === 'success' ? 'var(--green-dim)'
            : txStatus.type === 'warning' ? 'var(--accent-dim)'
            : 'var(--red-dim)',
          border: `1px solid ${txStatus.type === 'loading' ? 'var(--border)'
            : txStatus.type === 'success' ? 'var(--green)'
            : txStatus.type === 'warning' ? 'var(--accent)'
            : 'var(--red)'}`,
          color: txStatus.type === 'loading' ? 'var(--text-primary)'
            : txStatus.type === 'success' ? 'var(--green)'
            : txStatus.type === 'warning' ? 'var(--accent)'
            : 'var(--red)',
          fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-heading)',
          animation: 'slide-up 0.3s ease',
          maxWidth: 400,
        }}>
          {txStatus.type === 'warning' && '! '}{txStatus.message}
          {txStatus.txHash && (
            <>
              {' '}
              <a
                href={txExplorerUrl(txStatus.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                title={txStatus.txHash}
                aria-label={`View transaction ${txStatus.txHash} on explorer`}
                style={{
                  color: 'inherit',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Tx: {shortTxHash(txStatus.txHash)}
              </a>
            </>
          )}
        </div>
      )}

      <div style={{
        flex: 1, display: 'flex', maxWidth: 1200,
        margin: '0 auto', width: '100%', padding: '24px 24px', gap: 24,
      }}>
        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {connected && !session.active && !selectedMarket && (
            <div style={{ marginBottom: 24 }}>
              <AuthZSetup />
            </div>
          )}

          {view === 'home' && !selectedMarket && (
            <>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>Markets</h1>
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {loading ? 'Loading markets...' : connected ? 'Pick an asset and place your bet' : 'Connect wallet to start trading'}
                </p>
                {connected && session.active && !session.rfqReady && (
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8 }}>
                    Re-authorize autosign to place RFQ bets.
                  </div>
                )}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
                gap: 12,
              }}>
                {markets.map(market => (
                  <MarketCard key={market.id} market={market} onPlaceBet={handlePlaceBet} />
                ))}
              </div>
              {markets.length === 0 && !loading && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  {connected ? 'No markets available' : 'Connect your wallet to see live markets'}
                </div>
              )}
            </>
          )}

          {view === 'home' && selectedMarket && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 20 }}>
              {!connected ? (
                <div style={{
                  textAlign: 'center', padding: '40px 20px',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 16, maxWidth: 400, width: '100%',
                }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Connect Wallet</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                    Connect MetaMask or Rabby to place bets on {selectedMarket.symbol}
                  </div>
                  <button
                    onClick={() => useWalletStore.getState().connect()}
                    style={{
                      background: 'var(--accent-grad)',
                      border: 'none', borderRadius: 10, padding: '14px 28px',
                      color: 'var(--on-accent)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'var(--font-heading)',
                    }}
                  >Connect Wallet</button>
                </div>
              ) : !session.active ? (
                <AuthZSetup />
              ) : (
                <BetPanel
                  market={selectedMarket}
                  balance={usdcBalance}
                  rfqReady={session.rfqReady}
                  onConfirm={handleBetConfirm}
                  onClose={() => setSelectedMarket(null)}
                />
              )}
            </div>
          )}

          {view === 'bets' && (
            <>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>My Bets</h1>
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {positions.length} active position{positions.length !== 1 ? 's' : ''}
                </p>
              </div>
              {connected ? (
                <ActiveBets
                  bets={positions}
                  onCashOut={handleCashOut}
                  onCashOutAll={handleCashOutAll}
                  devMode={devMode}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
                  Connect wallet to see your positions.
                </div>
              )}
            </>
          )}

        </div>

        {/* Sidebar — active positions summary */}
        {view === 'home' && !selectedMarket && positions.length > 0 && (
          <div style={{ width: 280, flexShrink: 0 }}>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 16, position: 'sticky', top: 100,
            }}>
              <div style={{
                fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: 2, marginBottom: 12,
              }}>Active Positions</div>
              {positions.slice(0, 3).map(pos => (
                <div key={pos.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {pos.asset}
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 4,
                        background: pos.direction === 'up' ? 'var(--green-dim)' : 'var(--red-dim)',
                        color: pos.direction === 'up' ? 'var(--green)' : 'var(--red)',
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        fontFamily: 'var(--font-heading)',
                      }}>
                        {pos.direction === 'up' ? 'Up' : 'Down'}
                      </span>
                    </span>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      ${pos.stake.toFixed(2)} bet
                    </div>
                  </div>
                  <span style={{
                    fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: pos.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                  }}>
                    {pos.pnl >= 0 ? '+' : '-'}${Math.abs(pos.pnl).toFixed(2)}
                  </span>
                </div>
              ))}
              <button
                onClick={() => setView('bets')}
                style={{
                  width: '100%', marginTop: 12, background: 'var(--bg-primary)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 0', color: 'var(--accent)', fontSize: 12,
                  fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-heading)',
                }}
              >View All Positions →</button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {pendingBet && (
        <ConfirmSheet
          bet={pendingBet}
          onConfirm={handleLockIn}
          onEdit={() => setPendingBet(null)}
        />
      )}

      {showResult && (
        <BetResult
          bet={showResult}
          onPlaceAnother={() => { setShowResult(null); setView('home'); }}
          onGoHome={() => { setShowResult(null); setView('home'); }}
        />
      )}

      {showBridge && <BridgeModal onClose={() => setShowBridge(false)} />}
    </>
  );
}
