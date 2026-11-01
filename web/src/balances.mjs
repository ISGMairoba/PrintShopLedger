// Fast balances for screens, reports and reminders. Working out one job's balance used to read
// every payment, so a list of jobs read every payment once per job (and again for each comparison
// when sorting). These tallies read the payments once and are reused until the payments change.
//
// Only for code that reads the records. Code that changes payments while it works (sales, refunds,
// corrections) keeps the exact jobBalance and customerBalance in domain.mjs.
import { balanceOf } from './domain.mjs';

const paidCache = new WeakMap();
const lastCache = new WeakMap();
const customerCache = new WeakMap();

/** Paid so far per job id. */
export function paidByJob(payments = []) {
  let map = paidCache.get(payments);
  if (!map) {
    map = new Map();
    for (const payment of payments)
      for (const allocation of payment.allocations ?? [])
        map.set(allocation.jobId, (map.get(allocation.jobId) ?? 0) + allocation.amount);
    paidCache.set(payments, map);
  }
  return map;
}

/** Same result as jobBalance(ledger, job), without reading every payment each time. */
export const jobBalanceFast = (ledger, job) => balanceOf(job, paidByJob(ledger.payments).get(job.id) ?? 0);

/** Same result as customerBalance(ledger, customerId): what the customer owes across their jobs. */
export function customerBalanceFast(ledger, customerId) {
  let byPayments = customerCache.get(ledger.jobs);
  if (!byPayments) customerCache.set(ledger.jobs, (byPayments = new WeakMap()));
  let owed = byPayments.get(ledger.payments);
  if (!owed) {
    owed = new Map();
    const paid = paidByJob(ledger.payments);
    for (const job of ledger.jobs)
      owed.set(job.customerId, (owed.get(job.customerId) ?? 0) + job.amount - (paid.get(job.id) ?? 0));
    byPayments.set(ledger.payments, owed);
  }
  return owed.get(customerId) ?? 0;
}

/** Same result as lastJobPayment(ledger, job): the latest day money was put on the job. */
export function lastPaymentFast(ledger, job) {
  let map = lastCache.get(ledger.payments);
  if (!map) {
    map = new Map();
    const best = new Map();
    for (const p of ledger.payments)
      for (const a of p.allocations ?? []) {
        if (!(a.amount > 0)) continue;
        const prev = best.get(a.jobId);
        if (
          !prev ||
          p.paidOn.localeCompare(prev.paidOn) > 0 ||
          (p.paidOn === prev.paidOn && Date.parse(p.createdAt) > Date.parse(prev.createdAt))
        )
          best.set(a.jobId, p);
      }
    for (const [id, p] of best) map.set(id, p.paidOn);
    lastCache.set(ledger.payments, map);
  }
  return map.get(job.id) ?? null;
}
