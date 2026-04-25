/**
 * Grantee key storage — purely local. The ephemeral AuthZ grantee key
 * lives in the browser (localStorage) and never leaves the device.
 *
 * Each entry is a complete session bundle keyed by the granter's inj1...
 * address so swapping wallets in MetaMask surfaces the right key — or
 * none at all, which forces a fresh AuthZ grant.
 */

const KEY = 'bet-grantee';

function nowSec() { return Math.floor(Date.now() / 1000); }

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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
