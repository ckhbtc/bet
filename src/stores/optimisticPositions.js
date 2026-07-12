const OPTIMISTIC_POSITION_TTL_MS = 60_000;
const OPTIMISTIC_CLOSE_TTL_MS = 60_000;
const OPEN_PNL_GRACE_MS = 5_000;

export function nextOpenPnlGraceExpiresAt(now = Date.now()) {
  return now + OPEN_PNL_GRACE_MS;
}

function isFreshOptimisticPosition(position, now = Date.now()) {
  return Boolean(position?.optimistic)
    && (!position.optimisticExpiresAt || Number(position.optimisticExpiresAt) > now);
}

function isOpenPnlGraceActive(position, now = Date.now()) {
  return Number(position?.pnlGraceExpiresAt || 0) > now;
}

export function mergeFetchedAndOptimisticPositions(fetchedPositions, currentPositions, now = Date.now()) {
  const fetched = Array.isArray(fetchedPositions) ? fetchedPositions : [];
  const current = Array.isArray(currentPositions) ? currentPositions : [];
  const currentById = new Map(current.map(position => [position.id, position]));
  const fetchedWithGrace = fetched.map(position => {
    const currentPosition = currentById.get(position.id);
    if (!isOpenPnlGraceActive(currentPosition, now)) return position;
    return {
      ...position,
      pnlGraceExpiresAt: currentPosition.pnlGraceExpiresAt,
    };
  });
  const fetchedIds = new Set(fetchedWithGrace.map(position => position.id));
  const optimistic = current.filter(position =>
    isFreshOptimisticPosition(position, now) && !fetchedIds.has(position.id)
  );

  return [...optimistic, ...fetchedWithGrace];
}

export function withOptimisticExpiry(position, now = Date.now()) {
  return {
    ...position,
    optimistic: true,
    optimisticExpiresAt: now + OPTIMISTIC_POSITION_TTL_MS,
    pnlGraceExpiresAt: position.pnlGraceExpiresAt || nextOpenPnlGraceExpiresAt(now),
  };
}

export function withOptimisticCloseExpiry(position, now = Date.now()) {
  return {
    position,
    expiresAt: now + OPTIMISTIC_CLOSE_TTL_MS,
  };
}

export function pruneOptimisticCloses(optimisticCloses, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(optimisticCloses || {}).filter(([, close]) =>
      Number(close?.expiresAt || 0) > now
    )
  );
}

export function applyOptimisticCloses(positions, optimisticCloses, now = Date.now()) {
  const freshCloses = pruneOptimisticCloses(optimisticCloses, now);
  const closedIds = new Set(Object.keys(freshCloses));
  return (positions || []).filter(position => !closedIds.has(position.id));
}
