import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleUsdcBalanceState } from '../src/stores/walletBalance.js';

test('visibleUsdcBalanceState holds a confirmed bridge floor over stale indexer totals', () => {
  const state = visibleUsdcBalanceState({
    fetchedTotal: 20.24,
    floor: 30.24,
    floorExpiresAt: 2_000,
    now: 1_000,
  });

  assert.equal(state.usdcBalance, 30.24);
  assert.equal(state.usdcBalanceFloor, 30.24);
  assert.equal(state.usdcBalanceFloorExpiresAt, 2_000);
});

test('visibleUsdcBalanceState clears the bridge floor once the indexer catches up', () => {
  const state = visibleUsdcBalanceState({
    fetchedTotal: 30.240001,
    floor: 30.24,
    floorExpiresAt: 2_000,
    now: 1_000,
  });

  assert.equal(state.usdcBalance, 30.240001);
  assert.equal(state.usdcBalanceFloor, null);
  assert.equal(state.usdcBalanceFloorExpiresAt, 0);
});

test('visibleUsdcBalanceState ignores an expired bridge floor', () => {
  const state = visibleUsdcBalanceState({
    fetchedTotal: 20.24,
    floor: 30.24,
    floorExpiresAt: 1_000,
    now: 2_000,
  });

  assert.equal(state.usdcBalance, 20.24);
  assert.equal(state.usdcBalanceFloor, null);
  assert.equal(state.usdcBalanceFloorExpiresAt, 0);
});
