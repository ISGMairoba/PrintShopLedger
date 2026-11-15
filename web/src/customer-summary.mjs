import { businessDay } from './dashboard.mjs';

/**
 * Customers page → summary cards: how many customers, how many bought or paid this month and
 * this year, how many are new, who owes the business, and who holds wallet credit.
 * `balance(id)` is what a customer owes (kobo); `wallet(id)` their wallet credit (kobo).
 */
export function customerSummary(ledger, { balance, wallet }, now = new Date()) {
  const today = businessDay(now.toISOString());
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const lastMonth = (() => {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  })();
  const live = ledger.customers.filter((c) => !c.archived);
  // The day of each customer's most recent job or payment (carried-forward records are not activity).
  const lastSeen = new Map();
  const seen = (id, value) => {
    if (!id || !value) return;
    const day = businessDay(value);
    if ((lastSeen.get(id) ?? '') < day) lastSeen.set(id, day);
  };
  for (const job of ledger.jobs ?? []) seen(job.customerId, job.createdAt);
  for (const p of ledger.payments ?? []) if (!p.carryForward) seen(p.customerId, p.paidOn || p.createdAt);
  const activeIn = (prefix) => live.filter((c) => (lastSeen.get(c.id) ?? '').startsWith(prefix)).length;
  // Money is money: archived customers who still owe, or hold credit, count too.
  const owing = ledger.customers.map((c) => balance(c.id)).filter((n) => n > 0);
  const credit = ledger.customers.map((c) => wallet(c.id)).filter((n) => n > 0);
  return {
    total: live.length,
    archived: ledger.customers.length - live.length,
    activeMonth: activeIn(month),
    activeYear: activeIn(year),
    newMonth: live.filter((c) => businessDay(c.createdAt).startsWith(month)).length,
    newLastMonth: live.filter((c) => businessDay(c.createdAt).startsWith(lastMonth)).length,
    owingCount: owing.length,
    owingTotal: owing.reduce((n, x) => n + x, 0),
    walletCount: credit.length,
    walletTotal: credit.reduce((n, x) => n + x, 0),
    /** Customers with no job or payment in the last 90 days (but some before). */
    quiet: live.filter((c) => {
      const day = lastSeen.get(c.id);
      return day && Date.parse(today) - Date.parse(day) > 90 * 86400000;
    }).length,
  };
}
