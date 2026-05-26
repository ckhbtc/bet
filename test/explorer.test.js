import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortTxHash, txExplorerUrl } from '../src/services/explorer.js';

test('txExplorerUrl points confirmed Injective txs at tcx', () => {
  assert.equal(
    txExplorerUrl('ABCDEF1234567890'),
    'https://tcx.inj.so/transaction/ABCDEF1234567890'
  );
});

test('shortTxHash keeps the existing toast hash shape', () => {
  assert.equal(shortTxHash('ABCDEF1234567890'), 'ABCDEF123456...');
});
