// Expenses that cover a period (rent for a year, salaries for a month, subscriptions): profit & loss
// spreads the cost evenly by day over the days it covers, instead of counting it all on the day it was
// incurred. Cash is not spread: accounts, drawers and payments still show the money on the day it moved.
// An expense records `covers: { from, to }` (Lagos days, both included); none means its own day.
// Business Settings → Dropdowns gives each expense category its usual period (months; 0 = the day it
// was incurred), which new expenses in that category start with.

/** @type {[number, string][]} */
export const PERIOD_CHOICES = [
  [0, 'Just the day it was incurred'],
  [1, '1 month'],
  [3, '3 months'],
  [6, '6 months'],
  [12, '1 year'],
];
export const PERIOD_MONTHS = PERIOD_CHOICES.map(([n]) => n);

/** Starter usual periods for common categories (months). */
export const STARTER_PERIODS = {
  Rent: 12,
  Wages: 1,
  Salaries: 1,
  Subscriptions: 1,
  Electricity: 1,
  'Internet / phone': 1,
  Internet: 1,
};

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const toTime = (day) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time) => new Date(time).toISOString().slice(0, 10);
/** Days from `from` to `to`, both included. */
export const daysBetween = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY) + 1;

/** The last day of `months` months starting on `from` (e.g. 1 Jan + 12 months → 31 Dec). */
export function periodEnd(from, months) {
  const [y, m, d] = from.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d));
  // A start on the 31st that lands in a shorter month ends on that month's last day.
  if (end.getUTCDate() !== d) end.setUTCDate(0);
  return toDay(end.getTime() - DAY);
}

/** A period as entered: null (its own day) or from–to, up to 3 years, within 3 years of the expense. */
export function validCovers(covers, incurredOn) {
  if (covers === undefined || covers === null) return null;
  if (typeof covers !== 'object' || !dayPattern.test(covers.from ?? '') || !dayPattern.test(covers.to ?? ''))
    throw Error('Choose the dates this expense covers.');
  if (Number.isNaN(toTime(covers.from)) || Number.isNaN(toTime(covers.to)) || covers.to < covers.from)
    throw Error('The period this expense covers must end on or after its start.');
  if (daysBetween(covers.from, covers.to) > 1098) throw Error('An expense can cover up to 3 years.');
  if (incurredOn && Math.abs(toTime(covers.from) - toTime(incurredOn)) > 1098 * DAY)
    throw Error('The period it covers must start within 3 years of the expense date.');
  if (covers.from === covers.to && covers.from === incurredOn) return null;
  return { from: covers.from, to: covers.to };
}

/** The period from a choice of months, starting on the expense date (null for 0). */
export const coversFor = (incurredOn, months) =>
  months > 0 ? { from: incurredOn, to: periodEnd(incurredOn, months) } : null;

/** Usual periods per category (months), checked; categories not listed are 0. */
export function validCategoryPeriods(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [category, months] of Object.entries(input))
    if (typeof category === 'string' && category.length <= 80 && PERIOD_MONTHS.includes(months) && months > 0)
      out[category] = months;
  return out;
}

/** How much of an expense counts in a report period (Lagos days, both included), by day. */
export function expenseShare(expense, from, to) {
  const c = expense.covers;
  if (!c) return expense.incurredOn >= from && expense.incurredOn <= to ? expense.amount : 0;
  const start = c.from > from ? c.from : from;
  const end = c.to < to ? c.to : to;
  if (end < start) return 0;
  const total = daysBetween(c.from, c.to);
  // Whole kobo per period: the days before this period and up to its end, so the parts add up exactly.
  const upTo = (day) => (day < c.from ? 0 : Math.round((expense.amount * daysBetween(c.from, day)) / total));
  return upTo(end) - upTo(toDay(toTime(start) - DAY));
}

/**
 * Paid in advance at the end of `to`: money actually paid by then (removed payments left out) for
 * expenses whose period goes on after it, less the part already counted (e.g. the rest of the
 * year's rent paid in January). An expense not paid yet is not paid in advance.
 */
export function paidInAdvance(expenses, to) {
  let kobo = 0;
  for (const e of expenses) {
    if (e.voided || !e.covers || e.incurredOn > to || e.covers.to <= to) continue;
    const paid = Math.min(
      e.amount,
      (e.payments ?? []).filter((p) => !p.removedAt && p.paidOn <= to).reduce((sum, p) => sum + p.amount, 0),
    );
    kobo += Math.max(0, paid - expenseShare(e, e.covers.from, to));
  }
  return kobo;
}
