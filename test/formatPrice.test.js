import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, priceDecimalsFromTickSize } from '../src/data/mockData.js';

test('formatPrice uses market-specific price decimals', () => {
  assert.equal(formatPrice(0.000012345, 9), '0.000012345');
  assert.equal(formatPrice(0.17765, 4), '0.1777');
  assert.equal(formatPrice(105432.47, 0), '105,432');
});

test('priceDecimalsFromTickSize converts chain quote-scaled ticks to human decimals', () => {
  assert.equal(priceDecimalsFromTickSize('0.001'), 9);
  assert.equal(priceDecimalsFromTickSize('100'), 4);
  assert.equal(priceDecimalsFromTickSize('1000000'), 0);
});

