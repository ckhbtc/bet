import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePositionLiqPrice,
  isDangerouslyCloseToLiquidation,
  liquidationCushionRatio,
} from '../src/services/liquidationRisk.js';

test('long positions only turn dangerous in the final 20% of liquidation cushion', () => {
  assert.equal(liquidationCushionRatio({
    entryPrice: 100,
    markPrice: 85,
    liqPrice: 80,
    direction: 'up',
  }), 0.25);

  assert.equal(isDangerouslyCloseToLiquidation({
    entryPrice: 100,
    markPrice: 85,
    liqPrice: 80,
    direction: 'up',
  }), false);

  assert.equal(isDangerouslyCloseToLiquidation({
    entryPrice: 100,
    markPrice: 83.9,
    liqPrice: 80,
    direction: 'up',
  }), true);
});

test('short positions only turn dangerous in the final 20% of liquidation cushion', () => {
  assert.equal(liquidationCushionRatio({
    entryPrice: 100,
    markPrice: 115,
    liqPrice: 120,
    direction: 'down',
  }), 0.25);

  assert.equal(isDangerouslyCloseToLiquidation({
    entryPrice: 100,
    markPrice: 115,
    liqPrice: 120,
    direction: 'down',
  }), false);

  assert.equal(isDangerouslyCloseToLiquidation({
    entryPrice: 100,
    markPrice: 116.5,
    liqPrice: 120,
    direction: 'down',
  }), true);
});

test('liquidation price falls back to entry, margin, and quantity when missing', () => {
  const liqPrice = derivePositionLiqPrice({
    entryPrice: 100,
    margin: 10,
    quantity: 1,
    direction: 'up',
    market: { maintenanceMarginRatio: 0.025 },
  });

  assert.equal(liqPrice, 92.5);
});

test('invalid liquidation inputs are not treated as dangerous', () => {
  assert.equal(liquidationCushionRatio({
    entryPrice: 100,
    markPrice: 99,
    liqPrice: 120,
    direction: 'up',
  }), null);

  assert.equal(isDangerouslyCloseToLiquidation({
    entryPrice: 100,
    markPrice: 99,
    direction: 'up',
  }), false);
});
