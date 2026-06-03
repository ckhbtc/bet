import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { relayRfqBroadcast } from '../src/server/rfqBroadcast.js';

test('relayRfqBroadcast rejects malformed tx bytes before any network call', async () => {
  await assert.rejects(
    () => relayRfqBroadcast({ txBytes: '../not-base64' }),
    /Invalid tx bytes/
  );
});

test('relayRfqBroadcast treats duplicate mempool responses as accepted', async () => {
  const originalFetch = globalThis.fetch;
  const txBytes = Buffer.from('duplicate-tx-bytes').toString('base64');
  const expectedHash = createHash('sha256')
    .update(Buffer.from(txBytes, 'base64'))
    .digest('hex')
    .toUpperCase();

  globalThis.fetch = async (url) => {
    if (String(url).includes('tm.injective')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            code: 19,
            log: 'tx already exists in cache',
          },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        tx_response: {
          code: 19,
          raw_log: 'tx already exists in cache',
        },
      }),
    };
  };

  try {
    const result = await relayRfqBroadcast({ txBytes });
    assert.equal(result.txHash, expectedHash);
    assert.equal(result.duplicate, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
