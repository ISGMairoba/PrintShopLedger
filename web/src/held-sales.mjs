// Point of Service → Hold sale: put a cart aside to serve the next customer, then resume it.
// Held sales stay on this device only (browser storage, per business), are not sent to the
// business and do not reserve stock. Completing a resumed sale removes it.

/** Held sales older than this are flagged so they are finished or discarded. */
export const OLD_AFTER_HOURS = 48;
const LIMIT = 30;

export const heldKey = (scope) => `psl-held-sales:${scope}`;

/** The held sales of this business on this device, newest first. */
export function listHeld(storage, scope) {
  try {
    const value = JSON.parse(storage?.getItem(heldKey(scope)) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter((h) => h && typeof h.id === 'string' && (h.kind === 'checkout' || h.kind === 'quick'))
          .sort((a, b) => String(b.heldAt).localeCompare(String(a.heldAt)))
      : [];
  } catch {
    return [];
  }
}

function write(storage, scope, list) {
  try {
    storage?.setItem(heldKey(scope), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * Holds a sale (a resumed one keeps its id, so it replaces itself). Returns the new list; throws
 * when this device cannot keep it or already holds the most it may.
 */
export function holdSale(storage, scope, sale) {
  const others = listHeld(storage, scope).filter((h) => h.id !== sale.id);
  if (others.length >= LIMIT)
    throw Error(`This device already holds ${LIMIT} sales. Finish or discard some first.`);
  const list = [sale, ...others];
  if (!write(storage, scope, list))
    throw Error('This device could not keep the sale. Complete it now instead.');
  return list;
}

export function removeHeld(storage, scope, id) {
  const list = listHeld(storage, scope).filter((h) => h.id !== id);
  write(storage, scope, list);
  return list;
}

/** Whether a held sale has waited long enough to be flagged. */
export const isOld = (sale, now = Date.now()) =>
  now - Date.parse(sale.heldAt) > OLD_AFTER_HOURS * 3600 * 1000;

/** A short name for a held sale: the customer (or note), then what is in it. */
export function heldLabel(sale) {
  const who = sale.note?.trim() || sale.customerName?.trim() || 'No customer yet';
  const items = (sale.items ?? []).filter(Boolean);
  const what = items.length
    ? items.slice(0, 2).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '')
    : 'No items';
  return `${who} · ${what}`;
}
