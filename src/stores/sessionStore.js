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

  refresh: async () => {
    if (!getSessionToken()) {
      set({ active: false, expiration: null, granterAddress: null });
      return;
    }
    try {
      const r = await api.sessionCheck();
      if (r.active) {
        set({ active: true, expiration: r.expiration, granterAddress: r.granterAddress });
      } else {
        setSessionToken(null);
        set({ active: false, expiration: null, granterAddress: null });
      }
    } catch {
      setSessionToken(null);
      set({ active: false, expiration: null, granterAddress: null });
    }
  },

  grant: async ({ injAddress, ethAddress }) => {
    set({ granting: true, error: null, status: '' });
    try {
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
    } catch (err) {
      set({ granting: false, error: err.message, status: '' });
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
