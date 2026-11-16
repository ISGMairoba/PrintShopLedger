// Actual cost of stock (plans/actual-profit.md, part 1): what stock really cost, from restocks.
// A restock (Add to stock with a supplier price) records what the supplier charged for the quantity
// received (`cost` on the stock history line). Each material keeps a running **average actual cost**:
// (value in stock + restock cost) ÷ (units in stock + units received). Every movement out (jobs, shelf
// sales, waste, transfers) takes stock at the average **at that moment**, so later restocks never change
// what earlier use cost. Stock added without a price (returns, gifts, counts) comes in at the current
// average and is counted as "no cost". Stock held before the first restock starts at the estimated cost
// per unit (Pricing Templates → Costs), as agreed for go-live.
import { jobCost, linkedExpenseShares, materialUnitCost } from './profit.mjs';
import { businessDay } from './dashboard.mjs';
import { materialPending } from './material-choice.mjs';

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
  if (supplier.length > 80 || /[\x00-\x1f\x7f]/.test(supplier))
    throw Error('Keep the supplier name to 80 characters.');
  if (included.length > 200 || /[\x00-\x1f\x7f]/.test(included))
    throw Error('Keep "already included" to 200 characters.');
  return { supplierPrice, ...(supplier ? { supplier } : {}), ...(included ? { included } : {}) };
}

const byTime = (a, b) => Date.parse(a.changedAt) - Date.parse(b.changedAt) || String(a.id).localeCompare(String(b.id));
const valuationCache = new WeakMap();

/**
 * Expenses for restocks (Expenses → For restocks), shared among their restocks by supplier price
 * (equally when all are free). Voided expenses are left out.
 * @returns {{ restockId: string, expenseId: string, amount: number, at: string }[]}
 */
export function restockExtras(ledger) {
  const restocks = new Map(
    (ledger.materialHistory ?? []).filter((h) => h.after?.cost).map((h) => [h.id, h]),
  );
  const out = [];
  for (const e of ledger.expenses ?? []) {
    if (e.voided || !e.restockIds?.length) continue;
    const linked = e.restockIds.map((id) => restocks.get(id)).filter(Boolean);
    if (!linked.length) continue;
    const total = linked.reduce((n, h) => n + h.after.cost.supplierPrice, 0);
    for (const h of linked)
      out.push({
        restockId: h.id,
        expenseId: e.id,
        amount: total > 0 ? (e.amount * h.after.cost.supplierPrice) / total : e.amount / linked.length,
        at: e.createdAt ?? e.modifiedAt ?? h.changedAt,
      });
  }
  return out;
}

/**
 * Every material's stock at actual cost: quantity, value (kobo), average cost per unit, the units that
 * came in with no cost, the cost per unit each history line moved at (and whether it was an actual cost
 * or still the estimate), and late cost adjustments.
 * An expense linked to a restock when the restock is recorded (or before) is part of its cost. One
 * recorded later is a **late cost**: the share for the units still in stock joins their value; the share
 * for units already used is a late cost adjustment on the day it was recorded (past jobs keep their cost).
 */
export function stockValuation(ledger) {
  const cached = valuationCache.get(ledger);
  if (cached) return cached;
  const result = new Map();
  const lateCosts = [];
  const extras = restockExtras(ledger);
  const history = ledger.materialHistory ?? [];
  const restockOf = new Map(history.map((h) => [h.id, h]));
  const timely = new Map();
  const timeline = [...history];
  for (const x of extras) {
    const h = restockOf.get(x.restockId);
    if (Date.parse(x.at) <= Date.parse(h.changedAt)) timely.set(h.id, (timely.get(h.id) ?? 0) + x.amount);
    else
      timeline.push({
        id: `late:${x.expenseId}:${x.restockId}`,
        late: true,
        materialId: h.materialId,
        restock: h,
        amount: x.amount,
        expenseId: x.expenseId,
        changedAt: x.at,
      });
  }
  for (const entry of timeline.sort(byTime)) {
    let m = result.get(entry.materialId);
    if (!m) {
      const estimate = materialUnitCost(ledger, entry.materialId);
      m = { quantity: 0, value: 0, average: estimate, noCost: 0, restocks: 0, unitCost: new Map(), actual: new Set() };
      result.set(entry.materialId, m);
    }
    if (entry.late) {
      const received = (entry.restock.afterAvailable ?? 0) - (entry.restock.beforeAvailable ?? 0);
      const held = received > 0 ? Math.min(1, Math.max(0, m.quantity) / received) : 0;
      m.value += entry.amount * held;
      if (m.quantity > 0) m.average = m.value / m.quantity;
      if (entry.amount * (1 - held) > 0)
        lateCosts.push({
          day: entry.changedAt,
          amount: entry.amount * (1 - held),
          materialId: entry.materialId,
          expenseId: entry.expenseId,
        });
      continue;
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
      // A restock: its price (and timely extras) join the stock at the average so far.
      const landed = cost.supplierPrice + (timely.get(entry.id) ?? 0);
      const held = Math.max(0, m.quantity);
      // Stock held with no cost known at all (no estimate either) takes this restock's price.
      if (m.average === null) m.value = held * (landed / change);
      m.value = (held > 0 ? m.value : 0) + landed;
      m.quantity = after;
      m.average = held + change > 0 ? m.value / (held + change) : m.average;
      m.restocks += 1;
      m.unitCost.set(entry.id, landed / change);
      m.actual.add(entry.id);
    } else {
      // Anything else moves at the current average (no cost for additions without a price).
      if (change > 0 && entry.action !== 'material.stock_set' && entry.beforeAvailable !== null) m.noCost += change;
      m.quantity = after;
      m.value = m.average === null ? 0 : Math.max(0, m.quantity) * m.average;
      m.unitCost.set(entry.id, m.average);
      if (m.restocks) m.actual.add(entry.id);
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
        actual: new Set(),
      });
    }
  for (const m of result.values()) m.value = Math.round(m.value);
  Object.defineProperty(result, 'lateCosts', { value: lateCosts });
  valuationCache.set(ledger, result);
  return result;
}

/** Late cost adjustments (see stockValuation) recorded from `from` to `to` (Lagos days). */
export const lateCostsIn = (ledger, from, to) =>
  (stockValuation(ledger).lateCosts ?? []).filter((c) => {
    const day = businessDay(c.day);
    return day >= from && day <= to;
  });

/**
 * A job's actual cost: the stock its history lines took (sale, production, materials confirmed, added
 * or returned, waste on the job) at the average of each moment, plus expenses linked to it. Template
 * labour and overhead lines are not actual costs. Jobs that took no stock use their estimate.
 * provisional: materials not yet confirmed. basis: 'Actual', 'Estimated' (stock moved before any
 * restock with a price) or the estimate's own basis.
 * @returns {{ kobo: number, known: boolean, provisional: boolean, basis: string }}
 */
export function actualJobCost(ledger, job) {
  const lines = (ledger.materialHistory ?? []).filter((h) => h.jobId === job.id);
  const linked = linkedExpenseShares(ledger).get(job.id) ?? 0;
  const provisional = materialPending(job) || job.materialCheck?.status === 'pending';
  if (!lines.length) {
    const estimate = jobCost(ledger, job);
    return { ...estimate, provisional, basis: `Estimated: ${estimate.basis}` };
  }
  const valuation = stockValuation(ledger);
  let kobo = 0,
    known = true,
    actual = true;
  for (const h of lines) {
    const m = valuation.get(h.materialId);
    const rate = m?.unitCost.get(h.id) ?? null;
    const taken = (h.beforeAvailable ?? 0) - (h.afterAvailable ?? 0);
    if (rate === null) {
      if (taken !== 0) known = false;
      continue;
    }
    kobo += taken * rate;
    if (!m.actual.has(h.id)) actual = false;
  }
  return {
    kobo: Math.round(kobo + linked),
    known,
    provisional,
    basis: actual ? 'Actual' : 'Estimated (no restock with a price yet)',
  };
}

/**
 * Waste not linked to a job (a period cost), from `from` to `to` (Lagos days), at the average of
 * each moment. unknown: lines with no cost to go on.
 */
export function wasteCost(ledger, from, to) {
  const valuation = stockValuation(ledger);
  let kobo = 0,
    unknown = 0;
  for (const h of ledger.materialHistory ?? []) {
    if (h.action !== 'material.wasted' || h.jobId) continue;
    const day = businessDay(h.changedAt);
    if (day < from || day > to) continue;
    const rate = valuation.get(h.materialId)?.unitCost.get(h.id) ?? null;
    const taken = (h.beforeAvailable ?? 0) - (h.afterAvailable ?? 0);
    if (rate === null) unknown += 1;
    else kobo += taken * rate;
  }
  return { kobo: Math.round(kobo), unknown };
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
