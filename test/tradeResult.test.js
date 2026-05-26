import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOpenTradeStatus, shortenError } from '../src/services/tradeResult.js';

test('getOpenTradeStatus returns success when open and take-profit both succeed', () => {
  assert.deepEqual(
    getOpenTradeStatus({
      txHash: 'ABCDEF1234567890',
      takeProfit: { requested: true, placed: true, error: null },
    }),
    {
      type: 'success',
      message: 'Trade placed!',
      txHash: 'ABCDEF1234567890',
    }
  );
});

test('getOpenTradeStatus returns warning when open succeeds but take-profit fails', () => {
  assert.deepEqual(
    getOpenTradeStatus({
      txHash: 'ABCDEF1234567890',
      takeProfit: { requested: true, placed: false, error: 'reduce-only order rejected' },
    }),
    {
      type: 'warning',
      message: 'Trade opened, but take-profit failed: reduce-only order rejected',
      txHash: 'ABCDEF1234567890',
    }
  );
});

test('getOpenTradeStatus returns success when no take-profit was requested', () => {
  assert.deepEqual(
    getOpenTradeStatus({
      txHash: 'ABCDEF1234567890',
      takeProfit: { requested: false, placed: false, error: null },
    }),
    {
      type: 'success',
      message: 'Trade placed!',
      txHash: 'ABCDEF1234567890',
    }
  );
});

test('shortenError caps long exchange errors', () => {
  const shortened = shortenError('x'.repeat(200), 20);
  assert.equal(shortened.length, 20);
  assert.equal(shortened.endsWith('...'), true);
});
