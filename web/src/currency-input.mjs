// Group digits without converting to floating point or silently rounding a cashier's entry.
export function formatAmount(raw, complete = false) {
  if (!/^\d*(?:\.\d*)?$/.test(raw) || !raw) return raw;
  const [whole, fraction] = raw.split('.');
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return grouped + (complete && /^\d*(?:\.\d{0,2})?$/.test(raw) ? '.' + (fraction ?? '').padEnd(2, '0') : fraction !== undefined ? '.' + fraction : '');
}
export function amountError(raw, max = 1000000000) {
  if (!raw) return '';
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return 'Enter a non-negative amount with up to two decimal places.';
  if (Number(raw) > max) return `Amount cannot exceed ${formatAmount(String(max), true)}.`;
  return '';
}
