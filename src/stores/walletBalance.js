const USDC_FLOOR_EPSILON = 0.000001;

export function visibleUsdcBalanceState({
  fetchedTotal,
  floor,
  floorExpiresAt,
  now = Date.now(),
}) {
  const fetched = Number(fetchedTotal) || 0;
  const activeFloor = Number.isFinite(Number(floor))
    && Number(floor) > 0
    && Number(floorExpiresAt) > now;

  if (!activeFloor) {
    return {
      usdcBalance: fetched,
      usdcBalanceFloor: null,
      usdcBalanceFloorExpiresAt: 0,
    };
  }

  const floorValue = Number(floor);
  const caughtUp = fetched >= floorValue - USDC_FLOOR_EPSILON;

  return {
    usdcBalance: Math.max(fetched, floorValue),
    usdcBalanceFloor: caughtUp ? null : floorValue,
    usdcBalanceFloorExpiresAt: caughtUp ? 0 : floorExpiresAt,
  };
}
