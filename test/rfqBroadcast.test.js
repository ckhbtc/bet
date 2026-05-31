import assert from 'node:assert/strict';
import test from 'node:test';
import { relayRfqBroadcast } from '../src/server/rfqBroadcast.js';

test('relayRfqBroadcast rejects malformed tx bytes before any network call', async () => {
  await assert.rejects(
    () => relayRfqBroadcast({ txBytes: '../not-base64' }),
    /Invalid tx bytes/
  );
});
