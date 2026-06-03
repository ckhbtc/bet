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
import TransactionStatus from './components/TransactionStatus';
import {
  buildRfqCloseInput,
  primeRfqAccountCache,
  sendRfqPrequoteRequest,
  tradeCloseRfq,
  tradeOpenRfq,
} from './services/rfq';
import { RFQ_PREQUOTE_INTERVAL_MS } from './services/rfqConstants';
import { getOpenTradeStatus } from './services/tradeResult';
import useWalletStore from './stores/walletStore';
import useMarketStore from './stores/marketStore';
import useSessionStore from './stores/sessionStore';
import { nextOpenPnlGraceExpiresAt } from './stores/optimisticPositions';

function latestCachedPrice(marketId, fallback = null) {
  const state = useMarketStore.getState();
  return state.prices[marketId]
    || state.markets.find(market => market.marketId === marketId)?.price
    || fallback;
}

function buildOptimisticOpenPosition(bet) {
  const side = bet.direction === 'up' ? 'long' : 'short';
  const entryPrice = latestCachedPrice(bet.market.marketId, bet.market.price) || bet.market.price || 0;
  const quantity = entryPrice > 0
    ? String((Number(bet.stake) * Number(bet.leverage)) / entryPrice)
    : '0';

  return {
    id: `${bet.market.marketId}_${side}`,
    symbol: bet.market.symbol,
    ticker: bet.market.ticker || bet.market.name || bet.market.marketId,
    marketId: bet.market.marketId,
    market: bet.market,
    side,
    direction: side === 'long' ? 'up' : 'down',
    quantity,
    entryPrice,
    markPrice: entryPrice,
    margin: Number(bet.stake) || 0,
    liqPrice: bet.liqPrice || null,
    tpPrice: bet.targetPrice || null,
    targetMode: bet.targetMode || 'take_profit',
    letItRide: !bet.targetPrice,
    pnl: 0,
    pnlPct: 0,
    stake: Number(bet.stake) || 0,
    currentPrice: entryPrice,
    asset: bet.market.symbol,
    logo: bet.market.logo || '',
    tokenName: bet.market.tokenName || '',
    slug: bet.market.slug || '',
    status: 'opening',
    optimisticConfirmed: false,
  };
}

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

  useEffect(() => {
    if (!connected || !injAddress || !session.rfqReady) return;
    primeRfqAccountCache(injAddress).catch((err) => {
      console.warn('RFQ account cache warmup failed:', err.message || err);
    });
  }, [connected, injAddress, session.rfqReady]);

  useEffect(() => {
    if (!connected || !injAddress || !session.rfqReady || view !== 'bets' || !positions.length) return;

    let cancelled = false;
    const sendCashOutPrequotes = async () => {
      if (cancelled) return;
      const warmupPositions = positions.filter(position => position.market && position.side).slice(0, 8);
      for (const position of warmupPositions) {
        const price = position.markPrice
          || position.currentPrice
          || latestCachedPrice(position.marketId, position.market?.price);
        if (!price || Number(price) <= 0) continue;
        try {
          const input = buildRfqCloseInput({
            market: position.market,
            oraclePrice: price,
            side: position.side,
            quantity: position.quantity,
          });
          await sendRfqPrequoteRequest({
            requestAddress: injAddress,
            marketId: position.marketId,
            ...input,
          });
        } catch {
          // Warmup only; click-time cash-out still validates and reports errors.
        }
      }
    };

    void sendCashOutPrequotes();
    const interval = setInterval(() => {
      void sendCashOutPrequotes();
    }, RFQ_PREQUOTE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connected, injAddress, session.rfqReady, view, positions]);

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

  const submitBet = useCallback(async (bet) => {
    if (!bet || !connected) return;

    const needsTakeProfitSignature = bet.targetPrice && Number(bet.targetPrice) > 0;

    setTxStatus({
      type: 'loading',
      message: 'Order submitted',
    });
    setPendingBet(null);

    let openConfirmed = false;
    let openMatched = false;
    let optimisticPositionId = null;

    const showOptimisticOpen = () => {
      if (openMatched) return;
      openMatched = true;
      const optimisticPosition = buildOptimisticOpenPosition(bet);
      optimisticPositionId = optimisticPosition.id;
      useMarketStore.getState().addOptimisticPosition(optimisticPosition);
      setTxStatus(null);
      setSelectedMarket(null);
      setView('bets');
      setConfetti(true);
      setTimeout(() => setConfetti(false), 3500);
    };

    const settleOpenConfirmed = (result) => {
      if (openConfirmed) return;
      openConfirmed = true;
      if (!openMatched) showOptimisticOpen();
      if (optimisticPositionId) {
        useMarketStore.getState().updateOptimisticPosition(optimisticPositionId, {
          optimisticConfirmed: true,
          txHash: result?.txHash || null,
          pnlGraceExpiresAt: nextOpenPnlGraceExpiresAt(),
        });
      }
      setTxStatus({
        type: needsTakeProfitSignature ? 'info' : 'success',
        message: needsTakeProfitSignature
          ? 'next, confirm the take profit order through your connected wallet'
          : 'Order confirmed.',
        txHash: result?.txHash,
      });
      refreshBalances();
      useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);
    };

    try {
      const result = await tradeOpenRfq({
        granterAddress: injAddress,
        marketId: bet.market.marketId,
        side: bet.direction === 'up' ? 'long' : 'short',
        stakeUsdt: bet.stake,
        leverage: bet.leverage,
        tpPrice: bet.targetPrice,
        market: bet.market,
        oraclePrice: latestCachedPrice(bet.market.marketId, bet.market.price),
        onProgress: ({ phase, result: progressResult }) => {
          if (phase === 'matched') {
            showOptimisticOpen();
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
      if (optimisticPositionId) {
        useMarketStore.getState().removeOptimisticPosition(optimisticPositionId);
      }
      setTxStatus({ type: 'error', message: err.message });
      clearTxStatusSoon();
    }
  }, [connected, injAddress, refreshBalances, clearTxStatusSoon]);

  const handleBetConfirm = useCallback((bet) => {
    const hasTakeProfit = bet.targetPrice && Number(bet.targetPrice) > 0;
    if (bet.targetMode === 'yolo' || !hasTakeProfit) {
      void submitBet(bet);
      return;
    }

    setPendingBet(bet);
  }, [submitBet]);

  const handleLockIn = useCallback(() => {
    void submitBet(pendingBet);
  }, [pendingBet, submitBet]);

  const handleCashOut = useCallback(async (position) => {
    if (!connected || !position.market) return;

    setTxStatus({ type: 'loading', message: 'Submitting cash-out order' });

    let closeConfirmed = false;
    let closeMatched = false;
    const optimisticCloseId = position.id;

    const showOptimisticClose = () => {
      if (closeMatched) return;
      closeMatched = true;
      useMarketStore.getState().addOptimisticClosedPosition(position);
      setTxStatus(null);
      setConfetti(true);
      setTimeout(() => setConfetti(false), 3500);
    };

    const settleCloseConfirmed = (result) => {
      if (closeConfirmed) return;
      closeConfirmed = true;
      if (!closeMatched) showOptimisticClose();
      setTxStatus({
        type: 'success',
        message: 'Cash-out order confirmed',
        txHash: result?.txHash,
      });
      refreshBalances();
      useMarketStore.getState().fetchPositions(useWalletStore.getState().injAddress);
    };

    try {
      const result = await tradeCloseRfq({
        granterAddress: injAddress,
        marketId: position.marketId,
        side: position.side,
        quantity: position.quantity,
        market: position.market,
        oraclePrice: position.markPrice
          || position.currentPrice
          || latestCachedPrice(position.marketId, position.market?.price),
        onProgress: ({ phase, result: progressResult }) => {
          if (phase === 'matched') {
            showOptimisticClose();
          }
          if (phase === 'confirmed') {
            settleCloseConfirmed(progressResult);
          }
        },
      });

      if (!closeConfirmed) settleCloseConfirmed(result);

      clearTxStatusSoon();
    } catch (err) {
      if (closeMatched) {
        useMarketStore.getState().removeOptimisticClosedPosition(optimisticCloseId, position);
      }
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
      setTxStatus({ type: 'loading', message: `Cash out ${i + 1}/${list.length}: ${pos.asset}...` });
      try {
        await tradeCloseRfq({
          granterAddress: injAddress,
          marketId: pos.marketId,
          side: pos.side,
          quantity: pos.quantity,
          market: pos.market,
          oraclePrice: pos.markPrice
            || pos.currentPrice
            || latestCachedPrice(pos.marketId, pos.market?.price),
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
      <TransactionStatus status={txStatus} />

      <div style={{
        flex: 1, display: 'flex', maxWidth: 1200,
        margin: '0 auto', width: '100%', padding: '24px 24px', gap: 18,
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
                    Re-authorize autosign to place bets.
                  </div>
                )}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
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
                  requestAddress={injAddress}
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
