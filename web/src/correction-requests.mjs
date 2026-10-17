// Correction requests: a cashier asks for a correction on one of their own sales; an Admin,
// Manager or Developer approves (the correction is applied as usual, recorded as requested by the
// cashier and approved by them) or rejects it with a note. Requests live on the server only
// (submit/list/approve/reject_correction_request); this file holds the shared rules.
import { accountToken, walletBalance } from './checkout.mjs';
import { customerBalance } from './domain.mjs';
import { paymentCorrectionToken } from './full-corrections.mjs';
import { currency } from './receipts.mjs';

export const requestKinds = [
  'sale.corrected',
  'sale.details_corrected',
  'sale.combined_corrected',
  'sale.cancelled',
  'sale.refunded',
  'payment.corrected',
];
export const requestStatusLabels = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/**
 * The jobs sold by this user (the jobs on their own checkouts).
 * @param {import('./types').Ledger} ledger
 * @param {string} userId
 * @returns {import('./types').Job[]}
 */
export function ownSaleJobs(ledger, userId) {
  const mine = new Set((ledger.checkouts ?? []).filter((c) => c.createdBy === userId).map((c) => c.id));
  return ledger.jobs.filter((j) => j.checkoutId && mine.has(j.checkoutId));
}

/** Sale adjustments on this user's own sales (their correction history). */
export function ownSaleAdjustments(ledger, userId) {
  const jobs = new Set(ownSaleJobs(ledger, userId).map((j) => j.id));
  return (ledger.saleAdjustments ?? []).filter(
    (r) => jobs.has(r.jobId) || r.event?.data?.requestedBy === userId,
  );
}

/**
 * The event to approve a request with: the cashier's correction unchanged, its version checks
 * brought up to the latest records, saved by the approver. (The server checks it matches.)
 * @param {import('./types').Ledger} ledger
 * @param {import('./types').CorrectionRequest} request
 * @param {{ id: string, label: string }} approver
 * @returns {import('./types').SupervisedEvent}
 */
export function approvalEvent(ledger, request, approver, now = new Date().toISOString()) {
  const d = structuredClone(request.event.data);
  const job = ledger.jobs.find((j) => j.id === d.jobId);
  if (!job) throw Error('The job for this request is no longer here. Sync and try again.');
  const paymentToken = (id) => {
    const payment = ledger.payments.find((p) => p.id === id);
    if (!payment) throw Error('A payment in this request is no longer here.');
    return paymentCorrectionToken(payment);
  };
  d.baseVersion = job.version ?? 1;
  d.expectedAccount = accountToken(ledger, job.customerId);
  if (d.paymentId && d.expectedPayment !== undefined) d.expectedPayment = paymentToken(d.paymentId);
  if (Array.isArray(d.paymentEdits))
    d.paymentEdits = d.paymentEdits.map((e) => ({ ...e, expectedPayment: paymentToken(e.paymentId) }));
  if (d.materialVersions)
    d.materialVersions = Object.fromEntries(
      Object.keys(d.materialVersions).map((id) => [
        id,
        ledger.materials.find((m) => m.id === id)?.version ?? d.materialVersions[id],
      ]),
    );
  if (d.serviceVersion !== undefined && d.serviceId)
    d.serviceVersion = ledger.services.find((s) => s.id === d.serviceId)?.version ?? d.serviceVersion;
  if (d.materialVersion !== undefined && job.materialId)
    d.materialVersion = ledger.materials.find((m) => m.id === job.materialId)?.version ?? d.materialVersion;
  Object.assign(d, {
    requestId: request.id,
    requestedBy: request.requestedBy,
    requestedByLabel: request.requestedByLabel,
    modifiedBy: approver.id,
    modifiedByLabel: approver.label,
    modifiedAt: now,
  });
  return { id: request.id, kind: request.kind, data: d };
}

/**
 * What a correction changes, as [label, before, after] rows (changed rows only): the job, the
 * customer's payments, stock, and the customer's balance.
 */
export function correctionChanges(ledger, next, jobId) {
  const rows = [];
  const add = (label, before, after) => {
    const a = before === undefined || before === null || before === '' ? '—' : String(before),
      b = after === undefined || after === null || after === '' ? '—' : String(after);
    if (a !== b) rows.push([label, a, b]);
  };
  const job = ledger.jobs.find((j) => j.id === jobId),
    after = next.jobs.find((j) => j.id === jobId);
  if (!job || !after) return rows;
  const material = (id) => (id ? (ledger.materials.find((m) => m.id === id)?.name ?? id) : 'No material');
  add('Description', job.description, after.description);
  add('Service', job.service, after.service);
  add('Material', material(job.materialId), material(after.materialId));
  add('Quantity', job.quantity, after.quantity);
  add('Width', job.width, after.width);
  add('Height', job.height, after.height);
  add('Charge', currency(job.amount), currency(after.amount));
  add('Stage', job.productionStatus ?? 'Added', after.productionStatus ?? 'Added');
  for (const payment of ledger.payments.filter((p) => p.customerId === job.customerId)) {
    const revised = next.payments.find((p) => p.id === payment.id);
    if (!revised) continue;
    const name = `Payment ${payment.id.slice(0, 8).toUpperCase()}`;
    add(`${name} · amount`, currency(payment.amount), currency(revised.amount));
    add(`${name} · method`, payment.methodLabel ?? payment.method, revised.methodLabel ?? revised.method);
    add(`${name} · date`, payment.paidOn, revised.paidOn);
    add(`${name} · reference`, payment.reference, revised.reference);
  }
  for (const before of ledger.materials) {
    const m = next.materials.find((x) => x.id === before.id);
    if (m && m.available !== before.available)
      add(
        `Stock · ${before.name}`,
        `${before.available} ${before.measurementUnit}`,
        `${m.available} ${m.measurementUnit}`,
      );
  }
  add(
    'Customer credit',
    currency(walletBalance(ledger, job.customerId)),
    currency(walletBalance(next, job.customerId)),
  );
  add(
    'Customer owes',
    currency(customerBalance(ledger, job.customerId)),
    currency(customerBalance(next, job.customerId)),
  );
  const refund = next.saleAdjustments.find(
    (r) => !ledger.saleAdjustments.some((x) => x.id === r.id),
  )?.refundAmount;
  if (refund) add('Money returned', currency(0), currency(refund));
  return rows;
}
