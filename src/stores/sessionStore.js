import { create } from 'zustand';
import { grantAuthZ, revokeAuthZ } from '../services/autosign';
import { getGrantee, setGrantee, clearGrantee } from '../services/grantee';
import { api } from '../services/api';
import { AUTHZ_SCOPE_VERSION } from '../services/authzMessages';

/**
 * Session = "is there a non-expired grantee key stored locally for the
 * currently-connected wallet?". No server roundtrip — the key never
 * leaves the browser. Trades are signed and broadcast directly to the
 * Injective fee-delegation relay using the stored privateKeyHex.
 */
const useSessionStore = create((set) => ({
  active: false,
  rfqReady: false,
  expiration: null,
  granterAddress: null,
  granting: false,
  revoking: false,
  status: '',
  error: null,

  refresh: (expectedInjAddress = null) => {
    if (!expectedInjAddress) {
      set({ active: false, rfqReady: false, expiration: null, granterAddress: null });
      return;
    }
    const entry = getGrantee(expectedInjAddress);
    if (!entry) {
      set({ active: false, rfqReady: false, expiration: null, granterAddress: null });
      return;
    }
    set({
      active: true,
      rfqReady: Number(entry.scopeVersion || 1) >= AUTHZ_SCOPE_VERSION,
      expiration: entry.expiration,
      granterAddress: entry.granterAddress,
    });
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
        scopeVersion: result.scopeVersion,
      });
      set({
        active: true,
        rfqReady: true,
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

  revoke: async (granterAddress) => {
    if (!granterAddress) {
      set({ active: false, rfqReady: false, expiration: null, granterAddress: null, revoking: false, status: '' });
      return { txHash: null, localOnly: true };
    }

    const entry = getGrantee(granterAddress);
    if (!entry) {
      set({ active: false, rfqReady: false, expiration: null, granterAddress: null, revoking: false, status: '' });
      return { txHash: null, localOnly: true };
    }

    set({ revoking: true, error: null, status: '' });
    let result;
    try {
      result = await revokeAuthZ({
        injAddress: granterAddress,
        granteeAddress: entry.granteeAddress,
        includeRfq: Number(entry.scopeVersion || 1) >= AUTHZ_SCOPE_VERSION,
      }, (msg) => set({ status: msg }));
    } catch (err) {
      set({ revoking: false, error: err.message, status: '' });
      throw err;
    }

    // On-chain revoke succeeded — local state must reflect that even if
    // localStorage hiccups, otherwise the UI keeps trying to sign with a
    // grantee key the chain no longer accepts.
    try { clearGrantee(granterAddress); } catch { /* best-effort */ }
    set({
      active: false,
      rfqReady: false,
      expiration: null,
      granterAddress: null,
      revoking: false,
      status: 'Autosign revoked.',
    });
    return result;
  },

  deactivate: (granterAddress) => {
    if (granterAddress) clearGrantee(granterAddress);
    set({ active: false, rfqReady: false, expiration: null, granterAddress: null, revoking: false, status: '' });
  },
}));

export default useSessionStore;
