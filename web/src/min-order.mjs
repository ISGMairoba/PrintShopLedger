// An item's minimum order (services.minQuantity, in pieces) and what happens below it, set by the
// business (Business Settings → Jobs & payments → Minimum order): 'block' (default, a sale with less
// cannot be saved; the server refuses it too) or 'warn' (it can, with a note on the line).
let rule = 'block';

/** Set by the app from the business's settings. */
export function setMinOrderRule(value) {
  rule = value === 'warn' ? 'warn' : 'block';
}
export const minOrderRule = () => rule;

/** The note for a line below its item's minimum order, or ''. */
export function belowMinimum(service, quantity) {
  const min = Number(service?.minQuantity ?? 0);
  return min > 0 && Number(quantity) < min ? `Minimum order is ${min}.` : '';
}

/** The quantity a first tap adds: the item's minimum order, else 1. */
export const startQuantity = (service) => Math.max(1, Number(service?.minQuantity ?? 0) || 1);
