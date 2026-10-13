// Reorder list: stock items at or near their minimum, with a suggested quantity to buy.
// Suggested quantity: enough to reach twice the minimum, or the minimum plus the last 30 days'
// use, whichever is more, rounded up to a whole unit.
import { stockLevel } from './material-display.mjs';

const used = new Set([
  'material.job_used',
  'material.job_corrected',
  'material.sale_returned',
  'material.wasted',
]);

/**
 * @param {import('./types').Ledger} ledger
 */
export function reorderList(ledger, now = new Date().toISOString()) {
  const since = Date.parse(now) - 30 * 86400000;
  return ledger.materials
    .filter((m) => stockLevel(m))
    .map((m) => {
      let used30 = 0;
      for (const h of ledger.materialHistory)
        if (h.materialId === m.id && used.has(h.action) && Date.parse(h.changedAt) >= since)
          used30 -= (h.afterAvailable ?? 0) - (h.beforeAvailable ?? 0);
      used30 = Math.max(0, Math.round(used30 * 1000) / 1000);
      const minimum = m.minimumStock ?? 0;
      const target = Math.max(minimum * 2, minimum + used30);
      const suggested = Math.max(1, Math.ceil(target - m.available));
      return {
        materialId: m.id,
        name: m.name,
        unit: m.measurementUnit,
        available: m.available,
        minimum,
        used30,
        level: stockLevel(m),
        suggested,
      };
    })
    .sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'Critical' ? -1 : 1));
}

/** A plain list to send to a supplier. */
export function reorderText(rows, business) {
  return [
    `Order${business ? ` from ${business}` : ''}:`,
    ...rows.map((r) => `- ${r.name}: ${r.quantity} ${r.unit}`),
    'Please confirm prices and delivery. Thank you.',
  ].join('\n');
}
