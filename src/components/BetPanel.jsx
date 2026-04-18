import { useState, useMemo } from 'react';
import Sparkline from './Sparkline';
import { formatPrice, AGGRESSIVENESS } from '../data/mockData';

const QUICK_STAKES = [10, 25, 50, 100, 250];

export default function BetPanel({ market, balance, onConfirm, onClose }) {
  const [direction, setDirection] = useState('up');
  const [stake, setStake] = useState(50);
  const [winTarget, setWinTarget] = useState(100);
  const [aggr, setAggr] = useState('BALANCED');

  const aggrConfig = AGGRESSIVENESS[aggr];
  const safeStake = Math.max(1, stake);
  const safeWinTarget = Math.max(1, winTarget);

  const targetPrice = useMemo(() => {
    const lev = aggrConfig.leverage;
    if (direction === 'up') {
      return market.price * (1 + (safeWinTarget / (safeStake * lev)));
    }
    return market.price * (1 - (safeWinTarget / (safeStake * lev)));
  }, [market.price, safeStake, safeWinTarget, aggrConfig.leverage, direction]);

  const handleStakeChange = (val) => {
    const clamped = Math.max(0, Math.floor(val));
    setStake(clamped);
    setWinTarget(Math.max(1, clamped * 2));
  };

  const handleWinTargetChange = (val) => {
    setWinTarget(Math.max(0, Math.floor(val)));
  };

  const canPlaceBet = stake >= 1 && winTarget >= 1 && stake <= balance && !isNaN(targetPrice) && targetPrice > 0;

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
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 2 }}>Betting on</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{market.symbol}</div>
          <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>${formatPrice(market.price)}</div>
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
        {['up', 'down'].map(dir => (
          <button
            key={dir}
            onClick={() => setDirection(dir)}
            style={{
              background: direction === dir
                ? (dir === 'up' ? 'var(--green-dim)' : 'var(--red-dim)')
                : 'var(--bg-primary)',
              border: `2px solid ${direction === dir
                ? (dir === 'up' ? 'var(--green)' : 'var(--red)')
                : 'var(--border)'}`,
              borderRadius: 10,
              padding: '14px 16px',
              cursor: 'pointer',
              color: direction === dir
                ? (dir === 'up' ? 'var(--green)' : 'var(--red)')
                : 'var(--text-muted)',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'var(--font-heading)',
              transition: 'all 0.15s',
            }}
          >
            {dir === 'up' ? `🟢 ${market.symbol} Goes Up` : `🔴 ${market.symbol} Goes Down`}
          </button>
        ))}
      </div>

      {/* Stake */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>I want to bet</label>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 20, fontWeight: 600, color: 'var(--text-muted)',
          }}>$</span>
          <input
            type="number"
            value={stake}
            onChange={e => handleStakeChange(Number(e.target.value))}
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 14px 14px 32px', color: 'var(--text-primary)',
              fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {QUICK_STAKES.map(amt => (
            <button
              key={amt}
              onClick={() => handleStakeChange(amt)}
              style={{
                flex: 1, background: stake === amt ? 'var(--accent-dim)' : 'var(--bg-primary)',
                border: `1px solid ${stake === amt ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6, padding: '6px 0', color: stake === amt ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-mono)',
              }}
            >${amt}</button>
          ))}
        </div>
      </div>

      {/* Win target */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>I want to win</label>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 20, fontWeight: 600, color: 'var(--text-muted)',
          }}>$</span>
          <input
            type="number"
            value={winTarget}
            onChange={e => handleWinTargetChange(Number(e.target.value))}
            style={{
              width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 14px 14px 32px', color: 'var(--green)',
              fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Aggressiveness */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Aggressiveness</label>
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
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '12px 16px', marginBottom: 12, textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          {market.symbol} needs to reach
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
          ${formatPrice(targetPrice)}
        </div>
      </div>

      {/* Validation warnings */}
      {stake > balance && (
        <div style={{
          background: 'var(--red-dim)', border: '1px solid var(--red)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          fontSize: 12, color: 'var(--red)', textAlign: 'center',
        }}>
          Insufficient balance. You have ${balance.toLocaleString()}.
        </div>
      )}

      {/* Risk line */}
      <div style={{
        fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
        marginBottom: 16, lineHeight: 1.6,
      }}>
        If {market.symbol} doesn't reach ${formatPrice(targetPrice)}, you lose your ${stake} bet.
      </div>

      {/* CTA */}
      <button
        onClick={() => canPlaceBet && onConfirm({ market, direction, stake, winTarget, aggr, targetPrice })}
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
