/**
 * Grantee key storage — purely local. The ephemeral AuthZ grantee key
 * lives in the browser (localStorage) and never leaves the device.
 *
 * Each entry is a complete session bundle keyed by the granter's inj1...
 * address so swapping wallets in MetaMask surfaces the right key — or
 * none at all, which forces a fresh AuthZ grant.
 */

const KEY = 'bet-grantee';
const INJECTIVE_ADDRESS_RE = /^inj1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;

function nowSec() { return Math.floor(Date.now() / 1000); }

/**
 * @typedef {object} GranteeSession
 * @property {string} privateKeyHex
 * @property {string} granteeAddress
 * @property {string} granterAddress
 * @property {string} ethAddress
 * @property {number} evmChainId
 * @property {number} expiration
 * @property {number} [scopeVersion]
 */

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isGranteeSession(entry, granterAddress) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (entry.granterAddress !== granterAddress) return false;
  if (!INJECTIVE_ADDRESS_RE.test(entry.granterAddress)) return false;
  if (!INJECTIVE_ADDRESS_RE.test(entry.granteeAddress)) return false;
  if (!EVM_ADDRESS_RE.test(entry.ethAddress)) return false;
  if (!PRIVATE_KEY_RE.test(entry.privateKeyHex)) return false;
  if (!isPositiveInteger(entry.evmChainId)) return false;
  if (!isPositiveInteger(entry.expiration)) return false;
  return entry.scopeVersion === undefined || isPositiveInteger(entry.scopeVersion);
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); }
  catch { /* ignore */ }
}

export function getGrantee(granterAddress) {
  if (!granterAddress) return null;
  const all = readAll();
  const entry = all[granterAddress];
  if (!entry) return null;
  if (!isGranteeSession(entry, granterAddress)) {
    delete all[granterAddress];
    writeAll(all);
    return null;
  }
  if (entry.expiration && entry.expiration <= nowSec()) {
    delete all[granterAddress];
    writeAll(all);
    return null;
  }
  return entry;
}

export function setGrantee(entry) {
  if (!entry || !entry.granterAddress) return;
  const all = readAll();
  all[entry.granterAddress] = entry;
  writeAll(all);
}

export function clearGrantee(granterAddress) {
  if (!granterAddress) return;
  const all = readAll();
  if (granterAddress in all) {
    delete all[granterAddress];
    writeAll(all);
  }
}
