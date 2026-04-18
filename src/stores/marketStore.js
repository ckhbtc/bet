import { create } from 'zustand';
import { listMarkets, fetchAllPrices, fetchPositions, fetchMarketsSummary } from '../services/injective';

// Only show USDT perp markets for these symbols
const FEATURED_SYMBOLS = ['BTC', 'ETH', 'SOL', 'INJ', 'TIA', 'ATOM'];

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
      const allMarkets = await listMarkets();

      // Filter to featured USDT perp markets (ticker contains USDT)
      const featured = allMarkets.filter(m =>
        FEATURED_SYMBOLS.includes(m.symbol.toUpperCase()) &&
        m.ticker.toUpperCase().includes('USDT')
      );

      // Also include any other USDT perps not in featured, up to a total of 8
      const extra = allMarkets.filter(m =>
        m.ticker.toUpperCase().includes('USDT') &&
        !featured.find(f => f.marketId === m.marketId)
      ).slice(0, Math.max(0, 8 - featured.length));

      const markets = [...featured, ...extra];

      // Oracle prices + 24h market summary in parallel.
      // Oracle gives the freshest price; summary gives the 24h open used
      // to compute % change.
      const [prices, summaries] = await Promise.all([
        fetchAllPrices(markets),
        fetchMarketsSummary(),
      ]);

      const uiMarkets = markets.map(m => {
        const summary = summaries[m.marketId];
        return {
          ...m,
          id: m.marketId,
          name: m.ticker,
          price: prices[m.marketId] || summary?.price || 0,
          change24h: summary?.change24hPct || 0,
          sparkline: [], // No sparkline data from oracle
        };
      });

      set({ markets: uiMarkets, prices, loading: false });
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
      const [prices, summaries] = await Promise.all([
        fetchAllPrices(markets),
        fetchMarketsSummary(),
      ]);
      set(state => ({
        prices,
        markets: state.markets.map(m => {
          const summary = summaries[m.marketId];
          return {
            ...m,
            price: prices[m.marketId] || summary?.price || m.price,
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
