// How much history this device keeps (My Account → This device). Everything is the default; a
// shorter choice makes the server send a copy without old closed records (see history-window.mjs
// and the ledger-window server function). Stored on this device only.
import { daysBefore, monthsBefore } from './history-window.mjs';
import { businessDay } from './dashboard.mjs';

export const KEEP_CHOICES = [
  ['all', 'Everything'],
  ['7d', 'Last 7 days'],
  ['14d', 'Last 14 days'],
  ['30d', 'Last 30 days'],
  ['3m', 'Last 3 months'],
  ['6m', 'Last 6 months'],
  ['12m', 'Last 12 months'],
];
const key = (scope) => `printshopledger:history-keep:${scope}`;
const businessKey = (scope) => `printshopledger:history-keep-business:${scope}`;
const valid = (value) => KEEP_CHOICES.some(([v]) => v === value);
const read = (storage, k) => {
  try {
    return storage?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
/** This device's own choice, or 'business' when it follows the business default. */
export function deviceChoice(scope, storage = globalThis.localStorage) {
  const value = read(storage, key(scope));
  return valid(value) ? value : 'business';
}
/** The business default (Business Settings → Security), as last seen on this device. */
export function businessKeepChoice(scope, storage = globalThis.localStorage) {
  const value = read(storage, businessKey(scope));
  return valid(value) ? value : 'all';
}
/** How much history this device keeps: its own choice, else the business default. */
export function keepChoice(scope, storage = globalThis.localStorage) {
  const own = deviceChoice(scope, storage);
  return own === 'business' ? businessKeepChoice(scope, storage) : own;
}
/** 'business' follows the business default; any other choice is this device's own. */
export function setKeepChoice(scope, value, storage = globalThis.localStorage) {
  if (value !== 'business' && !valid(value)) throw Error('Choose how much history to keep.');
  if (value === 'business') storage.removeItem(key(scope));
  else storage.setItem(key(scope), value);
}
/**
 * Remember the business default on this device. Returns true when that changes what this device
 * keeps (it follows the default, and the new default differs), so it downloads its copy again.
 */
export function setBusinessKeep(scope, value, storage = globalThis.localStorage) {
  const next = valid(value) ? value : 'all';
  const before = keepChoice(scope, storage);
  try {
    if (next === 'all') storage.removeItem(businessKey(scope));
    else storage.setItem(businessKey(scope), next);
  } catch {
    return false;
  }
  return keepChoice(scope, storage) !== before;
}
/** The first day kept for a choice (YYYY-MM-DD, Lagos), or null for Everything. */
export function keepCutoff(choice, now = new Date().toISOString()) {
  const today = businessDay(now);
  const m = /^(\d+)([dm])$/.exec(choice ?? '');
  if (!m) return null;
  return m[2] === 'd' ? daysBefore(today, Number(m[1])) : monthsBefore(today, Number(m[1]));
}
const DATED = {
  jobs: (r) => r.createdAt,
  payments: (r) => r.paidOn || r.createdAt,
  checkouts: (r) => r.createdAt,
  saleAdjustments: (r) => r.changedAt,
  expenses: (r) => r.incurredOn,
};
/**
 * A change downloaded for a device keeping recent history that it cannot merge on its own: a record
 * from before its first kept day that it does not have (for example a correction to an old sale).
 * The device then downloads its recent copy again, with fresh carried-forward totals.
 */
export function needsFreshWindow(ledger, changes) {
  const cutoff = ledger?.historySummary?.cutoff;
  if (!cutoff) return false;
  return Object.entries(DATED).some(([collection, dateOf]) => {
    const have = new Set((ledger[collection] ?? []).map((r) => r.id));
    return (changes?.[collection] ?? []).some(
      (r) => !have.has(r.id) && String(dateOf(r) ?? '').slice(0, 10) < cutoff,
    );
  });
}
