import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toChainMargin, toChainPrice, toChainQty } from '../src/services/tradeMath.js';

test('toChainPrice scales USDC quote prices and floors to tick size', () => {
  assert.equal(toChainPrice('101.234567', '1000'), '101234000');
  assert.equal(toChainPrice('0.123456', '10'), '123450');
});

test('toChainQty floors human quantity to market quantity tick size', () => {
  assert.equal(toChainQty('0.123456', '0.001'), '0.123');
  assert.equal(toChainQty('2.000000000000000000', '0.01'), '2');
});

test('toChainMargin scales USDC margin without floating point drift', () => {
  assert.equal(toChainMargin('12.345678'), '12345678');
  assert.equal(toChainMargin('0.0000019'), '1');
});
