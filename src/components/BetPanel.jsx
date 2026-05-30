import { useState, useMemo } from 'react';
import Sparkline from './Sparkline';
import { formatPrice, AGGRESSIVENESS, liquidationPrice } from '../data/mockData';

const QUICK_STAKES = [10, 25, 50, 100, 250];

export default function BetPanel({
  market,
  balance,
  rfqReady = true,
  onConfirm,
  onClose,
}) {
  const [direction, setDirection] = useState('up');
  // Kept as strings so the input can be truly empty while typing;
  // numeric operations use the *Num derived values below.
  const [stake, setStake] = useState('50');
  const [winTarget, setWinTarget] = useState('100');
  const [aggr, setAggr] = useState('BALANCED');

  const aggrConfig = AGGRESSIVENESS[aggr];
  const priceDecimals = market.priceDecimals;
  const stakeNum = Number(stake) || 0;
  const winTargetNum = Number(winTarget) || 0;
  const safeStake = Math.max(1, stakeNum);
  const safeWinTarget = Math.max(1, winTargetNum);

  const targetPrice = useMemo(() => {
    const lev = aggrConfig.leverage;
    if (direction === 'up') {
      return market.price * (1 + (safeWinTarget / (safeStake * lev)));
    }
    return market.price * (1 - (safeWinTarget / (safeStake * lev)));
  }, [market.price, safeStake, safeWinTarget, aggrConfig.leverage, direction]);

  const liqPrice = useMemo(() => liquidationPrice({
    entryPrice: market.price,
    leverage: aggrConfig.leverage,
    direction,
    mmr: Number(market.maintenanceMarginRatio) || 0.025,
  }), [market.price, market.maintenanceMarginRatio, aggrConfig.leverage, direction]);

  const sanitizeIntInput = (raw) => raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');

  const handleStakeInput = (raw) => {
    const clean = sanitizeIntInput(raw);
    setStake(clean);
    // Auto-suggest 2× win target while the user is typing the stake, but don't
    // clobber a target they've already set meaningfully different from 2×.
    if (clean !== '') setWinTarget(String(Number(clean) * 2));
    else setWinTarget('');
  };

  const handleStakeButton = (val) => {
    const clamped = Math.max(0, Math.floor(val));
    setStake(String(clamped));
    setWinTarget(String(Math.max(1, clamped * 2)));
  };

  const handleWinTargetInput = (raw) => {
    setWinTarget(sanitizeIntInput(raw));
  };

  // Short positions whose required move >= 100% would need price to hit zero
  // (or negative). At low leverage with a big win target this happens often;
  // surface it as "out of reach" instead of a meaningless $0 target.
  const requiredMove = safeWinTarget / (safeStake * aggrConfig.leverage);
  const unreachable = direction === 'down' ? requiredMove >= 1 : false;

  const canPlaceBet = stakeNum >= 1 && winTargetNum >= 1 && stakeNum <= balance
    && !isNaN(targetPrice) && targetPrice > 0 && !unreachable
    && rfqReady;

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 420,
      animation: 'slide-up 0.3s ease',
    }}>
      {/* Asset header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
          }}>Betting on</div>
          <div style={{
            fontSize: 22, fontWeight: 700, letterSpacing: -0.3,
            fontFamily: 'var(--font-heading)', lineHeight: 1.1,
          }}>{market.symbol}</div>
          <div style={{
            fontSize: 22, fontWeight: 700, letterSpacing: -0.5,
            fontFamily: 'var(--font-heading)', color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums', marginTop: 4,
          }}>${formatPrice(market.price, priceDecimals)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <Sparkline data={market.sparkline} width={100} height={40} color={market.change24h >= 0 ? 'var(--green)' : 'var(--red)'} />
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-muted)', fontSize: 11, padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
          }}>← Back</button>
        </div>
      </div>

      {/* Direction toggle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {['up', 'down'].map(dir => {
          const active = direction === dir;
          const color = dir === 'up' ? 'var(--green)' : 'var(--red)';
          return (
            <button
              key={dir}
              onClick={() => setDirection(dir)}
              style={{
                background: active
                  ? (dir === 'up' ? 'var(--green-dim)' : 'var(--red-dim)')
                  : 'var(--bg-primary)',
                border: `2px solid ${active ? color : 'var(--border)'}`,
                borderRadius: 10,
                padding: '14px 16px',
                cursor: 'pointer',
                color: active ? color : 'var(--text-muted)',
                fontSize: 15,
                fontWeight: 600,
                fontFamily: 'var(--font-heading)',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              <span style={{
                fontSize: 20, fontWeight: 800, lineHeight: 1,
                fontFamily: 'var(--font-heading)',
                color: active ? color : 'var(--text-muted)',
              }}>
                {dir === 'up' ? '↑' : '↓'}
              </span>
              <span>{dir === 'up' ? 'Up' : 'Down'}</span>
            </button>
          );
        })}
      </div>

      {/* Stake */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', marginBottom: 6,
        }}>I want to bet</label>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 20, fontWeight: 600, color: 'var(--text-muted)',
          }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={stake}
            onChange={e => handleStakeInput(e.target.value)}
            placeholder="0"
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 14px 14px 32px', color: 'var(--text-primary)',
              fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-heading)',
              fontVariantNumeric: 'tabular-nums', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {QUICK_STAKES.map(amt => (
            <button
              key={amt}
              onClick={() => handleStakeButton(amt)}
              style={{
                flex: 1, background: stakeNum === amt ? 'var(--accent-dim)' : 'var(--bg-primary)',
                border: `1px solid ${stakeNum === amt ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6, padding: '6px 0', color: stakeNum === amt ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-heading)',
              }}
            >${amt}</button>
          ))}
        </div>
      </div>

      {/* Win target */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', marginBottom: 6,
        }}>I want to win</label>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 20, fontWeight: 600, color: 'var(--text-muted)',
          }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={winTarget}
            onChange={e => handleWinTargetInput(e.target.value)}
            placeholder="0"
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 14px 14px 32px', color: 'var(--green)',
              fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-heading)',
              fontVariantNumeric: 'tabular-nums', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Aggressiveness */}
      <div style={{ marginBottom: 20 }}>
        <label style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', marginBottom: 8,
        }}>Aggressiveness</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {Object.entries(AGGRESSIVENESS).map(([key, config]) => (
            <button
              key={key}
              onClick={() => setAggr(key)}
              style={{
                background: aggr === key ? `${config.color}15` : 'var(--bg-primary)',
                border: `1px solid ${aggr === key ? config.color : 'var(--border)'}`,
                borderRadius: 8, padding: '10px 8px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: aggr === key ? config.color : 'var(--text-muted)', fontFamily: 'var(--font-heading)' }}>
                {config.label}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{config.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Target price */}
      {unreachable ? (
        <div style={{
          background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 8,
          padding: '14px 16px', marginBottom: 12, textAlign: 'center',
          fontSize: 13, color: 'var(--accent)', lineHeight: 1.5,
          fontFamily: 'var(--font-heading)',
        }}>
          {aggrConfig.label} leverage can't reach this win.
          Try a higher aggressiveness or a smaller win target.
        </div>
      ) : (
        <div style={{
          background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '12px 16px', marginBottom: 12, textAlign: 'center',
        }}>
          <div style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
          }}>
            {market.symbol} needs to reach
          </div>
          <div style={{
            fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-heading)',
            letterSpacing: -0.5, color: 'var(--accent)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            ${formatPrice(targetPrice, priceDecimals)}
          </div>
        </div>
      )}

      {/* Validation warnings */}
      {stakeNum > balance && (
        <div style={{
          background: 'var(--red-dim)', border: '1px solid var(--red)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          fontSize: 12, color: 'var(--red)', textAlign: 'center',
        }}>
          Insufficient balance. You have ${balance.toLocaleString()}.
        </div>
      )}

      {!rfqReady && (
        <div style={{
          background: 'var(--accent-dim)', border: '1px solid var(--accent)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          fontSize: 12, color: 'var(--accent)', textAlign: 'center', lineHeight: 1.5,
        }}>
          RFQ needs updated autosign permissions. Revoke autosign, then authorize again.
        </div>
      )}

      {/* Risk line */}
      {!unreachable && (
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
          marginBottom: 16, lineHeight: 1.6,
        }}>
          If {market.symbol} reaches{' '}
          <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
            ${formatPrice(liqPrice, priceDecimals)}
          </span>{' '}before{' '}
          <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
            ${formatPrice(targetPrice, priceDecimals)}
          </span>, you may lose your ${stakeNum} bet.
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => canPlaceBet && onConfirm({ market, direction, stake: stakeNum, winTarget: winTargetNum, aggr, targetPrice, liqPrice })}
        disabled={!canPlaceBet}
        style={{
          width: '100%',
          background: canPlaceBet ? 'var(--accent-grad)' : 'var(--bg-primary)',
          color: canPlaceBet ? 'var(--on-accent)' : 'var(--text-muted)',
          border: canPlaceBet ? 'none' : '1px solid var(--border)',
          borderRadius: 10, padding: '16px 0',
          fontSize: 16, fontWeight: 700,
          cursor: canPlaceBet ? 'pointer' : 'not-allowed',
          fontFamily: 'var(--font-heading)',
          letterSpacing: 0.5,
          opacity: canPlaceBet ? 1 : 0.5,
        }}
      >
        Place Bet →
      </button>
    </div>
  );
}
