import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVerifiedDerivativeMarkets } from '../src/services/injective.js';

test('normalizeVerifiedDerivativeMarkets keeps active verified USDC perps', () => {
  const markets = normalizeVerifiedDerivativeMarkets({
    data: [
      {
        marketId: '0xverified',
        ticker: 'DOGE/USDC PERP',
        marketStatus: 'active',
        isPerpetual: true,
        isVerified: true,
        quoteToken: { symbol: 'USDC' },
        baseToken: {
          name: 'Dogecoin',
          symbol: 'DOGE',
          logo: 'https://example.com/doge.png',
        },
        slug: 'doge-usdc-perp',
      },
      {
        marketId: '0xhidden',
        ticker: 'HIDDEN/USDC PERP',
        marketStatus: 'active',
        isPerpetual: true,
        isVerified: false,
        quoteToken: { symbol: 'USDC' },
        baseToken: { symbol: 'HIDDEN' },
      },
      {
        marketId: '0xpaused',
        ticker: 'PAUSED/USDC PERP',
        marketStatus: 'paused',
        isPerpetual: true,
        isVerified: true,
        quoteToken: { symbol: 'USDC' },
        baseToken: { symbol: 'PAUSED' },
      },
      {
        marketId: '0xusdt',
        ticker: 'OLD/USDT PERP',
        marketStatus: 'active',
        isPerpetual: true,
        isVerified: true,
        quoteToken: { symbol: 'USDT' },
        baseToken: { symbol: 'OLD' },
      },
    ],
  });

  assert.deepEqual(markets, [
    {
      marketId: '0xverified',
      ticker: 'DOGE/USDC PERP',
      symbol: 'DOGE',
      name: 'Dogecoin',
      logo: 'https://example.com/doge.png',
      slug: 'doge-usdc-perp',
    },
  ]);
});

