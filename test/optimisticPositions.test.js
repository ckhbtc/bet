import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticCloses,
  mergeFetchedAndOptimisticPositions,
  nextOpenPnlGraceExpiresAt,
  withOptimisticCloseExpiry,
  withOptimisticExpiry,
} from '../src/stores/optimisticPositions.js';

test('mergeFetchedAndOptimisticPositions keeps fresh optimistic positions while indexer is stale', () => {
  const optimistic = withOptimisticExpiry({
    id: 'market_long',
    marketId: 'market',
    optimistic: true,
  }, 1_000);

  const merged = mergeFetchedAndOptimisticPositions([], [optimistic], 2_000);

  assert.deepEqual(merged, [optimistic]);
});

test('mergeFetchedAndOptimisticPositions replaces optimistic positions with fetched real positions', () => {
  const optimistic = withOptimisticExpiry({
    id: 'market_long',
    marketId: 'market',
    optimistic: true,
  }, 1_000);
  const fetched = {
    id: 'market_long',
    marketId: 'market',
    optimistic: false,
  };

  const merged = mergeFetchedAndOptimisticPositions([fetched], [optimistic], 2_000);

  assert.deepEqual(merged, [{
    ...fetched,
    pnlGraceExpiresAt: optimistic.pnlGraceExpiresAt,
  }]);
});

test('mergeFetchedAndOptimisticPositions drops open PnL grace after five seconds', () => {
  const optimistic = withOptimisticExpiry({
    id: 'market_long',
    marketId: 'market',
    optimistic: true,
  }, 1_000);
  const fetched = {
    id: 'market_long',
    marketId: 'market',
    optimistic: false,
  };

  const merged = mergeFetchedAndOptimisticPositions([fetched], [optimistic], 7_000);

  assert.deepEqual(merged, [fetched]);
});

test('nextOpenPnlGraceExpiresAt refreshes grace from confirmation time', () => {
  const optimistic = {
    ...withOptimisticExpiry({
      id: 'market_long',
      marketId: 'market',
      optimistic: true,
    }, 1_000),
    pnlGraceExpiresAt: nextOpenPnlGraceExpiresAt(6_000),
  };
  const fetched = {
    id: 'market_long',
    marketId: 'market',
    optimistic: false,
    pnl: -0.03,
  };

  const merged = mergeFetchedAndOptimisticPositions([fetched], [optimistic], 7_000);

  assert.deepEqual(merged, [{
    ...fetched,
    pnlGraceExpiresAt: 11_000,
  }]);
});

test('mergeFetchedAndOptimisticPositions drops expired optimistic positions', () => {
  const optimistic = withOptimisticExpiry({
    id: 'market_long',
    marketId: 'market',
    optimistic: true,
  }, 1_000);

  const merged = mergeFetchedAndOptimisticPositions([], [optimistic], 70_000);

  assert.deepEqual(merged, []);
});

test('applyOptimisticCloses suppresses stale fetched positions after cash-out match', () => {
  const position = { id: 'market_long', marketId: 'market' };
  const closes = {
    [position.id]: withOptimisticCloseExpiry(position, 1_000),
  };

  assert.deepEqual(applyOptimisticCloses([position], closes, 2_000), []);
});

test('applyOptimisticCloses allows fetched positions after close suppression expires', () => {
  const position = { id: 'market_long', marketId: 'market' };
  const closes = {
    [position.id]: withOptimisticCloseExpiry(position, 1_000),
  };

  assert.deepEqual(applyOptimisticCloses([position], closes, 70_000), [position]);
});
