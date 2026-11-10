// Dashboard → Stock value: what the materials in stock are worth.
// * At cost: each active material's stock × its cost per unit (from Pricing Templates → Costs).
//   Materials with no cost set are counted separately, so the total is never guessed.
// * At selling price: only stock sold off the shelf has a selling price of its own — stock ÷ the
//   material one item uses × the shelf item's price (single-item price, before packs and
//   discounts). Its cost is shown beside it, so the gap is the possible profit on the shelf.
import { materialUnitCost } from './profit.mjs';
import { perItem } from './production-materials.mjs';

/**
 * @returns {{ atCost: number, costed: number, uncosted: number, uncostedNames: string[],
 *   shelfAtPrice: number, shelfAtCost: number, shelfItems: number, shelfUncosted: number }}
 */
export function stockValue(ledger) {
  let atCost = 0,
    costed = 0,
    shelfAtPrice = 0,
    shelfAtCost = 0,
    shelfItems = 0,
    shelfUncosted = 0;
  const uncostedNames = [];
  for (const m of ledger.materials ?? []) {
    if (m.archived) continue;
    const stock = Math.max(0, Number(m.available) || 0);
    const rate = materialUnitCost(ledger, m.id);
    if (rate === null) uncostedNames.push(m.name);
    else {
      costed++;
      atCost += stock * rate;
    }
    const shelf = ledger.services.find(
      (s) => s.shelfItem && !s.archived && !s.private && !s.customPrice && s.materialId === m.id && s.price > 0,
    );
    if (!shelf || !stock) continue;
    shelfItems++;
    shelfAtPrice += (stock / perItem(shelf)) * shelf.price;
    if (rate === null) shelfUncosted++;
    else shelfAtCost += stock * rate;
  }
  return {
    atCost: Math.round(atCost),
    costed,
    uncosted: uncostedNames.length,
    uncostedNames,
    shelfAtPrice: Math.round(shelfAtPrice),
    shelfAtCost: Math.round(shelfAtCost),
    shelfItems,
    shelfUncosted,
  };
}

/** The latest sales (checkouts with jobs), newest first. */
export function recentSales(ledger, limit = 10) {
  return [...(ledger.checkouts ?? [])]
    .filter((c) => (c.jobs?.length ?? 0) > 0)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((c) => ({
      record: c,
      customer:
        ledger.customers.find((x) => x.id === c.customerId)?.name ?? c.customerSnapshot?.name ?? 'Customer',
      items: c.jobs.map((j) => j.description || j.service).filter(Boolean),
      total: c.total,
      paid: c.cashReceived,
      method: c.methodLabel || c.method,
      by: c.createdByLabel,
      at: c.createdAt,
    }));
}
