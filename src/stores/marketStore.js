import { create } from 'zustand';
import {
  listMarkets,
  fetchAllPrices,
  fetchPositions,
  fetchMarketsSummary,
  fetchVerifiedDerivativeMarkets,
} from '../services/injective';

// Priority display order. All other TrueCurrent-verified markets are appended
// in BFF order, so new verified pairs are picked up without a deploy.
const PRIORITY_SYMBOLS = [
  'BTC', 'ETH', 'INJ', 'SOL', 'XRP', 'BNB',
  'TSLA', 'META', 'AAVE', 'COIN', 'AMZN', 'MSTR',
  'NVDA', 'AAPL', 'GOOGL', 'WIF', 'CRCL', 'HOOD',
];

function withBffMetadata(chainMarket, bffMarket) {
  return {
    ...chainMarket,
    symbol: bffMarket.symbol || chainMarket.symbol,
    ticker: bffMarket.ticker || chainMarket.ticker,
    tokenName: bffMarket.name || '',
    logo: bffMarket.logo || '',
    slug: bffMarket.slug || '',
  };
}

function orderMarkets(markets) {
  const priority = new Map(PRIORITY_SYMBOLS.map((symbol, index) => [symbol, index]));

  return markets
    .map((market, index) => ({
      market,
      index,
      priorityIndex: priority.has(market.symbol.toUpperCase())
        ? priority.get(market.symbol.toUpperCase())
        : null,
    }))
    .sort((a, b) => {
      const aPriority = a.priorityIndex != null;
      const bPriority = b.priorityIndex != null;
      if (aPriority && bPriority) return a.priorityIndex - b.priorityIndex;
      if (aPriority) return -1;
      if (bPriority) return 1;
      return a.index - b.index;
    })
    .map(item => item.market);
}

function selectVerifiedMarkets(allMarkets, verifiedMarkets) {
  const chainById = new Map(allMarkets.map(m => [m.marketId.toLowerCase(), m]));

  return orderMarkets(
    verifiedMarkets
      .map(bffMarket => {
        const chainMarket = chainById.get(bffMarket.marketId.toLowerCase());
        return chainMarket ? withBffMetadata(chainMarket, bffMarket) : null;
      })
      .filter(Boolean)
  );
}

function selectFallbackMarkets(allMarkets) {
  const usdcPerps = allMarkets.filter(m => m.ticker.toUpperCase().includes('USDC'));
  return PRIORITY_SYMBOLS
    .map(sym => usdcPerps.find(m => m.symbol.toUpperCase() === sym))
    .filter(Boolean);
}

function hasSummaryPrice(summary) {
  return Number.isFinite(summary?.price) && summary.price > 0;
}

async function fetchDisplayPrices(markets) {
  const summaries = await fetchMarketsSummary();
  const missingPriceMarkets = markets.filter(m => !hasSummaryPrice(summaries[m.marketId]));
  const oraclePrices = missingPriceMarkets.length > 0
    ? await fetchAllPrices(missingPriceMarkets)
    : {};

  const prices = {};
  for (const market of markets) {
    const summary = summaries[market.marketId];
    prices[market.marketId] = hasSummaryPrice(summary)
      ? summary.price
      : (oraclePrices[market.marketId] || 0);
  }

  return { prices, summaries };
}

const useMarketStore = create((set, get) => ({
  markets: [],
  prices: {},
  positions: [],
  loading: false,
  error: null,
  pollInterval: null,

  fetchMarkets: async () => {
    set({ loading: true });
    try {
      const [allMarkets, verifiedMarketsResult] = await Promise.allSettled([
        listMarkets(),
        fetchVerifiedDerivativeMarkets(),
      ]);

      if (allMarkets.status === 'rejected') throw allMarkets.reason;

      let markets = [];
      if (verifiedMarketsResult.status === 'fulfilled') {
        markets = selectVerifiedMarkets(allMarkets.value, verifiedMarketsResult.value);
      } else {
        console.warn('Failed to fetch TrueCurrent verified markets:', verifiedMarketsResult.reason);
      }

      if (markets.length === 0) {
        markets = selectFallbackMarkets(allMarkets.value);
      }

      const { prices, summaries } = await fetchDisplayPrices(markets);

      const uiMarkets = markets.map(m => {
        const summary = summaries[m.marketId];
        return {
          ...m,
          id: m.marketId,
          name: m.ticker,
          price: prices[m.marketId] || 0,
          change24h: summary?.change24hPct || 0,
          sparkline: [], // No sparkline data from market summary
        };
      });

      set({ markets: uiMarkets, prices, loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err.message });
      console.error('Failed to fetch markets:', err);
    }
  },

  fetchPositions: async (injAddress) => {
    if (!injAddress) return;
    try {
      const positions = await fetchPositions(injAddress);
      set({ positions });
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    }
  },

  updatePrices: async () => {
    const { markets } = get();
    if (markets.length === 0) return;
    try {
      const { prices, summaries } = await fetchDisplayPrices(markets);
      set(state => ({
        prices,
        markets: state.markets.map(m => {
          const summary = summaries[m.marketId];
          return {
            ...m,
            price: prices[m.marketId] || m.price,
            change24h: summary?.change24hPct ?? m.change24h,
          };
        }),
      }));
    } catch (err) {
      console.error('Price update failed:', err);
    }
  },

  startPolling: (injAddress) => {
    const { pollInterval } = get();
    if (pollInterval) return; // Already polling

    // Initial fetch
    get().fetchMarkets();
    if (injAddress) get().fetchPositions(injAddress);

    const interval = setInterval(() => {
      get().updatePrices();
      if (injAddress) get().fetchPositions(injAddress);
    }, 10_000);

    set({ pollInterval: interval });
  },

  stopPolling: () => {
    const { pollInterval } = get();
    if (pollInterval) {
      clearInterval(pollInterval);
      set({ pollInterval: null });
    }
  },
}));

// Auto-fetch markets on store creation (no wallet needed for browsing)
useMarketStore.getState().fetchMarkets();

export default useMarketStore;
