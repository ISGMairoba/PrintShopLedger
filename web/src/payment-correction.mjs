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
 * latest job (a payment that only added credit). Undefined when the customer has no jobs.
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
  if (!job) throw Error('This customer has no jobs, so this payment cannot be corrected here.');
  return /** @type {any} */ ({
    id,
    kind: 'payment.corrected',
    data: {
      jobId: job.id,
      baseVersion: job.version ?? 1,
      expectedAccount: accountToken(ledger, job.customerId),
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
