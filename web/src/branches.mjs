// Branches of one business (see the project plan plans/branches.md). The business keeps one set of
// records; every record made at a branch is tagged with it on the server. A business without
// branches has one implicit "Main branch" (id 'main'), so nothing changes until a second is added.
/**
 * A branch or store. type: what the branch does (retail, print or both; left out = the business's
 * type). prices: 'own' = the branch sets its own prices, 'main' = it uses the main branch's (left out
 * = the business's older branchPricing setting). sells: 'chosen' = only the items picked for it
 * (each item lists the branches in soldAt), 'all' or left out = every item.
 * customers: 'own' = the branch has its own customers only; 'shared' or left out = the customer
 * list is shared (its Customers page shows those who bought there or were added there).
 * @typedef {{ id: string, name: string, address: string, phone: string, archived: boolean, kind?: 'branch' | 'store', type?: 'both' | 'print' | 'retail', prices?: 'main' | 'own', sells?: 'all' | 'chosen', customers?: 'shared' | 'own' }} Branch
 */
export const MAIN = 'main';
const ID = /^(main|b-[a-z0-9]{6,20})$/;

/** A new branch id. */
export const newBranchId = () => `b-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

/** Checked, tidied branch list. The first branch is always the main one. */
export function validateBranches(input) {
  const list = input === undefined || input === null ? [] : input;
  if (!Array.isArray(list) || list.length > 50) throw Error('Invalid branches.');
  const seen = new Set();
  const names = new Set();
  const out = list.map((b, i) => {
    if (!b || typeof b !== 'object') throw Error('Invalid branches.');
    const id = String(b.id ?? '');
    if (!ID.test(id) || seen.has(id)) throw Error('Invalid branches.');
    if ((i === 0) !== (id === MAIN)) throw Error('The first branch must be the main branch.');
    seen.add(id);
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 80) throw Error('Give every branch a name of up to 80 characters.');
    if (names.has(name.toLowerCase())) throw Error('Two branches cannot have the same name.');
    names.add(name.toLowerCase());
    const archived = !!b.archived;
    if (archived && id === MAIN) throw Error('The main branch cannot be archived.');
    const kind = b.kind === 'store' ? 'store' : 'branch';
    if (kind === 'store' && id === MAIN) throw Error('The main branch cannot be a store.');
    if (b.type !== undefined && !['both', 'print', 'retail'].includes(b.type))
      throw Error('Choose what each branch does.');
    if (b.prices !== undefined && !['main', 'own'].includes(b.prices))
      throw Error('Choose how each branch prices items.');
    if (b.sells !== undefined && !['all', 'chosen'].includes(b.sells))
      throw Error('Choose which items each branch sells.');
    if (b.customers !== undefined && !['shared', 'own'].includes(b.customers))
      throw Error('Choose whether each branch shares customers.');
    const sales = kind === 'branch';
    return {
      ...(kind === 'store' ? { kind } : {}),
      ...(sales && b.type ? { type: b.type } : {}),
      ...(sales && id !== MAIN && b.prices ? { prices: b.prices } : {}),
      ...(sales && id !== MAIN && b.sells === 'chosen' ? { sells: 'chosen' } : {}),
      ...(sales && id !== MAIN && b.customers === 'own' ? { customers: 'own' } : {}),
      id,
      name,
      address: String(b.address ?? '')
        .trim()
        .slice(0, 300),
      phone: String(b.phone ?? '')
        .trim()
        .slice(0, 80),
      archived,
    };
  });
  return out;
}

/** Which branches each staff member may work in: { [memberId]: ['main', 'b-…'] or ['*'] }. */
export function validateBranchAccess(input, branches = []) {
  const value = input === undefined || input === null ? {} : input;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 500)
    throw Error('Invalid branch access.');
  const ids = new Set([MAIN, ...branches.map((b) => b.id)]);
  const out = {};
  for (const [member, list] of Object.entries(value)) {
    if (!/^[0-9a-f-]{36}$/i.test(member) || !Array.isArray(list)) throw Error('Invalid branch access.');
    const clean = list.includes('*') ? ['*'] : [...new Set(list.map(String))].filter((id) => ids.has(id));
    if (clean.length) out[member] = clean;
  }
  return out;
}

/**
 * The business's branches, with the implicit main branch when none are set.
 * @param {{ branches?: Branch[] } | null | undefined} settings
 * @returns {Branch[]}
 */
export function branchesOf(settings) {
  const list = settings?.branches ?? [];
  if (list.length) return list;
  return [{ id: MAIN, name: 'Main branch', address: '', phone: '', archived: false }];
}
/** More than one branch in use. */
export const hasBranches = (settings) => branchesOf(settings).filter((b) => !b.archived).length > 1;

/**
 * The branches a staff member may work in (active ones only). Developers and staff given every
 * branch ('*') may use all; anyone not listed works in the main branch.
 * @param {{ branches?: Branch[], branchAccess?: Record<string, string[]> } | null | undefined} settings
 * @param {string} memberId
 * @returns {Branch[]}
 */
export function allowedBranches(settings, memberId, accessLevel = 0) {
  const active = branchesOf(settings).filter((b) => !b.archived);
  const access = settings?.branchAccess?.[memberId];
  if (accessLevel >= 4 || access?.includes('*')) return active;
  const list = access?.length ? access : [MAIN];
  const allowed = active.filter((b) => list.includes(b.id));
  return allowed.length ? allowed : active.filter((b) => b.id === MAIN);
}
/** Whether this staff member sees every branch (the business owner). */
export const seesAllBranches = (settings, memberId, accessLevel = 0) =>
  accessLevel >= 4 || !!settings?.branchAccess?.[memberId]?.includes('*');

/** The branch record (null when the id is unknown). */
export const branchOf = (settings, id) => branchesOf(settings).find((b) => b.id === (id || MAIN)) ?? null;

/** Whether a branch (not main) sets its own prices: its own choice, or the business's older setting. */
export function ownPrices(settings, id) {
  if (!id || id === MAIN) return false;
  const b = branchOf(settings, id);
  if (!b || b.kind === 'store') return false;
  return b.prices ? b.prices === 'own' : settings?.branchPricing === 'perBranch';
}

/** Whether a branch sells only the items chosen for it. */
export const sellsChosen = (settings, id) => branchOf(settings, id)?.sells === 'chosen';

/** Whether a branch keeps its own customers (not shared with the other branches). */
export const ownCustomers = (settings, id) => branchOf(settings, id)?.customers === 'own';

/**
 * Customers as a branch sees them (records already this branch's, see branchLedger):
 * * creditLimit is the branch's own limit (creditLimits[branch]; the customer's limit until set),
 *   with the customer's own kept in baseCreditLimit;
 * * workedHere: added at this branch or has any job, sale, payment or quotation here (the Customers
 *   page lists these; checkouts can still find every shared customer);
 * * a branch with its own customers sees only those.
 * @template T
 * @param {T} ledger
 * @returns {T}
 */
export function branchCustomersLedger(ledger, settings, id) {
  const l = /** @type {any} */ (ledger);
  const here = id || MAIN;
  const worked = new Set();
  for (const key of ['jobs', 'checkouts', 'payments', 'quotations'])
    for (const r of l[key] ?? []) if (r.customerId) worked.add(r.customerId);
  const customers = (l.customers ?? [])
    .map((c) => {
      const own = here === MAIN ? undefined : c.creditLimits?.[here];
      return {
        ...c,
        baseCreditLimit: c.creditLimit ?? 0,
        creditLimit: Number.isFinite(own) ? own : (c.creditLimit ?? 0),
        workedHere: (c.branchId || MAIN) === here || worked.has(c.id),
      };
    })
    .filter((c) => !ownCustomers(settings, here) || c.workedHere);
  return /** @type {T} */ ({ ...l, customers });
}

/** Whether an item is sold at a branch. */
export function soldAt(settings, service, id) {
  if (!sellsChosen(settings, id)) return true;
  return Array.isArray(service?.soldAt) && service.soldAt.includes(id);
}

/**
 * The business settings as a device in this branch sees them: a branch with its own type (retail,
 * print or both) shows the parts of the app for that type. Parts the business turned on or off stay
 * as set when the branch's type is the business's own.
 */
export function settingsForBranch(settings, id) {
  const b = branchOf(settings, id);
  if (!b?.type || b.type === (settings?.businessType ?? 'both')) return settings;
  return { ...settings, businessType: b.type, features: {} };
}

/**
 * Minimum stock per location (branch or store), set there: { [locationId]: { [materialId]: number } }.
 * The main branch uses each material's own minimum; a location without its own uses that too.
 */
export function validateStockMinimums(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid minimum stock levels.');
  const out = {};
  for (const [location, list] of Object.entries(input)) {
    if (!/^b-[a-z0-9]{6,20}$/.test(location) || !list || typeof list !== 'object' || Array.isArray(list))
      continue;
    const kept = {};
    for (const [material, value] of Object.entries(list))
      if (/^[0-9a-f-]{36}$/i.test(material) && Number.isFinite(value) && value >= 0 && value <= 1e12)
        kept[material] = value;
    if (Object.keys(kept).length) out[location] = kept;
  }
  return out;
}

/** A material's minimum stock at a location (its own, else the material's). */
export function minimumAt(settings, material, location) {
  const base = material.minimumStock ?? 0;
  if (!location || location === MAIN) return base;
  const own = settings?.stockMinimums?.[location]?.[material.id];
  return Number.isFinite(own) ? own : base;
}

/** The minimum that applies on this device: the location's own (minimumHere), else the material's. */
export const minimumHere = (material) => material?.minimumHere ?? material?.minimumStock ?? 0;

/**
 * The records as a branch or store sees them: materials with a minimum set there carry it as
 * minimumHere (minimumStock stays the material's own, which editing changes).
 * @template T
 * @param {T} ledger
 * @returns {T}
 */
export function withLocationMinimums(ledger, settings, id) {
  const own = settings?.stockMinimums?.[id];
  if (!id || id === MAIN || !own || !Object.keys(own).length) return ledger;
  const l = /** @type {any} */ (ledger);
  return /** @type {T} */ ({
    ...l,
    materials: (l.materials ?? []).map((m) =>
      Number.isFinite(own[m.id]) ? { ...m, minimumHere: own[m.id] } : m,
    ),
  });
}

/** Materials used by the items a branch sells (fixed material, choices and production materials). */
export function materialsUsed(services) {
  const used = new Set();
  for (const s of services ?? []) {
    if (s.materialId) used.add(s.materialId);
    for (const id of s.materialOptions ?? []) used.add(id);
    const production = s.production ?? {};
    for (const list of Object.values(production))
      if (Array.isArray(list)) for (const line of list) if (line?.materialId) used.add(line.materialId);
  }
  return used;
}

/**
 * The records as a branch that sells chosen items sees them: other items are put aside (marked
 * archived and notSoldHere, so old sales still show their names but they cannot be sold), and
 * materials none of its items use are marked hiddenHere unless the branch holds some.
 * @template T
 * @param {T} ledger
 * @returns {T}
 */
export function chosenItemsLedger(ledger, settings, id) {
  if (!sellsChosen(settings, id)) return ledger;
  const l = /** @type {any} */ (ledger);
  const services = (l.services ?? []).map((s) =>
    soldAt(settings, s, id) ? s : { ...s, archived: true, notSoldHere: true },
  );
  const used = materialsUsed(services.filter((s) => !s.notSoldHere));
  const materials = (l.materials ?? []).map((m) =>
    used.has(m.id) || Number(m.available ?? 0) !== 0 ? m : { ...m, hiddenHere: true },
  );
  return /** @type {T} */ ({ ...l, services, materials });
}

/**
 * An item with the business's own prices: devices in a branch with its own prices receive items
 * priced for the branch, with the business values under base (used when editing the item).
 * @template T
 * @param {T} service
 * @returns {T}
 */
export function baseService(service) {
  const base = /** @type {any} */ (service)?.base;
  if (!base) return service;
  const { base: _b, branchPriced: _p, ...rest } = /** @type {any} */ (service);
  return { ...rest, ...base };
}

// ---- Records by branch (stage 1b) ----
// The branch this device works in, for working out balances and showing records. Records the
// server sends carry branchId (none = the main branch); records made on this device are tagged
// with this branch as they are recorded.
let localBranch = MAIN;
let localChosen = false;
/** The device's branch; chosen = it sells only the items chosen for it (new items are sold there). */
export function setLocalBranch(id, chosen = false) {
  localBranch = id || MAIN;
  localChosen = !!chosen && localBranch !== MAIN;
}
export const localBranchId = () => localBranch;
/** Whether a record belongs to the branch (this device's by default). */
export const inBranch = (record, id = localBranch) => (record?.branchId ?? MAIN) === id;
/**
 * The owner's view of every branch together: a ledger marked branchScope 'all' counts each
 * customer's accounts in all branches (see checkout.mjs walletBalance and accountToken).
 * @template T
 * @param {T} ledger
 * @returns {T}
 */
export const allBranchesLedger = (ledger) => ({ ...ledger, branchScope: 'all' });
/** Whether a record counts in this view of the records. */
export const counts = (ledger, record) => ledger?.branchScope === 'all' || inBranch(record);
/** The parts of the records that belong to one branch. */
export const BRANCH_KEYS = [
  'jobs',
  'payments',
  'checkouts',
  'expenses',
  'drawerClosings',
  'saleAdjustments',
  'quotations',
  'reminders',
  'materialWaste',
  'materialHistory',
];
/**
 * The records of one branch: everything shared (customers, services, stock…) and only that
 * branch's sales, jobs, payments and the rest.
 * @template T
 * @param {T} ledger
 * @returns {T}
 */
export function branchLedger(ledger, id = localBranch) {
  const out = { ...ledger };
  for (const key of BRANCH_KEYS)
    if (Array.isArray(ledger?.[key])) out[key] = ledger[key].filter((r) => inBranch(r, id));
  // Money accounts: the branch's own and the shared ones. Account entries (transfers,
  // reconciliations, assignments) show when they touch one of the branch's own accounts.
  if (Array.isArray(ledger?.moneyAccounts)) {
    const branchOf = (a) => a?.branch || MAIN;
    out.moneyAccounts = ledger.moneyAccounts.filter((a) => branchOf(a) === '*' || branchOf(a) === id);
    const own = new Set(out.moneyAccounts.filter((a) => branchOf(a) === id).map((a) => a.id));
    if (Array.isArray(ledger.accountEntries))
      out.accountEntries = ledger.accountEntries.filter(
        (e) => own.has(e.accountId) || own.has(e.toAccountId),
      );
  }
  // An expense's change history goes with the expense.
  if (Array.isArray(ledger?.expenseHistory) && Array.isArray(out.expenses)) {
    const kept = new Set(out.expenses.map((e) => e.id));
    out.expenseHistory = ledger.expenseHistory.filter((h) => kept.has(h.expenseId));
  }
  return out;
}
/** Tag records an operation just added with this device's branch (the main branch needs no tag). */
export function tagNewRecords(before, after, id = localBranch) {
  if (id === MAIN || before === after) return after;
  let out = after;
  // A customer added here belongs to this branch (where they were added; the server does the same).
  if (Array.isArray(after?.customers)) {
    const known = new Set((before?.customers ?? []).map((c) => c.id));
    if (after.customers.some((c) => !known.has(c.id) && !c.branchId)) {
      out = { ...out };
      out.customers = after.customers.map((c) =>
        known.has(c.id) || c.branchId ? c : { ...c, branchId: id },
      );
    }
  }
  // An item added at a branch that sells chosen items is sold there (the server does the same).
  if (localChosen && id === localBranch && Array.isArray(after?.services)) {
    const known = new Set((before?.services ?? []).map((s) => s.id));
    // (Unless the General Manager or Developer chose where it is sold: then soldAt is set.)
    if (after.services.some((s) => !known.has(s.id) && !s.soldAt)) {
      if (out === after) out = { ...after };
      out.services = after.services.map((s) => (known.has(s.id) || s.soldAt ? s : { ...s, soldAt: [id] }));
    }
  }
  for (const key of BRANCH_KEYS) {
    const old = before?.[key] ?? [];
    const now = after?.[key];
    if (!Array.isArray(now) || now.length <= old.length) continue;
    const known = new Set(old.map((r) => r.id));
    if (out === after) out = { ...after };
    out[key] = now.map((r) => (known.has(r.id) || r.branchId ? r : { ...r, branchId: id }));
  }
  return out;
}
