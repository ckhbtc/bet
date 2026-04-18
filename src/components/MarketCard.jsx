import Sparkline from './Sparkline';
import { formatPrice } from '../data/mockData';

// Token logos from injective-lists (Cloudflare imagedelivery CDN).
// Falls back to a colored letter circle for symbols we don't have mapped.
const LOGO_URLS = {
  BTC:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/f51ce0dd-54de-4b65-8b2b-09579b6c6600/public',
  ETH:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/0d22b678-a78f-4e64-5a7d-d9bd0f261f00/public',
  INJ:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/7123d071-0def-459a-16b9-d85e8ea04700/public',
  SOL:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/a2bb754a-3f7f-4652-da38-4e794980d100/public',
  ATOM:  'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/68519b3d-1179-45f3-711d-be5d2ec00e00/public',
  DOGE:  'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/9773f275-556f-428e-3046-8b2cbf2dcf00/public',
  AVAX:  'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/d0b10151-092a-4f7b-cf76-781be1a45600/public',
  XRP:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/153e4222-ffce-4d4b-bba8-426fe65ad700/public',
  ADA:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/63a231c0-d1c3-4901-1e28-7c4410dfaa00/public',
  BNB:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/f24123a4-23f4-4da2-6b0a-b922b2c31d00/public',
  MATIC: 'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/30af3213-4378-4c47-c017-a087abe58100/public',
  LINK:  'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/48ce8388-6443-4e88-5782-1f32a91e7900/public',
  UNI:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/0d63897a-76b3-4690-e375-247f2cdbcb00/public',
  TIA:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/323dfe0d-e86a-491a-afc0-08bc95951f00/public',
  SUI:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/18aebfd9-1113-4e65-7eb2-7db0516d3000/public',
  APT:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/9d427282-2108-425b-89ce-d4b102678300/public',
  OP:    'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/73f024fe-8303-4e42-f5bd-49f124f38900/public',
  ARB:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/236dc6df-55b9-443a-cea2-b5434af9c800/public',
  DOT:   'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/ae6f1c3d-8d28-4850-072a-eef053cd4c00/public',
  USDT:  'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/e46e1742-fb16-4393-cc40-83b20e875400/public',
  USDC:  'https://imagedelivery.net/lPzngbR8EltRfBOi_WYaXw/c09b0eff-fd4a-4756-e5c9-f6bf8ac0c900/public',
};

function CoinLogo({ symbol, size = 36 }) {
  const url = LOGO_URLS[symbol];
  if (url) {
    return (
      <img
        src={url}
        alt={symbol}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', display: 'block' }}
        loading="lazy"
      />
    );
  }
  // Fallback: first letter on a muted disc
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--bg-card-hover)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 600,
      color: 'var(--text-secondary)',
    }}>
      {symbol[0]}
    </div>
  );
}

export default function MarketCard({ market, onPlaceBet }) {
  const isUp = market.change24h >= 0;

  return (
    <div
      onClick={() => onPlaceBet(market)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-card-hover)';
        e.currentTarget.style.borderColor = 'var(--border-light)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--bg-card)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CoinLogo symbol={market.symbol} size={36} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{market.symbol}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{market.name}</div>
          </div>
        </div>
        <Sparkline data={market.sparkline} color={isUp ? 'var(--green)' : 'var(--red)'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            ${formatPrice(market.price)}
          </div>
          <div style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: isUp ? 'var(--green)' : 'var(--red)',
            fontWeight: 500,
          }}>
            {isUp ? '↑' : '↓'} {Math.abs(market.change24h).toFixed(2)}%
          </div>
        </div>
        <button style={{
          background: 'var(--accent-grad)',
          color: 'var(--on-accent)',
          border: 'none',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-heading)',
          letterSpacing: 0.3,
        }}>
          Place Bet →
        </button>
      </div>
    </div>
  );
}
