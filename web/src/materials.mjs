import { normalizeCustomer } from './customers.mjs';
import { materialSnapshot } from './material-display.mjs';
/**
 * A full download may send each sale's jobs shortened to what differs from the job's current record
 * (jobsTrimmed): rebuild the whole copy, as it was at the sale, from the job records.
 */
export function rebuildSaleJobs(checkouts = [], jobs = []) {
  if (!checkouts.some((c) => c?.jobsTrimmed)) return checkouts;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return checkouts.map((c) => {
    if (!c?.jobsTrimmed) return c;
    const { jobsTrimmed: _trimmed, ...rest } = c;
    return {
      ...rest,
      jobs: (c.jobs ?? []).map(({ $gone, ...j }) => {
        const job = { ...(byId.get(j.id) ?? {}), ...j };
        for (const key of $gone ?? []) delete job[key];
        return job;
      }),
    };
  });
}
export function normalizeLedger(ledger) {
  return {
    ...ledger,
    payees: ledger.payees ?? [],
    moneyAccounts: ledger.moneyAccounts ?? [],
    accountEntries: ledger.accountEntries ?? [],
    repeatingExpenses: ledger.repeatingExpenses ?? [],
    operationHistory: ledger.operationHistory ?? [],
    saleAdjustments: ledger.saleAdjustments ?? [],
    materialWaste: ledger.materialWaste ?? [],
    expenses: ledger.expenses ?? [],
    expenseHistory: ledger.expenseHistory ?? [],
    drawerClosings: ledger.drawerClosings ?? [],
    checkouts: rebuildSaleJobs(ledger.checkouts ?? [], ledger.jobs ?? []),
    customers: (ledger.customers ?? []).map(normalizeCustomer),
    materials: ledger.materials ?? [],
    materialHistory: ledger.materialHistory ?? [],
    services: ledger.services ?? [],
    // Deleted quotations stay on the server for the record but are not shown anywhere.
    quotations: (ledger.quotations ?? []).filter((q) => q.status !== 'deleted'),
    reminders: ledger.reminders ?? [],
  };
}
export function validateMaterial(data) {
  const minimum = data.minimumStock ?? 0;
  if (
    typeof minimum !== 'number' ||
    !Number.isFinite(minimum) ||
    minimum < 0 ||
    minimum > 1000000000000 ||
    Math.abs(minimum * 1000 - Math.round(minimum * 1000)) > 0.001
  )
    throw new Error('Minimum stock must be zero or greater, with at most three decimal places.');
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 160)
    throw new Error('Enter a material name (up to 160 characters).');
  if (
    typeof data.measurementUnit !== 'string' ||
    !data.measurementUnit.trim() ||
    data.measurementUnit.trim().length > 40
  )
    throw new Error('Enter a measurement unit (up to 40 characters).');
  if (typeof data.requireSize !== 'boolean') throw new Error('Require Size must be Yes or No.');
  if (
    typeof data.available !== 'number' ||
    !Number.isFinite(data.available) ||
    data.available < -1000000000000 ||
    data.available > 1000000000000 ||
    Math.abs(data.available * 1000 - Math.round(data.available * 1000)) > 0.001
  )
    throw new Error('Available must be within the supported range, with at most three decimal places.');
}
/**
 * Materials → Split: cut stock of one material into a smaller one (1 A4 makes 2 A5), or put it
 * back together (join, to fix a split entered by mistake). Both stock levels change in one step,
 * each with its own history entry.
 */
export function splitPlan(from, to, quantity, made, join = false) {
  for (const [n, what] of [
    [quantity, 'how many to ' + (join ? 'put back together' : 'split')],
    [made, 'how many one item makes'],
  ])
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n <= 0 ||
      n > 1000000000 ||
      Math.abs(n * 1000 - Math.round(n * 1000)) > 0.001
    )
      throw new Error(`Enter ${what}: greater than zero, at most three decimal places.`);
  const change = Math.round(quantity * made * 1000) / 1000;
  return {
    from: Math.round((from.available + (join ? quantity : -quantity)) * 1000) / 1000,
    to: Math.round((to.available + (join ? -change : change)) * 1000) / 1000,
    change,
  };
}
/** The pieces of a split: the event's "pieces", or its single toId/yield (from an older app). */
export function splitPieces(data) {
  if (Array.isArray(data.pieces)) return data.pieces;
  return [{ toId: data.toId, toBaseVersion: data.toBaseVersion, toEventId: data.toEventId, yield: data.yield }];
}
function splitMaterial(ledger, event, existing, audit, record) {
  const d = event.data;
  if (existing.archived) throw new Error('Restore both materials before splitting stock.');
  if (!existing.canSplit) throw new Error(`Turn on "Can be split" for ${existing.name} first.`);
  if (d.reason && (typeof d.reason !== 'string' || d.reason.length > 500))
    throw new Error('Stock note must be up to 500 characters.');
  const pieces = splitPieces(d);
  if (pieces.length < 1 || pieces.length > 20) throw new Error('Add between 1 and 20 pieces.');
  const seen = new Set([existing.id]);
  const events = new Set([event.id]);
  let fromAvailable = existing.available;
  const changed = new Map();
  const history = [];
  for (const piece of pieces) {
    const to = ledger.materials.find((m) => m.id === piece.toId);
    if (!to || to.id === existing.id) throw new Error('Choose the other material.');
    if (seen.has(to.id)) throw new Error('Choose each smaller material once, and not the one being split.');
    seen.add(to.id);
    if (to.archived) throw new Error('Restore both materials before splitting stock.');
    if (to.version !== piece.toBaseVersion)
      throw new Error('This material changed elsewhere. Sync and reopen it before editing.');
    if (!piece.toEventId || events.has(piece.toEventId) || ledger.materialHistory.some((h) => h.id === piece.toEventId))
      throw new Error('Material identity and audit information are required.');
    events.add(piece.toEventId);
    const plan = splitPlan({ available: fromAvailable }, to, d.quantity, piece.yield, !!d.join);
    const toNext = { ...to, available: plan.to, ...audit, lastEventId: piece.toEventId, version: to.version + 1 };
    validateMaterial(toNext);
    changed.set(to.id, toNext);
    history.push({ to, toNext, eventId: piece.toEventId });
  }
  fromAvailable = splitPlan(existing, history[0].to, d.quantity, pieces[0].yield, !!d.join).from;
  const fromNext = { ...existing, available: fromAvailable, ...audit, version: existing.version + 1 };
  validateMaterial(fromNext);
  const main = record(fromNext);
  const seconds = history.map(({ to, toNext, eventId }) => ({
    ...main,
    id: eventId,
    materialId: to.id,
    materialName: to.name,
    measurementUnit: to.measurementUnit,
    beforeAvailable: to.available,
    afterAvailable: toNext.available,
    before: materialSnapshot(to),
    after: materialSnapshot(toNext),
  }));
  return {
    ...ledger,
    materials: ledger.materials.map((m) => (m.id === existing.id ? fromNext : (changed.get(m.id) ?? m))),
    materialHistory: [...ledger.materialHistory, main, ...seconds],
  };
}
export function applyMaterialEvent(input, event) {
  const ledger = normalizeLedger(input);
  const data = event.data;
  if (
    !event.id ||
    !data.id ||
    !data.modifiedBy ||
    !data.modifiedAt ||
    Number.isNaN(Date.parse(data.modifiedAt))
  )
    throw new Error('Material identity and audit information are required.');
  if (ledger.materialHistory.some((entry) => entry.id === event.id)) return ledger;
  const existing = ledger.materials.find((material) => material.id === data.id);
  if (existing?.lastEventId === event.id) return ledger;
  const audit = {
    modifiedBy: data.modifiedBy,
    modifiedByLabel: data.modifiedByLabel ?? data.modifiedBy,
    modifiedAt: data.modifiedAt,
    lastEventId: event.id,
  };
  const record = (next) => ({
    id: event.id,
    materialId: next.id,
    materialName: next.name,
    measurementUnit: next.measurementUnit,
    action: event.kind,
    beforeAvailable: existing?.available ?? null,
    afterAvailable: next.available,
    reason: data.reason?.trim() ?? '',
    changedBy: next.modifiedBy,
    changedByLabel: next.modifiedByLabel,
    changedAt: next.modifiedAt,
    before: materialSnapshot(existing),
    after: materialSnapshot(next),
    detailsComplete: true,
  });
  let next;
  if (event.kind === 'material.created') {
    if (existing) throw new Error('This material ID is already in use.');
    validateMaterial(data);
    next = {
      id: data.id,
      name: data.name.trim(),
      available: data.available,
      measurementUnit: data.measurementUnit.trim(),
      requireSize: data.requireSize,
      minimumStock: data.minimumStock ?? 0,
      canSplit: data.canSplit ?? false,
      archived: false,
      version: 1,
      createdBy: data.modifiedBy,
      createdByLabel: audit.modifiedByLabel,
      createdAt: data.modifiedAt,
      ...audit,
    };
    return {
      ...ledger,
      materials: [...ledger.materials, next],
      materialHistory: [...ledger.materialHistory, record(next)],
    };
  }
  if (!existing) throw new Error('Material not found.');
  if (data.baseVersion !== existing.version)
    throw new Error('This material changed elsewhere. Sync and reopen it before editing.');
  if (event.kind === 'material.split') return splitMaterial(ledger, event, existing, audit, record);
  if (event.kind === 'material.updated') {
    if (existing.archived) throw new Error('Restore this material before editing it.');
    validateMaterial(data);
    next = {
      ...existing,
      name: data.name.trim(),
      available: existing.available,
      measurementUnit: data.measurementUnit.trim(),
      requireSize: data.requireSize,
      minimumStock: data.minimumStock ?? existing.minimumStock ?? 0,
      canSplit: data.canSplit ?? existing.canSplit ?? false,
      ...audit,
      version: existing.version + 1,
    };
  } else if (event.kind === 'material.stock_added' || event.kind === 'material.stock_set') {
    if (existing.archived) throw new Error('Restore this material before changing stock.');
    validateMaterial({ ...existing, available: data.quantity });
    if (event.kind === 'material.stock_added' && data.quantity <= 0)
      throw new Error('Enter a quantity greater than zero to add to stock.');
    if (data.reason && (typeof data.reason !== 'string' || data.reason.length > 500))
      throw new Error('Stock note must be up to 500 characters.');
    const available =
      event.kind === 'material.stock_added'
        ? Math.round((existing.available + data.quantity) * 1000) / 1000
        : data.quantity;
    validateMaterial({ ...existing, available });
    next = { ...existing, available, ...audit, version: existing.version + 1 };
  } else if (event.kind === 'material.archived' || event.kind === 'material.restored') {
    const archived = event.kind === 'material.archived';
    if (archived === existing.archived)
      throw new Error(archived ? 'Material is already archived.' : 'Material is already active.');
    next = { ...existing, archived, ...audit, version: existing.version + 1 };
  } else throw new Error('Unknown material operation.');
  return {
    ...ledger,
    materials: ledger.materials.map((material) => (material.id === data.id ? next : material)),
    materialHistory: [...ledger.materialHistory, record(next)],
  };
}
