// Group digits without converting to floating point or silently rounding a cashier's entry.
export function formatAmount(raw, complete = false) {
  if (!/^\d*(?:\.\d*)?$/.test(raw) || !raw) return raw;
  const [whole, fraction] = (complete ? normalizeAmount(raw) : raw).split('.');
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    grouped +
    (complete && /^\d*(?:\.\d{0,2})?$/.test(raw)
      ? '.' + (fraction ?? '').padEnd(2, '0')
      : fraction !== undefined
        ? '.' + fraction
        : '')
  );
}
export function amountError(raw, max = 1000000000) {
  if (!raw) return '';
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return 'Enter a non-negative amount with up to two decimal places.';
  if (Number(raw) > max) return `Amount cannot exceed ${formatAmount(String(max), true)}.`;
  return '';
}

// Normalize valid entries only: never repair invalid decimals or discard a sign.
export function normalizeAmount(raw) {
  const text = raw.trim();
  if (!/^\d*(?:\.\d{0,2})?$/.test(text) || !text || text === '.') return raw;
  const [whole, fraction] = text.split('.');
  const integer = (whole || '0').replace(/^0+(?=\d)/, '');
  return integer + (fraction ? '.' + fraction : '');
}
// Commas in pasted amounts must use complete thousands groups.
export function pastedAmount(text) {
  const trimmed = text.trim();
  if (/^\.\d{0,2}$/.test(trimmed)) return '0' + trimmed;
  return /^\d{1,3}(?:,\d{3})+(?:\.\d{0,2})?$/.test(trimmed) ? trimmed.replaceAll(',', '') : trimmed;
}
