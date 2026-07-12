import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/services/api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('initAccount accepts the documented transaction response shape', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, txHash: 'ABC123' }),
  });

  assert.deepEqual(await api.initAccount('inj1wallet'), {
    ok: true,
    txHash: 'ABC123',
  });
});

test('initAccount rejects a malformed successful JSON response', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => null,
  });

  await assert.rejects(api.initAccount('inj1wallet'), /Invalid response from \/init-account/);
});

test('relayMint preserves a valid server error message', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'Invalid attestation hex' }),
  });

  await assert.rejects(
    api.relayMint('message', 'attestation'),
    /Invalid attestation hex/
  );
});
