import { customerBalanceFast, jobBalanceFast } from './balances.mjs';
// Device history window (stage 1: checking only). A device may later keep only recent records:
// old *closed* records (collected, fully paid jobs and their payments, closed drawer days, paid
// expenses, old stock history…) are dropped and replaced by one carried-forward record per
// customer holding the customer's wallet from those records, the way books are closed with an
// opening balance. Everything the app works out from history then gives the same figures.
//
// Stage 1 changes nothing that anyone sees: `historyCheck` builds the trimmed copy in memory and
// compares the important figures both ways, so we can see on real data that they always agree.
import { businessDay } from './dashboard.mjs';
import { dashboardSummary } from './dashboard.mjs';
import { accountToken, walletBalance } from './checkout.mjs';
import { customerStatement, summaryReport, transactionRegister } from './reports.mjs';
import { drawerSnapshot } from './my-sales.mjs';
import { owingCustomers } from './reminders.mjs';
import { expenseSummary } from './expenses.mjs';

const CLOSED = new Set(['Collected', 'Cancelled']);
const before = (value, cutoff) => !!value && businessDay(value) < cutoff;
/** The day before a YYYY-MM-DD date. */
const dayBefore = (day) => new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);

/**
 * The ledger as a device keeping records from `cutoff` (YYYY-MM-DD) would hold it: closed records
 * before the cutoff are replaced by carried-forward wallet records. Returns { ledger, dropped }.
 * @param {import('./types').Ledger} ledger
 * @param {string} cutoff
 */
export function trimHistory(ledger, cutoff) {
  const paymentsOf = new Map();
  for (const p of ledger.payments)
    for (const a of p.allocations) paymentsOf.set(a.jobId, [...(paymentsOf.get(a.jobId) ?? []), p]);
  const closings = [...(ledger.drawerClosings ?? [])].sort(
    (a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt) || b.id.localeCompare(a.id),
  );
  const closedCheckouts = new Set(closings.flatMap((d) => d.checkoutIds ?? []));
  const closedRefunds = new Set(closings.flatMap((d) => d.refundIds ?? []));
  const adjustmentsOf = new Map();
  for (const a of ledger.saleAdjustments ?? [])
    for (const jobId of new Set([a.jobId, ...(a.affectedJobIds ?? [])]))
      adjustmentsOf.set(jobId, [...(adjustmentsOf.get(jobId) ?? []), a]);

  // Start from everything that could go, then keep whatever is still needed, until nothing changes.
  const jobs = new Set(
    ledger.jobs
      .filter(
        (j) =>
          before(j.createdAt, cutoff) &&
          !(j.modifiedAt && !before(j.modifiedAt, cutoff)) &&
          CLOSED.has(j.productionStatus ?? 'Added') &&
          jobBalanceFast(ledger, j).outstanding === 0,
      )
      .map((j) => j.id),
  );
  const payments = new Set(
    ledger.payments
      .filter((p) => before(p.paidOn || p.createdAt, cutoff) && before(p.createdAt, cutoff))
      .map((p) => p.id),
  );
  const checkouts = new Set(
    (ledger.checkouts ?? [])
      .filter((c) => before(c.createdAt, cutoff) && (c.drawerClosingId || closedCheckouts.has(c.id)))
      .map((c) => c.id),
  );
  const adjustments = new Set(
    (ledger.saleAdjustments ?? [])
      .filter(
        (a) =>
          before(a.changedAt, cutoff) &&
          (!['sale.refunded', 'payment.corrected'].includes(a.action) ||
            a.drawerClosingId ||
            closedRefunds.has(a.id)),
      )
      .map((a) => a.id),
  );
  const checkoutOf = new Map((ledger.checkouts ?? []).map((c) => [c.id, c]));
  for (let changed = true; changed; ) {
    changed = false;
    const keep = (set, id) => {
      if (id && set.delete(id)) changed = true;
    };
    for (const p of ledger.payments) {
      if (!payments.has(p.id)) {
        // A payment that stays keeps its jobs (their balance) and its checkout.
        for (const a of p.allocations) keep(jobs, a.jobId);
        keep(checkouts, p.checkoutId);
        continue;
      }
      if (p.allocations.some((a) => !jobs.has(a.jobId)) || (p.checkoutId && !checkouts.has(p.checkoutId)))
        keep(payments, p.id);
    }
    for (const j of ledger.jobs) {
      if (!jobs.has(j.id)) {
        for (const p of paymentsOf.get(j.id) ?? []) keep(payments, p.id);
        keep(checkouts, j.checkoutId);
        for (const a of adjustmentsOf.get(j.id) ?? []) keep(adjustments, a.id);
        continue;
      }
      if ((paymentsOf.get(j.id) ?? []).some((p) => !payments.has(p.id))) keep(jobs, j.id);
      if (j.checkoutId && checkoutOf.has(j.checkoutId) && !checkouts.has(j.checkoutId)) keep(jobs, j.id);
      if ((adjustmentsOf.get(j.id) ?? []).some((a) => !adjustments.has(a.id))) keep(jobs, j.id);
    }
    for (const c of ledger.checkouts ?? []) {
      if (checkouts.has(c.id)) {
        if ((c.jobs ?? []).some((j) => !jobs.has(j.id))) keep(checkouts, c.id);
        if (ledger.payments.some((p) => (p.checkoutId === c.id || p.id === c.id) && !payments.has(p.id)))
          keep(checkouts, c.id);
      } else for (const j of c.jobs ?? []) keep(jobs, j.id);
    }
    for (const a of ledger.saleAdjustments ?? []) {
      if (!adjustments.has(a.id)) {
        for (const id of [a.jobId, ...(a.affectedJobIds ?? [])]) keep(jobs, id);
        for (const change of a.paymentChanges ?? []) keep(payments, change.after?.id ?? change.before?.id);
      } else if ([a.jobId, ...(a.affectedJobIds ?? [])].some((id) => id && !jobs.has(id)))
        keep(adjustments, a.id);
    }
  }

  // Drawer closings: kept when they cover anything kept, and each person's latest closings.
  const keptClosings = new Set();
  for (const d of closings) {
    if (!before(d.closedAt, cutoff)) keptClosings.add(d.id);
    if ((d.checkoutIds ?? []).some((id) => !checkouts.has(id))) keptClosings.add(d.id);
    if ((d.refundIds ?? []).some((id) => !adjustments.has(id))) keptClosings.add(d.id);
  }
  for (const user of new Set(closings.flatMap((d) => [d.fromUserId, d.toUserId]))) {
    const from = closings.find((d) => d.fromUserId === user);
    const to = closings.find((d) => d.toUserId === user);
    if (from) keptClosings.add(from.id);
    if (to) keptClosings.add(to.id);
  }
  // Expenses: paid (or voided) ones from before the cutoff that nothing has touched since.
  const owed = (e) => e.amount - (e.payments ?? []).reduce((n, p) => n + p.amount, 0);
  const expenses = new Set(
    (ledger.expenses ?? [])
      .filter(
        (e) =>
          before(e.incurredOn, cutoff) &&
          before(e.modifiedAt || e.createdAt, cutoff) &&
          (e.voided || owed(e) <= 0) &&
          (e.payments ?? []).every((p) => before(p.paidOn, cutoff)),
      )
      .map((e) => e.id),
  );

  // Stock history: old entries go, except each material's latest stock count and anything about a
  // job or expense that is kept.
  const lastCount = new Map();
  for (const h of ledger.materialHistory ?? [])
    if (h.action === 'material.stock_set') {
      const seen = lastCount.get(h.materialId);
      if (
        !seen ||
        Date.parse(h.changedAt) > Date.parse(seen.changedAt) ||
        (h.changedAt === seen.changedAt && h.id > seen.id)
      )
        lastCount.set(h.materialId, h);
    }
  const keptCounts = new Set([...lastCount.values()].map((h) => h.id));
  const dropHistory = (h) =>
    before(h.changedAt, cutoff) &&
    !keptCounts.has(h.id) &&
    (!h.jobId || jobs.has(h.jobId)) &&
    (!h.expenseId || expenses.has(h.expenseId));

  // Each customer's latest reminder stays ("last reminded" on Reminders).
  const lastReminder = new Map();
  for (const r of ledger.reminders ?? []) {
    const seen = lastReminder.get(r.customerId);
    if (!seen || r.remindedAt > seen.remindedAt) lastReminder.set(r.customerId, r);
  }
  const keptReminders = new Set([...lastReminder.values()].map((r) => r.id));

  // The wallet from dropped payments, carried forward as one record per customer.
  const carried = new Map();
  for (const p of ledger.payments)
    if (payments.has(p.id)) {
      const net = (p.walletAdded ?? 0) - (p.walletUsed ?? 0);
      carried.set(p.customerId, (carried.get(p.customerId) ?? 0) + net);
    }
  const day = dayBefore(cutoff);
  const carryForward = [...carried]
    .filter(([, net]) => net !== 0)
    .map(([customerId, net]) => ({
      id: `carry-forward:${customerId}`,
      customerId,
      amount: 0,
      method: 'Cash',
      methodLabel: 'Carried forward',
      paidOn: day,
      reference: `Wallet carried forward to ${cutoff}`,
      allocations: [],
      createdAt: `${day}T23:00:00.000Z`,
      walletAdded: net > 0 ? net : 0,
      walletUsed: net < 0 ? -net : 0,
      carryForward: true,
    }));

  // Counts that cover all history (jobs by stage on the Dashboard, jobs per customer) keep the
  // dropped jobs as numbers.
  // Totals per day of the dropped records keep earlier periods' comparisons (Dashboard).
  const stages = {},
    customerJobs = {},
    daily = {};
  const add = (day, key, amount) => {
    daily[day] ??= { sales: 0, collected: 0, refunded: 0 };
    daily[day][key] += amount;
  };
  for (const j of ledger.jobs)
    if (jobs.has(j.id)) {
      const key = j.productionStatus || 'Queued';
      stages[key] = (stages[key] ?? 0) + 1;
      customerJobs[j.customerId] = (customerJobs[j.customerId] ?? 0) + 1;
      add(businessDay(j.createdAt), 'sales', j.amount);
    }
  for (const p of ledger.payments)
    if (payments.has(p.id) && !p.refundId) add(businessDay(p.paidOn), 'collected', p.amount);
  for (const a of ledger.saleAdjustments ?? [])
    if (adjustments.has(a.id) && a.action === 'sale.refunded')
      add(businessDay(a.paidOn || a.changedAt), 'refunded', a.refundAmount);
  const next = {
    ...ledger,
    historySummary: { cutoff, stages, customerJobs, daily },
    jobs: ledger.jobs.filter((j) => !jobs.has(j.id)),
    payments: [...carryForward, ...ledger.payments.filter((p) => !payments.has(p.id))],
    checkouts: (ledger.checkouts ?? []).filter((c) => !checkouts.has(c.id)),
    saleAdjustments: (ledger.saleAdjustments ?? []).filter((a) => !adjustments.has(a.id)),
    drawerClosings: (ledger.drawerClosings ?? []).filter((d) => keptClosings.has(d.id)),
    expenses: (ledger.expenses ?? []).filter((e) => !expenses.has(e.id)),
    expenseHistory: (ledger.expenseHistory ?? []).filter((h) => !expenses.has(h.expenseId)),
    materialHistory: (ledger.materialHistory ?? []).filter((h) => !dropHistory(h)),
    materialWaste: (ledger.materialWaste ?? []).filter(
      (w) => !(before(w.changedAt, cutoff) && (!w.jobId || jobs.has(w.jobId))),
    ),
    quotations: (ledger.quotations ?? []).filter(
      (q) => !(before(q.modifiedAt || q.createdAt, cutoff) && q.validUntil < cutoff),
    ),
    reminders: (ledger.reminders ?? []).filter(
      (r) => keptReminders.has(r.id) || !before(r.remindedAt, cutoff),
    ),
  };
  const count = (key) => (ledger[key] ?? []).length - (next[key] ?? []).length;
  return {
    ledger: next,
    dropped: {
      jobs: jobs.size,
      payments: payments.size,
      checkouts: count('checkouts'),
      saleAdjustments: count('saleAdjustments'),
      drawerClosings: count('drawerClosings'),
      expenses: expenses.size,
      materialHistory: count('materialHistory'),
      materialWaste: count('materialWaste'),
      quotations: count('quotations'),
      reminders: count('reminders'),
    },
    carried: carryForward.length,
  };
}

/** YYYY-MM-DD, `days` days before `day`. */
export const daysBefore = (day, days) =>
  new Date(Date.parse(day + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10);
/** The windows the check tries: short ones while the business is young, up to 3 months. */
export const CHECK_WINDOWS = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: '3 months', months: 3 },
];
/**
 * The history check for every window in CHECK_WINDOWS: [{ label, ...historyCheck }].
 * @param {import('./types').Ledger} ledger
 */
export function historyChecks(ledger, now = new Date().toISOString()) {
  const today = businessDay(now);
  return CHECK_WINDOWS.map((w) => ({
    label: w.label,
    ...historyCheck(ledger, {
      now,
      cutoff: w.days ? daysBefore(today, w.days) : monthsBefore(today, w.months),
    }),
  }));
}
/** YYYY-MM-DD, `months` months before `day`. */
export function monthsBefore(day, months) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Compare the figures the app works out from history, from the full ledger and from a copy that
 * keeps records from `cutoff` only. Returns { cutoff, checked, differences: [{ what, full, trimmed }],
 * dropped }.
 * @param {import('./types').Ledger} ledger
 * @param {{ cutoff?: string, now?: string }} [options]
 */
export function historyCheck(ledger, { now = new Date().toISOString(), cutoff } = {}) {
  const today = businessDay(now);
  const from = cutoff ?? monthsBefore(today, 3);
  const { ledger: trimmed, dropped } = trimHistory(ledger, from);
  const differences = [];
  let checked = 0;
  const same = (what, figure) => {
    checked += 1;
    let full, small;
    try {
      full = JSON.stringify(figure(ledger));
    } catch (cause) {
      full = 'error: ' + (cause instanceof Error ? cause.message : String(cause));
    }
    try {
      small = JSON.stringify(figure(trimmed));
    } catch (cause) {
      small = 'error: ' + (cause instanceof Error ? cause.message : String(cause));
    }
    if (full !== small && differences.length < 50) {
      // Show where they part, so a difference is easy to read.
      let at = 0;
      while (at < full.length && full[at] === small[at]) at++;
      const start = Math.max(0, at - 60);
      differences.push({ what, full: full.slice(start, at + 160), trimmed: small.slice(start, at + 160) });
    }
  };
  for (const c of ledger.customers) {
    same(`Wallet of ${c.name}`, (l) => walletBalance(l, c.id));
    same(`Amount owed by ${c.name}`, (l) => customerBalanceFast(l, c.id));
    // The checkout account check covers every job today; a trimmed device needs it to cover the
    // jobs still owing only (with the server, in stage 2). Compare that version.
    same(`Checkout account check for ${c.name}`, (l) =>
      accountToken(l, c.id)
        .split(';')
        .map((part, i) =>
          i === 0
            ? part
            : part
                .split(',')
                .filter((x) => x && !x.endsWith(':0'))
                .join(','),
        )
        .join(';'),
    );
    same(`Statement of ${c.name} since ${from}`, (l) => {
      const s = customerStatement(l, c.id, from, today, { now });
      return { ...s, customer: undefined };
    });
  }
  same('Customers who owe', (l) => owingCustomers(l, now));
  const periods = [
    [from, today],
    [monthsBefore(today, 1) > from ? monthsBefore(today, 1) : from, today],
    [today, today],
  ];
  for (const [a, b] of periods) {
    same(`Dashboard ${a} to ${b}`, (l) => dashboardSummary(l, a, b));
    same(`Summary report ${a} to ${b}`, (l) => summaryReport(l, a, b, undefined, { today }));
    same(`Transactions ${a} to ${b}`, (l) => transactionRegister(l, a, b));
    same(`Expenses ${a} to ${b}`, (l) => expenseSummary(l, a, b));
  }
  const users = new Set([
    ...(ledger.checkouts ?? []).map((c) => c.createdBy),
    ...(ledger.drawerClosings ?? []).flatMap((d) => [d.fromUserId, d.toUserId]),
  ]);
  for (const user of users) same(`Cash drawer of ${user}`, (l) => drawerSnapshot(l, user));
  same('Stock levels', (l) => l.materials.map((m) => [m.id, m.available]));
  same('Latest stock counts', (l) =>
    l.materials.map((m) => {
      const counts = (l.materialHistory ?? []).filter(
        (h) => h.materialId === m.id && h.action === 'material.stock_set',
      );
      counts.sort((x, y) => Date.parse(y.changedAt) - Date.parse(x.changedAt) || y.id.localeCompare(x.id));
      return [m.id, counts[0]?.id ?? null];
    }),
  );
  return { cutoff: from, checkedAt: now, checked, differences, dropped };
}
