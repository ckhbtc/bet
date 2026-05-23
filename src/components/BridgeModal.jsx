import { useState, useCallback } from 'react';
import { fetchBridgeQuote, executeBridge } from '../services/bridge';
import { isPositiveTokenAmount, sanitizeDecimalInput } from '../services/bridgeAmount';
import useWalletStore from '../stores/walletStore';

export default function BridgeModal({ onClose }) {
  const { ethAddress, refreshBalances } = useWalletStore();
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [bridging, setBridging] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleQuote = useCallback(async () => {
    if (!isPositiveTokenAmount(amount)) return;
    setError(null); setQuoting(true); setQuote(null);
    try {
      setQuote(await fetchBridgeQuote(amount, ethAddress));
    } catch (err) { setError(err.message); }
    finally { setQuoting(false); }
  }, [amount, ethAddress]);

  const handleBridge = useCallback(async () => {
    if (!isPositiveTokenAmount(amount)) return;
    setError(null); setBridging(true); setSuccess(null);
    try {
      const result = await executeBridge(amount, ethAddress, ethAddress, setStep);
      setSuccess(result);
      setStep('');
      refreshBalances();
    } catch (err) {
      const msg = err.message;
      setError(msg.includes('User denied') || msg.includes('user rejected') ? 'Transaction cancelled' : msg);
      setStep('');
    } finally {
      setBridging(false);
    }
  }, [amount, ethAddress, refreshBalances]);

  const feeEth = quote ? (Number(quote.fixFeeWei) / 1e18).toFixed(5) : null;

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
        borderRadius: 20, width: '100%', maxWidth: 420,
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
            }}>Add funds</div>
            <div style={{
              fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-heading)',
              letterSpacing: -0.3,
            }}>Bridge to Injective</div>
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
          {/* From */}
          <div style={{
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 14px', marginBottom: 8,
          }}>
            <div style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6,
            }}>From</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-heading)' }}>Arbitrum</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>USDC</div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={e => {
                  const v = sanitizeDecimalInput(e.target.value);
                  setAmount(v); setQuote(null); setSuccess(null); setError(null);
                }}
                disabled={bridging}
                style={{
                  flex: 1, maxWidth: 180,
                  textAlign: 'right',
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </div>
          </div>

          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 18, margin: '2px 0' }}>↓</div>

          {/* To */}
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
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>USDC</div>
              </div>
              <div style={{
                fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: quote ? 'var(--green)' : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {quote ? quote.dstAmount : '—'}
              </div>
            </div>
          </div>

          {quote && (
            <div style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 12, marginBottom: 16,
              display: 'flex', flexDirection: 'column', gap: 6,
              fontSize: 12, fontFamily: 'var(--font-mono)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>You send</span>
                <span>{quote.srcAmount} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>You receive</span>
                <span style={{ color: 'var(--green)' }}>~{quote.dstAmount} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Fee (ETH on Arb)</span>
                <span>{feeEth} ETH</span>
              </div>
            </div>
          )}

          {step && (
            <div style={{
              background: 'var(--accent-dim)', border: '1px solid var(--accent)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
              fontSize: 12, color: 'var(--accent)', textAlign: 'center',
            }}>{step}</div>
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
              borderRadius: 8, padding: '12px', marginBottom: 12,
              fontSize: 13, color: 'var(--green)', textAlign: 'center',
            }}>
              Bridged! Tx: <span style={{ fontFamily: 'var(--font-mono)' }}>{success.bridgeTxHash.slice(0, 14)}...</span>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Arrives in ~1–3 min.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {!quote && !success && (
              <button
                onClick={handleQuote}
                disabled={quoting || !isPositiveTokenAmount(amount)}
                style={{
                  flex: 1, background: 'var(--accent-grad)',
                  color: 'var(--on-accent)', border: 'none', borderRadius: 10,
                  padding: '14px 0', fontSize: 14, fontWeight: 700,
                  cursor: (quoting || !amount) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-heading)',
                  opacity: !isPositiveTokenAmount(amount) ? 0.5 : 1,
                }}
              >{quoting ? 'Getting quote...' : 'Get Quote'}</button>
            )}
            {quote && !success && (
              <>
                <button
                  onClick={() => { setQuote(null); setError(null); }}
                  disabled={bridging}
                  style={{
                    flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '14px 0', color: 'var(--text-secondary)',
                    fontSize: 14, fontWeight: 500, cursor: 'pointer',
                    fontFamily: 'var(--font-heading)',
                  }}
                >Edit</button>
                <button
                  onClick={handleBridge}
                  disabled={bridging}
                  style={{
                    flex: 2, background: 'var(--accent-grad)',
                    color: 'var(--on-accent)', border: 'none', borderRadius: 10,
                    padding: '14px 0', fontSize: 14, fontWeight: 700,
                    cursor: bridging ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-heading)',
                  }}
                >{bridging ? 'Bridging...' : 'Bridge →'}</button>
              </>
            )}
            {success && (
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
            Powered by deBridge DLN. You'll need ETH on Arbitrum for gas.
          </div>
        </div>
      </div>
    </div>
  );
}
