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
/** @returns {string} */
export function keepChoice(scope, storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(key(scope)) ?? 'all';
    return KEEP_CHOICES.some(([v]) => v === value) ? value : 'all';
  } catch {
    return 'all';
  }
}
export function setKeepChoice(scope, value, storage = globalThis.localStorage) {
  if (!KEEP_CHOICES.some(([v]) => v === value)) throw Error('Choose how much history to keep.');
  if (value === 'all') storage.removeItem(key(scope));
  else storage.setItem(key(scope), value);
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
