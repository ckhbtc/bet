import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { formatUnits, parseUnits } from 'viem';
import {
  executeBridge,
  fetchSourceUsdcBalance,
  fetchInjEvmBalance,
  fetchRouteFees,
  feeBpsToMaxFee,
  findFeeEntry,
  MIN_MINT_GAS_WEI,
  SOURCE_CHAINS,
  INJECTIVE,
  FAST_FINALITY,
} from '../services/bridge';
import { isPositiveTokenAmount, sanitizeDecimalInput } from '../services/bridgeAmount';
import { api } from '../services/api';
import useWalletStore from '../stores/walletStore';

// Best-effort INJ-EVM top-up: balance-check first to avoid hitting the
// faucet's 60s cooldown when the user already has gas, then call the
// server-side faucet. Errors are surfaced via the returned object but
// never throw — the mint can still succeed even if this fails (the user
// may already have INJ from another action).
async function ensureMintGas({ ethAddress, injAddress, signal }) {
  if (!ethAddress || !injAddress) return { ok: false, reason: 'no-wallet' };
  try {
    const bal = await fetchInjEvmBalance(ethAddress);
    if (bal >= MIN_MINT_GAS_WEI) return { ok: true, reason: 'already-funded' };
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    await api.initAccount(injAddress);
    return { ok: true, reason: 'faucet-fired' };
  } catch (err) {
    const msg = err?.message || String(err);
    // "Please wait before retrying" — cooldown is benign, we already
    // fired the faucet recently and the tx will land in time.
    if (msg.includes('Please wait')) return { ok: true, reason: 'cooldown' };
    return { ok: false, reason: msg };
  }
}

// Human-readable status copy keyed by the phase emitted by executeBridge().
const PHASE_COPY = {
  'approve-sign':    'Approve USDC — confirm in wallet',
  'approve-confirm': 'Approving USDC...',
  'burn-sign':       'Burn USDC — confirm in wallet',
  'burn-confirm':    'Burning on source chain...',
  attest:            'Waiting for Circle attestation (1–13 min)...',
  switch:            'Switching wallet to Injective EVM...',
  'mint-sign':       'Mint on Injective — confirm in wallet',
  'mint-confirm':    'Minting native USDC on Injective...',
  success:           'Bridge complete',
};

function shortHash(h) {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '';
}

export default function BridgeModal({ onClose }) {
  const { ethAddress, injAddress, refreshBalances, pollBalancesUntilChange } = useWalletStore();

  const [sourceChainId, setSourceChainId] = useState(SOURCE_CHAINS[0].id);
  const [amount, setAmount] = useState('');
  const [transferMode, setTransferMode] = useState('standard');
  const [bridging, setBridging] = useState(false);
  const [phase, setPhase] = useState(null);
  const [phaseData, setPhaseData] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [srcBalance, setSrcBalance] = useState(null);
  const [balanceErr, setBalanceErr] = useState(null);
  const [fastFee, setFastFee] = useState(null);
  const [fastFeeErr, setFastFeeErr] = useState(null);
  const [chainMenuOpen, setChainMenuOpen] = useState(false);
  const chainMenuRef = useRef(null);

  const sourceChain = useMemo(
    () => SOURCE_CHAINS.find((c) => c.id === sourceChainId) || SOURCE_CHAINS[0],
    [sourceChainId],
  );

  // Pull the source-side USDC balance whenever the chain or wallet changes.
  useEffect(() => {
    let cancelled = false;
    setSrcBalance(null);
    setBalanceErr(null);
    if (!ethAddress) return;
    fetchSourceUsdcBalance(sourceChainId, ethAddress)
      .then((bal) => { if (!cancelled) setSrcBalance(bal); })
      .catch((err) => { if (!cancelled) setBalanceErr(err.shortMessage || err.message); });
    return () => { cancelled = true; };
  }, [sourceChainId, ethAddress]);

  // Close the chain menu on outside click or Escape.
  useEffect(() => {
    if (!chainMenuOpen) return;
    const onDocClick = (e) => {
      if (chainMenuRef.current && !chainMenuRef.current.contains(e.target)) {
        setChainMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setChainMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [chainMenuOpen]);

  // Kick the INJ-EVM faucet in the background as soon as the modal opens.
  // The mint step at the end needs gas; firing now means by the time the
  // attestation poll completes (1–13 min) the user is already funded. The
  // faucet has its own 60s cooldown and "already_funded" short-circuit,
  // so re-opens are cheap.
  useEffect(() => {
    const ctrl = new AbortController();
    ensureMintGas({ ethAddress, injAddress, signal: ctrl.signal }).then((res) => {
      if (!res.ok && res.reason !== 'aborted') {
        console.warn('inj-evm gas pre-fund skipped:', res.reason);
      }
    });
    return () => ctrl.abort();
  }, [ethAddress, injAddress]);

  // Refresh the Fast-CCTP fee quote when the source chain changes. We don't
  // gate UI on it (Standard is still selectable when the quote fails), but
  // the toggle should show what Fast will cost before the user commits.
  useEffect(() => {
    let cancelled = false;
    setFastFee(null);
    setFastFeeErr(null);
    const src = SOURCE_CHAINS.find((c) => c.id === sourceChainId);
    if (!src) return;
    fetchRouteFees(src.domain, INJECTIVE.domain)
      .then((entries) => {
        if (cancelled) return;
        const entry = findFeeEntry(entries, FAST_FINALITY);
        setFastFee(entry || null);
      })
      .catch((err) => { if (!cancelled) setFastFeeErr(err.shortMessage || err.message); });
    return () => { cancelled = true; };
  }, [sourceChainId]);

  const handleBridge = useCallback(async () => {
    if (!isPositiveTokenAmount(amount)) return;
    setError(null); setSuccess(null);
    setBridging(true); setPhase(null); setPhaseData(null);
    try {
      const result = await executeBridge({
        sourceChainId,
        amountHuman: amount,
        senderEvm: ethAddress,
        recipientEvm: ethAddress,
        transferMode,
        onPhase: (p, data) => { setPhase(p); setPhaseData(data || null); },
        // Defensive re-top-up: if attestation took long enough that the
        // mount-time prefund cooldown expired and the wallet still has no
        // INJ, this catches it before the mint signer rejects.
        onBeforeMint: () => ensureMintGas({ ethAddress, injAddress }),
      });
      setSuccess(result);
      // Optimistic kick first so the TopBar pill updates promptly, then
      // poll until the indexer catches up to the freshly-minted amount.
      refreshBalances();
      const expectedDelta = Number(amount) || 0;
      pollBalancesUntilChange({ expectedDelta }).catch(() => {});
    } catch (err) {
      const msg = err.shortMessage || err.message || String(err);
      setError(
        msg.includes('User denied') || msg.includes('user rejected')
          ? 'Transaction cancelled'
          : msg,
      );
    } finally {
      setBridging(false);
    }
  }, [
    amount, sourceChainId, ethAddress, injAddress, transferMode,
    refreshBalances, pollBalancesUntilChange,
  ]);

  const handleMax = () => {
    if (srcBalance && srcBalance > 0n) {
      setAmount(sanitizeDecimalInput(formatUnits(srcBalance, 6)));
      setError(null); setSuccess(null);
    }
  };

  const balanceLabel =
    srcBalance != null
      ? `${Number(formatUnits(srcBalance, 6)).toLocaleString(undefined, {
          minimumFractionDigits: 2, maximumFractionDigits: 6,
        })} USDC`
      : balanceErr
        ? 'unavailable'
        : '…';

  const phaseLabel = phase ? (PHASE_COPY[phase] || phase) : null;

  // Fast-mode fee blurb that sits under the "Fast" pill — shows the route fee
  // either as bps, or (once an amount is entered) as the buffered max-fee in
  // USDC subunits. Falls back to "unavailable" if Circle's quote 500s.
  let fastFeeLabel = 'Confirmed · quote…';
  if (fastFeeErr) {
    fastFeeLabel = 'Unavailable';
  } else if (fastFee) {
    if (fastFee.minimumFee === 0) {
      fastFeeLabel = 'Confirmed · free';
    } else {
      let amountUnits = 0n;
      try { amountUnits = parseUnits(amount || '0', 6); } catch { /* ignore */ }
      if (amountUnits > 0n) {
        const maxFee = feeBpsToMaxFee(amountUnits, fastFee.minimumFee);
        const usdc = Number(formatUnits(maxFee, 6)).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        });
        fastFeeLabel = `Confirmed · ≤ ${usdc} USDC`;
      } else {
        fastFeeLabel = `Confirmed · ${fastFee.minimumFee} bps`;
      }
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !bridging) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'var(--overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        borderRadius: 20, width: '100%', maxWidth: 440,
        animation: 'slide-up 0.25s ease', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 2.5, marginBottom: 4,
            }}>Add funds · CCTP V2</div>
            <div style={{
              fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-heading)',
              letterSpacing: -0.3,
            }}>Bridge USDC to Injective</div>
          </div>
          <button
            onClick={onClose}
            disabled={bridging}
            style={{
              background: 'transparent', border: 'none', fontSize: 24,
              color: 'var(--text-muted)', cursor: bridging ? 'not-allowed' : 'pointer',
              lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* From: chain picker + amount */}
          <div style={{
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 14px', marginBottom: 8,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6,
            }}>
              <span>From</span>
              <span>
                Balance: {balanceLabel}{' '}
                {srcBalance && srcBalance > 0n && (
                  <button
                    onClick={handleMax}
                    disabled={bridging}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--accent)', fontFamily: 'var(--font-mono)',
                      fontSize: 10, padding: 0, textDecoration: 'underline',
                      letterSpacing: 1.5,
                    }}
                  >MAX</button>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div ref={chainMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => !bridging && setChainMenuOpen((o) => !o)}
                  disabled={bridging}
                  aria-haspopup="listbox"
                  aria-expanded={chainMenuOpen}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'transparent', border: 'none', outline: 'none',
                    fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-heading)',
                    color: 'var(--text-primary)',
                    cursor: bridging ? 'not-allowed' : 'pointer',
                    padding: '2px 0', textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}
                >
                  <span>{sourceChain.name}</span>
                  <span style={{
                    fontSize: 10, lineHeight: 1, color: 'var(--text-muted)',
                    transform: chainMenuOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}>▼</span>
                </button>
                {chainMenuOpen && (
                  <div
                    role="listbox"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 8px)',
                      left: 0,
                      zIndex: 300,
                      minWidth: 220,
                      background: 'var(--bg-card)',
                      border: '2px solid var(--border)',
                      boxShadow: '6px 6px 0 var(--accent-light)',
                      padding: 4,
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    {SOURCE_CHAINS.map((c) => {
                      const active = c.id === sourceChainId;
                      return (
                        <button
                          key={c.id}
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            setSourceChainId(c.id);
                            setChainMenuOpen(false);
                          }}
                          onMouseEnter={(e) => {
                            if (!active) e.currentTarget.style.background = 'var(--bg-card-hover)';
                          }}
                          onMouseLeave={(e) => {
                            if (!active) e.currentTarget.style.background = 'transparent';
                          }}
                          style={{
                            background: active ? 'var(--accent-light)' : 'transparent',
                            border: 'none', textAlign: 'left',
                            fontSize: 13, fontWeight: 700,
                            fontFamily: 'var(--font-heading)',
                            color: active ? 'var(--stamp-bg)' : 'var(--text-primary)',
                            cursor: 'pointer',
                            padding: '10px 12px',
                            textTransform: 'uppercase', letterSpacing: 0.5,
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: 12,
                          }}
                        >
                          <span>{c.name}</span>
                          {active && (
                            <span style={{
                              fontSize: 12, fontFamily: 'var(--font-mono)',
                              color: 'var(--accent)',
                            }}>●</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(sanitizeDecimalInput(e.target.value));
                  setError(null); setSuccess(null);
                }}
                disabled={bridging}
                style={{
                  flex: 1, maxWidth: 180, textAlign: 'right',
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </div>
            <div style={{
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              marginTop: 4,
            }}>USDC</div>
          </div>

          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 18, margin: '2px 0' }}>↓</div>

          {/* To: Injective (fixed) */}
          <div style={{
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 14px', marginBottom: 16,
          }}>
            <div style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6,
            }}>To</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-heading)' }}>Injective</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>USDC (native)</div>
              </div>
              <div style={{
                fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: amount ? 'var(--green)' : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {amount || '—'}
              </div>
            </div>
          </div>

          {/* Speed toggle */}
          <div style={{
            display: 'flex', gap: 6, marginBottom: 12,
          }}>
            {[
              { id: 'standard', label: 'Standard', sub: 'Finalized · free' },
              { id: 'fast',     label: 'Fast',     sub: fastFeeLabel },
            ].map((opt) => {
              const active = transferMode === opt.id;
              const disabled = bridging || (opt.id === 'fast' && fastFeeErr);
              return (
                <button
                  key={opt.id}
                  onClick={() => !disabled && setTransferMode(opt.id)}
                  disabled={disabled}
                  style={{
                    flex: 1,
                    background: active ? 'var(--accent-dim)' : 'var(--bg-primary)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '10px 12px',
                    textAlign: 'left',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.55 : 1,
                  }}
                >
                  <div style={{
                    fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-heading)',
                    color: active ? 'var(--accent)' : 'var(--text-primary)',
                  }}>{opt.label}</div>
                  <div style={{
                    fontSize: 10, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)', marginTop: 2,
                  }}>{opt.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Phase indicator */}
          {bridging && phaseLabel && (
            <div style={{
              background: 'var(--accent-dim)', border: '1px solid var(--accent)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
              fontSize: 12, color: 'var(--accent)', textAlign: 'center',
              fontFamily: 'var(--font-mono)',
            }}>
              {phaseLabel}
              {phaseData?.txHash && (
                <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
                  {shortHash(phaseData.txHash)}
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--red-dim)', border: '1px solid var(--red)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
              fontSize: 12, color: 'var(--red)', textAlign: 'center',
            }}>{error}</div>
          )}

          {success && (
            <div style={{
              background: 'var(--green-dim)', border: '1px solid var(--green)',
              borderRadius: 8, padding: 12, marginBottom: 12,
              fontSize: 13, color: 'var(--green)', textAlign: 'center',
              fontFamily: 'var(--font-mono)',
            }}>
              Native USDC arrived on Injective.
              <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>
                burn: <a
                  href={`${success.srcExplorer}/tx/${success.burnHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--green)' }}
                >{shortHash(success.burnHash)}</a>
              </div>
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.85 }}>
                mint: <a
                  href={`https://blockscout.injective.network/tx/${success.mintHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--green)' }}
                >{shortHash(success.mintHash)}</a>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {!success ? (
              <button
                onClick={handleBridge}
                disabled={bridging || !isPositiveTokenAmount(amount) || !ethAddress}
                style={{
                  flex: 1, background: 'var(--accent-grad)',
                  color: 'var(--on-accent)', border: 'none', borderRadius: 10,
                  padding: '14px 0', fontSize: 14, fontWeight: 700,
                  cursor: (bridging || !isPositiveTokenAmount(amount))
                    ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-heading)',
                  opacity: !isPositiveTokenAmount(amount) ? 0.5 : 1,
                }}
              >
                {bridging ? 'Bridging…' : `Bridge from ${sourceChain.name} →`}
              </button>
            ) : (
              <button
                onClick={onClose}
                style={{
                  flex: 1, background: 'var(--green-dim)',
                  border: '1px solid var(--green)',
                  borderRadius: 10, padding: '14px 0', color: 'var(--green)',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font-heading)',
                }}
              >Done</button>
            )}
          </div>

          <div style={{
            fontSize: 11, color: 'var(--text-muted)', textAlign: 'center',
            marginTop: 12, lineHeight: 1.5,
          }}>
            Circle CCTP V2 — burn USDC on the source chain, mint native USDC on
            Injective. You'll need gas on both ends (source chain + a tiny bit of
            INJ for the mint).
          </div>
        </div>
      </div>
    </div>
  );
}
