export function decimal(value: number | null, digits: number, signed = false): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  // Preserve the frozen presentation's binary-number rounding at display boundaries.
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${signed && normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}`;
}
const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function count(value: number | null): string {
  return value !== null && Number.isSafeInteger(value) ? countFormat.format(value) : 'Unavailable';
}
export const rank = (value: number | null) => value !== null && Number.isSafeInteger(value) && value > 0 ? String(value) : 'Unavailable';
export const percent = (fraction: number | null, digits = 1) => fraction === null || !Number.isFinite(fraction) ? 'Unavailable' : `${decimal(fraction * 100, digits)}%`;
export const riskPercent = (value: number | null) => value === null || !Number.isFinite(value) ? 'Unavailable' : `${decimal(value, 2)}%`;
export const pp = (value: number | null, digits = 3, signed = false) => value === null || !Number.isFinite(value) ? 'Unavailable' : `${decimal(value, digits, signed)} pp`;
export const effect = (value: number | null) => pp(value, 3);
export const correlation = (value: number | null) => decimal(value, 4);
export function ci(lower: number | null, upper: number | null, digits = 3) {
  return lower === null || upper === null || !Number.isFinite(lower) || !Number.isFinite(upper)
    ? 'Unavailable' : `${decimal(lower, digits)} to ${decimal(upper, digits)}`;
}
