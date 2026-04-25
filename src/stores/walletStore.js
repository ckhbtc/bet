import { create } from 'zustand';
import { connectWallet, onAccountsChanged } from '../services/wallet';
import { fetchBalances } from '../services/injective';
import { clearGrantee } from '../services/grantee';

// Load sessionStore lazily to avoid circular module init.
function clearSession(granterAddress) {
  if (granterAddress) clearGrantee(granterAddress);
  import('./sessionStore').then(m => m.default.setState({
    active: false, expiration: null, granterAddress: null, status: '', error: null,
  })).catch(() => {});
}

let unsubscribeAccountsChanged = null;

function clearAccountsChangedListener() {
  if (!unsubscribeAccountsChanged) return;
  unsubscribeAccountsChanged();
  unsubscribeAccountsChanged = null;
}

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
      const prevInjAddress = get().injAddress;
      const { ethAddress, injAddress, subaccountId } = await connectWallet();

      // If the connected wallet changed (or is new), wipe any lingering session
      // bound to a previous granter before we expose the new wallet state.
      if (prevInjAddress && prevInjAddress !== injAddress) clearSession(prevInjAddress);

      set({ ethAddress, injAddress, subaccountId, connected: true, connecting: false });

      get().refreshBalances();

      // Listen for account changes from the wallet itself.
      clearAccountsChangedListener();
      unsubscribeAccountsChanged = onAccountsChanged((info) => {
        const prev = get().injAddress;
        if (!info) {
          clearAccountsChangedListener();
          clearSession(prev);
          set({ ethAddress: null, injAddress: null, subaccountId: null, connected: false, balances: null, usdtBalance: 0 });
        } else if (info.injAddress !== prev) {
          // Different wallet swapped in — the old session must not carry over.
          clearSession(prev);
          set({ ethAddress: info.ethAddress, injAddress: info.injAddress, subaccountId: info.subaccountId, balances: null, usdtBalance: 0 });
          get().refreshBalances();
        } else {
          // Same wallet — benign event, just refresh balances.
          set({ ethAddress: info.ethAddress });
          get().refreshBalances();
        }
      });
    } catch (err) {
      set({ connecting: false, error: err.message });
      throw err;
    }
  },

  disconnect: () => {
    clearAccountsChangedListener();
    clearSession(get().injAddress);
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
