import { create } from 'zustand';
import { grantAuthZ } from '../services/autosign';
import { getGrantee, setGrantee, clearGrantee } from '../services/grantee';
import { api } from '../services/api';

/**
 * Session = "is there a non-expired grantee key stored locally for the
 * currently-connected wallet?". No server roundtrip — the key never
 * leaves the browser. Trades are signed and broadcast directly to the
 * Injective fee-delegation relay using the stored privateKeyHex.
 */
const useSessionStore = create((set) => ({
  active: false,
  expiration: null,
  granterAddress: null,
  granting: false,
  status: '',
  error: null,

  refresh: (expectedInjAddress = null) => {
    if (!expectedInjAddress) {
      set({ active: false, expiration: null, granterAddress: null });
      return;
    }
    const entry = getGrantee(expectedInjAddress);
    if (!entry) {
      set({ active: false, expiration: null, granterAddress: null });
      return;
    }
    set({ active: true, expiration: entry.expiration, granterAddress: entry.granterAddress });
  },

  grant: async ({ injAddress, ethAddress }) => {
    set({ granting: true, error: null, status: '' });

    const runGrant = async () => {
      const result = await grantAuthZ(injAddress, (msg) => set({ status: msg }));
      setGrantee({
        privateKeyHex: result.privateKeyHex,
        granteeAddress: result.injectiveAddress,
        granterAddress: injAddress,
        ethAddress,
        evmChainId: result.evmChainId,
        expiration: result.expiration,
      });
      set({
        active: true,
        expiration: result.expiration,
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

  deactivate: (granterAddress) => {
    if (granterAddress) clearGrantee(granterAddress);
    set({ active: false, expiration: null, granterAddress: null, status: '' });
  },
}));

export default useSessionStore;
