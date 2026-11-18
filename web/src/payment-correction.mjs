// Correct a payment from the payment itself (Payments page or receipt): its amount, method, date
// and reference. ₦0 removes a duplicate payment; the jobs it paid show as owed again.
// It is saved as a `payment.corrected` sale adjustment, so the drawer, reports and history treat it
// like a correction made from a job. The server (apply_supervised_event_v2) applies the same rules.
import { accountToken } from './checkout.mjs';
import { paymentCorrectionToken } from './full-corrections.mjs';
import { applySaleAdjustment } from './sale-adjustments.mjs';

/** Whether a payment can be corrected here (refunds are corrected by their own sale adjustment). */
export const correctablePayment = (payment) => !!payment && !payment.refundId;

/**
 * The job the correction is filed under: the oldest job this payment paid, or else the customer's
 * latest job (a payment that only added credit). Undefined when the customer has no jobs: the
 * correction is then filed under the customer (a deposit with no job).
 * @param {import('./types').Ledger} ledger
 * @param {import('./types').Payment} payment
 */
export function anchorJob(ledger, payment) {
  const byDate = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
  const paid = ledger.jobs
    .filter((j) => payment.allocations.some((a) => a.jobId === j.id && a.amount > 0))
    .sort(byDate);
  if (paid.length) return paid[0];
  return ledger.jobs
    .filter((j) => j.customerId === payment.customerId)
    .sort(byDate)
    .at(-1);
}

/** The payments a receipt shows (a checkout receipt or a payment receipt). */
export const receiptPayments = (ledger, receiptId) =>
  ledger.payments.filter((p) => (p.id === receiptId || p.checkoutId === receiptId) && correctablePayment(p));

/**
 * The correction event. `change`: { amount (kobo), method, methodLabel, paidOn, reference, reason }.
 * @returns {import('./types').SupervisedEvent}
 */
export function paymentCorrectionEvent(
  ledger,
  payment,
  change,
  actor,
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  if (!correctablePayment(payment)) throw Error('Refunds are corrected from Sale Adjustments.');
  const job = anchorJob(ledger, payment);
  return /** @type {any} */ ({
    id,
    kind: 'payment.corrected',
    data: {
      // A deposit from a customer with no jobs yet is corrected on the customer's account.
      ...(job
        ? { jobId: job.id, baseVersion: job.version ?? 1 }
        : { customerId: payment.customerId }),
      expectedAccount: accountToken(ledger, payment.customerId),
      paymentId: payment.id,
      expectedPayment: paymentCorrectionToken(payment),
      paymentAmount: change.amount,
      method: change.method,
      methodLabel: change.methodLabel,
      paidOn: change.paidOn,
      reference: change.reference.trim(),
      reason: change.reason.trim(),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  });
}

/** The ledger after the correction, for the before/after preview (throws what saving would). */
export const previewPaymentCorrection = (ledger, event) => applySaleAdjustment(ledger, event);

/**
 * Correct a split sale as one: each part's new amount and method, with the date, reference and reason
 * shared. Returns the corrections for the parts that change, in order, each made against the ledger as
 * the ones before it leave it (so the server takes them one after another), and the ledger after all.
 * `changes`: [{ paymentId, amount (kobo), method, methodLabel }]; `shared`: { paidOn, reference, reason }.
 * @returns {{ events: import('./types').SupervisedEvent[], after: import('./types').Ledger }}
 */
export function splitCorrectionEvents(ledger, changes, shared, actor, now = new Date().toISOString()) {
  let working = ledger;
  const events = [];
  for (const change of changes) {
    const payment = working.payments.find((p) => p.id === change.paymentId);
    if (!correctablePayment(payment)) throw Error('A part of this sale cannot be corrected here.');
    const same =
      payment.amount === change.amount &&
      (payment.methodLabel || payment.method) === change.methodLabel &&
      payment.paidOn === shared.paidOn &&
      (payment.reference ?? '') === shared.reference.trim();
    if (same) continue;
    const event = paymentCorrectionEvent(
      working,
      payment,
      { ...change, paidOn: shared.paidOn, reference: shared.reference, reason: shared.reason },
      actor,
      crypto.randomUUID(),
      now,
    );
    working = applySaleAdjustment(working, event);
    events.push(event);
  }
  if (!events.length) throw Error('Nothing changed.');
  return { events, after: working };
}
