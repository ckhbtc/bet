import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTokenUnits,
  isPositiveTokenAmount,
  parseTokenUnits,
  sanitizeDecimalInput,
} from '../src/services/bridgeAmount.js';

test('parseTokenUnits converts decimal token amounts exactly', () => {
  assert.equal(parseTokenUnits('1').toString(), '1000000');
  assert.equal(parseTokenUnits('1.234567').toString(), '1234567');
  assert.equal(parseTokenUnits('0.000001').toString(), '1');
});

test('parseTokenUnits rejects invalid or over-precision values', () => {
  assert.throws(() => parseTokenUnits('0'), /Invalid amount/);
  assert.throws(() => parseTokenUnits('1.2345678'), /up to 6 decimals/);
  assert.throws(() => parseTokenUnits('1.2.3'), /Invalid amount/);
  assert.throws(() => parseTokenUnits('abc'), /Invalid amount/);
});

test('formatTokenUnits trims trailing fractional zeros', () => {
  assert.equal(formatTokenUnits('1234500'), '1.2345');
  assert.equal(formatTokenUnits('1000000'), '1');
});

test('bridge amount helpers support input validation and sanitization', () => {
  assert.equal(isPositiveTokenAmount('2.5'), true);
  assert.equal(isPositiveTokenAmount('2.5000001'), false);
  assert.equal(sanitizeDecimalInput('12..34abc56789'), '12.345678');
});
