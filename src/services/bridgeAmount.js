export function parseTokenUnits(human, decimals = 6) {
  const value = String(human ?? '').trim();
  if (!/^\d+(?:\.\d*)?$/.test(value)) throw new Error('Invalid amount');

  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount supports up to ${decimals} decimals`);
  }

  const scale = 10n ** BigInt(decimals);
  const wholeUnits = BigInt(whole) * scale;
  const fractionUnits = BigInt((fraction || '').padEnd(decimals, '0') || '0');
  const units = wholeUnits + fractionUnits;

  if (units <= 0n) throw new Error('Invalid amount');
  return units;
}

export function formatTokenUnits(base, decimals = 6) {
  const units = BigInt(base);
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, '0');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

export function isPositiveTokenAmount(human, decimals = 6) {
  try {
    return parseTokenUnits(human, decimals) > 0n;
  } catch {
    return false;
  }
}

export function sanitizeDecimalInput(raw, decimals = 6) {
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  const [whole, ...fractionParts] = cleaned.split('.');
  if (fractionParts.length === 0) return whole;
  return `${whole}.${fractionParts.join('').slice(0, decimals)}`;
}
