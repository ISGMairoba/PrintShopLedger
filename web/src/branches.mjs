// Branches of one business (see the project plan plans/branches.md). The business keeps one set of
// records; every record made at a branch is tagged with it on the server. A business without
// branches has one implicit "Main branch" (id 'main'), so nothing changes until a second is added.
/** @typedef {{ id: string, name: string, address: string, phone: string, archived: boolean }} Branch */
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
    return {
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
export function setLocalBranch(id) {
  localBranch = id || MAIN;
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
