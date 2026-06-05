import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relayGasLimitFromEstimate,
  relayGasPriceFromFeeData,
} from '../src/server/relayMint.js';

test('relayGasLimitFromEstimate buffers CCTP receiveMessage estimates', () => {
  assert.equal(relayGasLimitFromEstimate(590_049n).toString(), '876068');
  assert.ok(relayGasLimitFromEstimate(590_049n) > 300_000n);
});

test('relayGasPriceFromFeeData uses a sane floor over low base gas', () => {
  assert.equal(relayGasPriceFromFeeData({ gasPrice: 160_000_000n }).toString(), '1000000000');
});

test('relayGasPriceFromFeeData buffers high network gas', () => {
  assert.equal(relayGasPriceFromFeeData({ gasPrice: 2_000_000_000n }).toString(), '4000000000');
});
