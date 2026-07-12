import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getGrantee, setGrantee } from '../src/services/grantee.js';

const GRANTER = `inj1${'q'.repeat(38)}`;
const GRANTEE = `inj1${'p'.repeat(38)}`;

function session(overrides = {}) {
  return {
    privateKeyHex: `0x${'1'.repeat(64)}`,
    granteeAddress: GRANTEE,
    granterAddress: GRANTER,
    ethAddress: `0x${'2'.repeat(40)}`,
    evmChainId: 1776,
    expiration: Math.floor(Date.now() / 1000) + 3600,
    scopeVersion: 2,
    ...overrides,
  };
}

beforeEach(() => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
});

afterEach(() => {
  delete globalThis.localStorage;
});

test('getGrantee returns a valid stored signing session unchanged', () => {
  const stored = session();
  setGrantee(stored);
  assert.deepEqual(getGrantee(GRANTER), stored);
});

test('getGrantee rejects malformed signing material from localStorage', () => {
  localStorage.setItem('bet-grantee', JSON.stringify({
    [GRANTER]: session({ privateKeyHex: 'not-a-private-key' }),
  }));

  assert.equal(getGrantee(GRANTER), null);
  assert.deepEqual(JSON.parse(localStorage.getItem('bet-grantee')), {});
});

test('getGrantee rejects a session stored under a different granter key', () => {
  const otherGranter = `inj1${'z'.repeat(38)}`;
  localStorage.setItem('bet-grantee', JSON.stringify({
    [GRANTER]: session({ granterAddress: otherGranter }),
  }));

  assert.equal(getGrantee(GRANTER), null);
});
