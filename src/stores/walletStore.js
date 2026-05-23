import { create } from 'zustand';
import { connectWallet, onAccountsChanged } from '../services/wallet';
import { fetchBalances } from '../services/injective';
import { clearGrantee } from '../services/grantee';

// Load sessionStore lazily to avoid circular module init.
function clearSession(granterAddress) {
  if (granterAddress) clearGrantee(granterAddress);
  import('./sessionStore').then(m => m.default.setState({
    active: false, expiration: null, granterAddress: null, revoking: false, status: '', error: null,
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
  usdcBalance: 0,
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
          set({ ethAddress: null, injAddress: null, subaccountId: null, connected: false, balances: null, usdcBalance: 0 });
        } else if (info.injAddress !== prev) {
          // Different wallet swapped in — the old session must not carry over.
          clearSession(prev);
          set({ ethAddress: info.ethAddress, injAddress: info.injAddress, subaccountId: info.subaccountId, balances: null, usdcBalance: 0 });
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
      usdcBalance: 0,
      error: null,
    });
  },

  refreshBalances: async () => {
    const { injAddress } = get();
    if (!injAddress) return;
    try {
      const balances = await fetchBalances(injAddress);
      set({ balances, usdcBalance: balances.usdcTotal });
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    }
  },

  // Poll fetchBalances until usdcTotal exceeds the starting snapshot, or
  // until the timeout. The Injective portfolio indexer can lag a few
  // seconds behind a fresh on-chain mint (CCTP V2 receiveMessage), so
  // after a bridge the first refreshBalances often still shows the old
  // total. Caller passes `expectedDelta` so we can fast-exit on a partial
  // increase (e.g. bridged 12 → balance went from 0 to 12.0, but indexer
  // may briefly report 11.999 due to precision rounding).
  pollBalancesUntilChange: async ({
    timeoutMs = 30_000,
    intervalMs = 2_000,
    expectedDelta = 0,
  } = {}) => {
    const { injAddress } = get();
    if (!injAddress) return false;
    const start = get().usdcBalance || 0;
    const target = start + Math.max(0, expectedDelta * 0.99); // 1% slack
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const balances = await fetchBalances(injAddress);
        set({ balances, usdcBalance: balances.usdcTotal });
        if (balances.usdcTotal > start && balances.usdcTotal >= target) {
          return true;
        }
      } catch (err) {
        // transient indexer hiccup — keep polling
        console.warn('balance poll iteration failed:', err.message || err);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  },
}));

export default useWalletStore;
