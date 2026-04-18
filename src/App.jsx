import { useState, useCallback, useEffect } from 'react';

const readInitialTheme = () => {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.dataset.theme;
  return attr === 'light' || attr === 'dark' ? attr : 'dark';
};
import TopBar from './components/TopBar';
import MarketCard from './components/MarketCard';
import BetPanel from './components/BetPanel';
import ConfirmSheet from './components/ConfirmSheet';
import ActiveBets from './components/ActiveBets';
import BetResult from './components/BetResult';
import AuthZSetup from './components/AuthZSetup';
import { AGGRESSIVENESS } from './data/mockData';
import { api } from './services/api';
import useWalletStore from './stores/walletStore';
import useMarketStore from './stores/marketStore';
import useSessionStore from './stores/sessionStore';

export default function App() {
  const [view, setView] = useState('home');
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [pendingBet, setPendingBet] = useState(null);
  const [showResult, setShowResult] = useState(null);
  const [txStatus, setTxStatus] = useState(null); // { type: 'loading'|'success'|'error', message }
  const [theme, setTheme] = useState(readInitialTheme);

  // Sync theme to <html data-theme> + localStorage
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('bet-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }, []);

  const { connected, injAddress, usdtBalance, refreshBalances } = useWalletStore();
  const { markets, positions, loading, startPolling, stopPolling } = useMarketStore();
  const session = useSessionStore();

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

    const aggrConfig = AGGRESSIVENESS[pendingBet.aggr];

    setTxStatus({ type: 'loading', message: 'Placing trade...' });
    setPendingBet(null);

    try {
      const result = await api.tradeOpen({
        marketId: pendingBet.market.marketId,
        side: pendingBet.direction === 'up' ? 'long' : 'short',
        stakeUsdt: pendingBet.stake,
        leverage: aggrConfig.leverage,
        tpPrice: pendingBet.targetPrice,
      });

      setTxStatus({ type: 'success', message: `Trade placed! Tx: ${result.txHash.slice(0, 12)}...` });
      setSelectedMarket(null);
      setView('bets');

      refreshBalances();
      useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);

      setTimeout(() => setTxStatus(null), 5000);
    } catch (err) {
      setTxStatus({ type: 'error', message: err.message });
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [pendingBet, connected, refreshBalances]);

  const handleCashOut = useCallback(async (position) => {
    if (!connected || !position.market) return;

    setTxStatus({ type: 'loading', message: 'Closing position...' });

    try {
      const result = await api.tradeClose({
        marketId: position.marketId,
        side: position.side,
        quantity: position.quantity,
      });

      setShowResult({
        ...position,
        txHash: result.txHash,
      });
      setTxStatus({ type: 'success', message: `Position closed! Tx: ${result.txHash.slice(0, 12)}...` });

      refreshBalances();
      useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);

      setTimeout(() => setTxStatus(null), 5000);
    } catch (err) {
      setTxStatus({ type: 'error', message: err.message });
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connected, refreshBalances]);

  return (
    <>
      <TopBar onNavigate={setView} currentView={view} theme={theme} onToggleTheme={toggleTheme} />

      {/* Transaction status toast */}
      {txStatus && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          zIndex: 300, padding: '12px 24px', borderRadius: 10,
          background: txStatus.type === 'loading' ? 'var(--bg-card)'
            : txStatus.type === 'success' ? 'var(--green-dim)'
            : 'var(--red-dim)',
          border: `1px solid ${txStatus.type === 'loading' ? 'var(--border)'
            : txStatus.type === 'success' ? 'var(--green)'
            : 'var(--red)'}`,
          color: txStatus.type === 'loading' ? 'var(--text-primary)'
            : txStatus.type === 'success' ? 'var(--green)'
            : 'var(--red)',
          fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-heading)',
          animation: 'slide-up 0.3s ease',
          maxWidth: 400,
        }}>
          {txStatus.type === 'loading' && '⏳ '}{txStatus.message}
        </div>
      )}

      <div style={{
        flex: 1, display: 'flex', maxWidth: 1200,
        margin: '0 auto', width: '100%', padding: '24px 24px', gap: 24,
      }}>
        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {view === 'home' && !selectedMarket && (
            <>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>Markets</h1>
                <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {loading ? 'Loading markets...' : connected ? 'Pick an asset and place your bet' : 'Connect wallet to start trading'}
                </p>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
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
                  balance={usdtBalance}
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
                <ActiveBets bets={positions} onCashOut={handleCashOut} />
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
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {pos.direction === 'up' ? '🟢' : '🔴'} {pos.asset}
                    </span>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      ${pos.stake.toFixed(2)} margin
                    </div>
                  </div>
                  <span style={{
                    fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: pos.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                  }}>
                    {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
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
    </>
  );
}
