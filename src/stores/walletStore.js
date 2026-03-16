import { create } from 'zustand';
import { connectWallet, onAccountsChanged } from '../services/wallet';
import { fetchBalances } from '../services/injective';

const useWalletStore = create((set, get) => ({
  ethAddress: null,
  injAddress: null,
  subaccountId: null,
  connected: false,
  connecting: false,
  balances: null,
  usdtBalance: 0,
  error: null,

  connect: async () => {
    set({ connecting: true, error: null });
    try {
      const { ethAddress, injAddress, subaccountId } = await connectWallet();
      set({ ethAddress, injAddress, subaccountId, connected: true, connecting: false });

      // Fetch balances immediately
      get().refreshBalances();

      // Listen for account changes
      onAccountsChanged((info) => {
        if (!info) {
          set({ ethAddress: null, injAddress: null, subaccountId: null, connected: false, balances: null, usdtBalance: 0 });
        } else {
          set({ ethAddress: info.ethAddress, injAddress: info.injAddress, subaccountId: info.subaccountId });
          get().refreshBalances();
        }
      });
    } catch (err) {
      set({ connecting: false, error: err.message });
      throw err;
    }
  },

  disconnect: () => {
    set({
      ethAddress: null,
      injAddress: null,
      subaccountId: null,
      connected: false,
      balances: null,
      usdtBalance: 0,
      error: null,
    });
  },

  refreshBalances: async () => {
    const { injAddress } = get();
    if (!injAddress) return;
    try {
      const balances = await fetchBalances(injAddress);
      set({ balances, usdtBalance: balances.usdtTotal });
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    }
  },
}));

export default useWalletStore;
