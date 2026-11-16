// Actual cost of stock (plans/actual-profit.md, part 1): what stock really cost, from restocks.
// A restock (Add to stock with a supplier price) records what the supplier charged for the quantity
// received (`cost` on the stock history line). Each material keeps a running **average actual cost**:
// (value in stock + restock cost) ÷ (units in stock + units received). Every movement out (jobs, shelf
// sales, waste, transfers) takes stock at the average **at that moment**, so later restocks never change
// what earlier use cost. Stock added without a price (returns, gifts, counts) comes in at the current
// average and is counted as "no cost". Stock held before the first restock starts at the estimated cost
// per unit (Pricing Templates → Costs), as agreed for go-live.
import { materialUnitCost } from './profit.mjs';

const MAX_KOBO = 100_000_000_000;

/**
 * A restock's cost as entered: the supplier's price for the quantity (kobo), the supplier, and extras
 * already included in that price (text). Null when no price was given.
 * @returns {{ supplierPrice: number, supplier?: string, included?: string } | null}
 */
export function validRestockCost(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid restock cost.');
  const supplierPrice = input.supplierPrice;
  if (!Number.isSafeInteger(supplierPrice) || supplierPrice < 0 || supplierPrice > MAX_KOBO)
    throw Error('Enter the supplier price for this quantity.');
  const supplier = String(input.supplier ?? '').trim();
  const included = String(input.included ?? '').trim();
  if (supplier.length > 80 || /[\x00-\x1f\x7f]/.test(supplier)) throw Error('Keep the supplier name to 80 characters.');
  if (included.length > 200 || /[\x00-\x1f\x7f]/.test(included))
    throw Error('Keep "already included" to 200 characters.');
  return { supplierPrice, ...(supplier ? { supplier } : {}), ...(included ? { included } : {}) };
}

const byTime = (a, b) => Date.parse(a.changedAt) - Date.parse(b.changedAt) || String(a.id).localeCompare(String(b.id));
const valuationCache = new WeakMap();

/**
 * Every material's stock at actual cost: quantity, value (kobo), average cost per unit, the units that
 * came in with no cost, and the cost per unit each history line moved at.
 * @returns {Map<string, { quantity: number, value: number, average: number | null, noCost: number, restocks: number, unitCost: Map<string, number | null> }>}
 */
export function stockValuation(ledger) {
  const cached = valuationCache.get(ledger);
  if (cached) return cached;
  const result = new Map();
  for (const entry of [...(ledger.materialHistory ?? [])].sort(byTime)) {
    let m = result.get(entry.materialId);
    if (!m) {
      const estimate = materialUnitCost(ledger, entry.materialId);
      m = { quantity: 0, value: 0, average: estimate, noCost: 0, restocks: 0, unitCost: new Map() };
      result.set(entry.materialId, m);
    }
    const before = entry.beforeAvailable ?? 0;
    const after = entry.afterAvailable ?? before;
    // Start (or pick up after a gap, e.g. a device keeping recent history only) from the stock the line
    // says was there, at the average so far.
    if (entry.beforeAvailable !== null && entry.beforeAvailable !== undefined && before !== m.quantity) {
      m.quantity = before;
      m.value = m.average === null ? 0 : Math.max(0, before) * m.average;
    }
    const change = Math.round((after - before) * 1000) / 1000;
    const cost = entry.after?.cost;
    if (entry.action === 'material.stock_added' && cost && change > 0) {
      // A restock: its price joins the stock at the average so far.
      const held = Math.max(0, m.quantity);
      // Stock held with no cost known at all (no estimate either) takes this restock's price.
      if (m.average === null) m.value = held * (cost.supplierPrice / change);
      m.value = (held > 0 ? m.value : 0) + cost.supplierPrice;
      m.quantity = after;
      m.average = held + change > 0 ? m.value / (held + change) : m.average;
      m.restocks += 1;
      m.unitCost.set(entry.id, change > 0 ? cost.supplierPrice / change : null);
    } else {
      // Anything else moves at the current average (no cost for additions without a price).
      if (change > 0 && entry.action !== 'material.stock_set' && entry.beforeAvailable !== null) m.noCost += change;
      m.quantity = after;
      m.value = m.average === null ? 0 : Math.max(0, m.quantity) * m.average;
      m.unitCost.set(entry.id, m.average);
    }
  }
  // Materials with no history yet: their stock at the estimated cost.
  for (const material of ledger.materials ?? [])
    if (!result.has(material.id)) {
      const average = materialUnitCost(ledger, material.id);
      result.set(material.id, {
        quantity: material.available,
        value: average === null ? 0 : Math.max(0, material.available) * average,
        average,
        noCost: 0,
        restocks: 0,
        unitCost: new Map(),
      });
    }
  for (const m of result.values()) m.value = Math.round(m.value);
  valuationCache.set(ledger, result);
  return result;
}

/** One material's stock at actual cost (see stockValuation). */
export const materialValuation = (ledger, materialId) => stockValuation(ledger).get(materialId) ?? null;

/** Total value of the stock held, and how many materials have stock without any cost. */
export function stockTotals(ledger) {
  let value = 0,
    uncosted = 0;
  for (const material of ledger.materials ?? []) {
    if (material.archived) continue;
    const m = materialValuation(ledger, material.id);
    if (!m) continue;
    value += m.value;
    if (m.average === null && material.available > 0) uncosted += 1;
  }
  return { value, uncosted };
}
