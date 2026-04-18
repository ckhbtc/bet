import { create } from 'zustand';
import { api, getSessionToken, setSessionToken } from '../services/api';
import { grantAuthZ } from '../services/autosign';

const useSessionStore = create((set, get) => ({
  active: false,
  expiration: null,
  granterAddress: null,
  granting: false,
  status: '',
  error: null,

  refresh: async (expectedInjAddress = null) => {
    if (!getSessionToken()) {
      set({ active: false, expiration: null, granterAddress: null });
      return;
    }
    try {
      const r = await api.sessionCheck();
      if (!r.active) {
        setSessionToken(null);
        set({ active: false, expiration: null, granterAddress: null });
        return;
      }
      // Session belongs to a different wallet than the one currently connected —
      // possible when a user swaps MetaMask accounts. Refuse to surface it as
      // "active" or the next trade would be signed against the wrong wallet.
      if (expectedInjAddress && r.granterAddress && r.granterAddress !== expectedInjAddress) {
        setSessionToken(null);
        set({ active: false, expiration: null, granterAddress: null });
        return;
      }
      set({ active: true, expiration: r.expiration, granterAddress: r.granterAddress });
    } catch {
      setSessionToken(null);
      set({ active: false, expiration: null, granterAddress: null });
    }
  },

  grant: async ({ injAddress, ethAddress }) => {
    set({ granting: true, error: null, status: '' });

    const runGrant = async () => {
      const result = await grantAuthZ(injAddress, (msg) => set({ status: msg }));
      const resp = await api.activate({
        privateKeyHex: result.privateKeyHex,
        injectiveAddress: result.injectiveAddress,
        granterAddress: injAddress,
        ethAddress,
        evmChainId: result.evmChainId,
        expiration: result.expiration,
      });
      setSessionToken(resp.sessionToken);
      set({
        active: true,
        expiration: resp.expiration,
        granterAddress: injAddress,
        granting: false,
        status: 'Autosign active.',
      });
    };

    try {
      await runGrant();
    } catch (err) {
      const msg = err?.message || '';
      // Fresh wallet — no on-chain account yet. Faucet a tiny INJ, wait for
      // block inclusion, then retry the grant once.
      const needsFaucet = (msg.includes('not found') && msg.toLowerCase().includes('account'))
        || msg.toLowerCase().includes('insufficient funds');
      if (needsFaucet) {
        try {
          set({ status: 'New wallet detected — initializing your account...' });
          await api.initAccount(injAddress);
          set({ status: 'Account funded — retrying authorization...' });
          await new Promise(r => setTimeout(r, 5000));
          await runGrant();
          return;
        } catch (retryErr) {
          set({ granting: false, error: retryErr.message, status: '' });
          throw retryErr;
        }
      }
      set({ granting: false, error: msg, status: '' });
      throw err;
    }
  },

  deactivate: async () => {
    try { await api.sessionDeactivate(); } catch { /* ignore */ }
    setSessionToken(null);
    set({ active: false, expiration: null, granterAddress: null, status: '' });
  },
}));

useSessionStore.getState().refresh();

export default useSessionStore;
