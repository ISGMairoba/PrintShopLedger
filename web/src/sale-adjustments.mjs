import { applyFullCorrection, correctionKinds } from './full-corrections.mjs';
import { normalizeLedger, validateMaterial } from './materials.mjs';
import { materialSnapshot } from './material-display.mjs';
import { accountToken, walletBalance } from './checkout.mjs';
import { applyStockDeltas, choiceUsagePlan, currentChoiceUsages } from './material-choice.mjs';
export const sameEvent = (a, b) =>
  JSON.stringify(a, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  ) ===
  JSON.stringify(b, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const adjustmentLabels = {
  'sale.combined_corrected': 'Job and payments corrected',
  'sale.details_corrected': 'Job details corrected',
  'sale.service_changed': 'Service changed',
  'payment.corrected': 'Payment corrected',
  'sale.corrected': 'Sale corrected',
  'sale.cancelled': 'Sale cancelled',
  'sale.refunded': 'Customer refunded',
};
export function returnableStock(ledger, jobId) {
  return Math.max(
    0,
    Math.round(
      ledger.materialHistory
        .filter(
          (h) =>
            h.jobId === jobId &&
            h.materialId === ledger.jobs.find((j) => j.id === jobId)?.materialId &&
            ['material.job_used', 'material.sale_returned', 'material.job_corrected'].includes(h.action),
        )
        .reduce((n, h) => n + (h.beforeAvailable ?? h.afterAvailable) - h.afterAvailable, 0) * 1000,
    ) / 1000,
  );
}
function audit(event) {
  const d = event.data;
  if (
    !event.id ||
    !d.modifiedBy ||
    !d.modifiedAt ||
    Number.isNaN(Date.parse(d.modifiedAt)) ||
    typeof d.reason !== 'string' ||
    !d.reason.trim() ||
    d.reason.trim().length > 500
  )
    throw Error('An approver, date and reason (up to 500 characters) are required.');
  return {
    changedBy: d.modifiedBy,
    changedByLabel: d.modifiedByLabel || d.modifiedBy,
    changedAt: d.modifiedAt,
    reason: d.reason.trim(),
  };
}
function amount(n, positive = false) {
  if (!Number.isSafeInteger(n) || n < 0 || (positive && n === 0) || n > 100000000000)
    throw Error('Enter a valid amount within the supported limit.');
}
const lagosDay = (iso) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

/**
 * A refund of a customer's unused credit (a deposit with no job, or credit left over): a sale.refunded
 * with no job, filed under the customer. Paid out of their credit; counted in the drawer when cash.
 * `refund`: { amount (kobo), method, methodLabel, reason }.
 */
export function creditRefundEvent(
  ledger,
  customerId,
  refund,
  actor,
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  return /** @type {any} */ ({
    id,
    kind: 'sale.refunded',
    data: {
      customerId,
      expectedAccount: accountToken(ledger, customerId),
      refundAmount: refund.amount,
      method: refund.method,
      methodLabel: refund.methodLabel,
      paidOn: lagosDay(now),
      reason: String(refund.reason ?? '').trim(),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  });
}

function applyCreditRefund(ledger, event) {
  const d = event.data,
    a = audit(event);
  const old = ledger.saleAdjustments.find((r) => r.id === event.id);
  if (old) {
    if (!sameEvent(old.event, event)) throw Error('Adjustment ID already used for different details.');
    return ledger;
  }
  if (!ledger.customers.some((c) => c.id === d.customerId)) throw Error('Customer not found.');
  if (d.expectedAccount !== accountToken(ledger, d.customerId))
    throw Error('The customer account changed. Sync and reopen the refund.');
  amount(d.refundAmount, true);
  if (d.refundAmount > walletBalance(ledger, d.customerId))
    throw Error("The refund is more than the customer's credit.");
  if (
    !['Cash', 'POS', 'Transfer', 'Other'].includes(d.method) ||
    typeof d.methodLabel !== 'string' ||
    !d.methodLabel.trim() ||
    d.methodLabel.length > 80
  )
    throw Error('Choose a refund payment method.');
  if (d.paidOn !== lagosDay(d.modifiedAt))
    throw Error('Refunds must be recorded on the day money is returned.');
  const snap = { description: 'Customer credit', amount: 0 };
  return {
    ...ledger,
    payments: [
      ...ledger.payments,
      {
        id: event.id,
        customerId: d.customerId,
        amount: 0,
        method: d.method,
        methodLabel: d.methodLabel,
        paidOn: d.paidOn,
        reference: 'Refund ' + event.id.slice(0, 8).toUpperCase(),
        allocations: [],
        createdAt: d.modifiedAt,
        walletUsed: d.refundAmount,
        walletAdded: 0,
        refundId: event.id,
      },
    ],
    saleAdjustments: [
      ...ledger.saleAdjustments,
      {
        id: event.id,
        jobId: null,
        customerId: d.customerId,
        action: event.kind,
        ...a,
        before: snap,
        after: snap,
        creditReleased: 0,
        refundAmount: d.refundAmount,
        method: d.method,
        methodLabel: d.methodLabel,
        paidOn: d.paidOn,
        returnQuantity: 0,
        stockChanges: [],
        paymentChanges: [],
        event,
      },
    ],
  };
}

export function applySaleAdjustment(input, event) {
  if (correctionKinds.includes(event.kind)) return applyFullCorrection(input, event);
  if (event.kind === 'sale.refunded' && !event.data?.jobId)
    return applyCreditRefund(normalizeLedger(input), event);
  const ledger = normalizeLedger(input),
    d = event.data,
    a = audit(event);
  const old = ledger.saleAdjustments.find((r) => r.id === event.id);
  if (old) {
    if (!sameEvent(old.event, event)) throw Error('Adjustment ID already used for different details.');
    return ledger;
  }
  const job = ledger.jobs.find((j) => j.id === d.jobId);
  if (!job) throw Error('Job not found.');
  if (d.baseVersion !== (job.version ?? 1) || d.expectedAccount !== accountToken(ledger, job.customerId))
    throw Error('The job or customer account changed. Sync and reopen the adjustment.');
  if (!adjustmentLabels[event.kind]) throw Error('Choose an adjustment type.');
  if (job.productionStatus === 'Cancelled' && event.kind !== 'sale.refunded')
    throw Error('This sale is already cancelled.');
  let after = { ...job },
    payments = ledger.payments.map((p) => ({ ...p, allocations: p.allocations.map((x) => ({ ...x })) })),
    released = 0,
    refund = 0;
  if (event.kind === 'sale.corrected') {
    amount(d.amount);
    if (typeof d.description !== 'string' || !d.description.trim() || d.description.trim().length > 500)
      throw Error('Enter a description up to 500 characters.');
    if (d.amount === job.amount && d.description.trim() === job.description) throw Error('Nothing changed.');
    after.amount = d.amount;
    after.description = d.description.trim();
  } else if (event.kind === 'sale.cancelled') {
    after.amount = 0;
    after.productionStatus = 'Cancelled';
  }
  const paid = payments.reduce(
    (n, p) => n + p.allocations.filter((x) => x.jobId === job.id).reduce((s, x) => s + x.amount, 0),
    0,
  );
  let excess = Math.max(0, paid - after.amount);
  released = excess;
  for (const p of [...payments].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id),
  )) {
    const allocation = p.allocations.find((x) => x.jobId === job.id);
    if (!allocation || !excess) continue;
    const move = Math.min(excess, allocation.amount);
    allocation.amount -= move;
    p.walletAdded = (p.walletAdded ?? 0) + move;
    amount(p.walletAdded);
    excess -= move;
    p.allocations = p.allocations.filter((x) => x.amount > 0);
  }
  if (event.kind === 'sale.refunded') {
    amount(d.refundAmount, true);
    if (d.refundAmount > walletBalance({ ...ledger, payments }, job.customerId))
      throw Error(
        'Refund exceeds available customer credit. Reduce the sale or cancel it first if money is still allocated.',
      );
    if (
      !['Cash', 'POS', 'Transfer', 'Other'].includes(d.method) ||
      typeof d.methodLabel !== 'string' ||
      !d.methodLabel.trim() ||
      d.methodLabel.length > 80
    )
      throw Error('Choose a refund payment method.');
    if (
      d.paidOn !==
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(d.modifiedAt))
    )
      throw Error('Refunds must be recorded on the day money is returned.');
    refund = d.refundAmount;
    payments.push({
      id: event.id,
      customerId: job.customerId,
      amount: 0,
      method: d.method,
      methodLabel: d.methodLabel,
      paidOn: d.paidOn,
      reference: 'Refund ' + event.id.slice(0, 8).toUpperCase(),
      allocations: [],
      createdAt: d.modifiedAt,
      walletUsed: refund,
      walletAdded: 0,
      refundId: event.id,
    });
  }
  after = {
    ...after,
    version: (job.version ?? 1) + 1,
    modifiedBy: a.changedBy,
    modifiedByLabel: a.changedByLabel,
    modifiedAt: a.changedAt,
    lastEventId: event.id,
  };
  let materials = ledger.materials,
    history = ledger.materialHistory;
  const returned = d.returnQuantity ?? 0;
  if (
    typeof returned !== 'number' ||
    !Number.isFinite(returned) ||
    returned < 0 ||
    Math.abs(returned * 1000 - Math.round(returned * 1000)) > 0.001 ||
    returned > returnableStock(ledger, job.id)
  )
    throw Error('Returned stock cannot exceed recorded material usage.');
  if (returned) {
    if (event.kind !== 'sale.cancelled') throw Error('Stock may only be returned when cancelling a sale.');
    const mat = materials.find((m) => m.id === job.materialId);
    if (
      !mat ||
      mat.archived ||
      mat.version !== d.materialVersion ||
      !d.stockEventId ||
      history.some((h) => h.id === d.stockEventId)
    )
      throw Error('Material changed. Sync and reopen the cancellation.');
    const next = {
      ...mat,
      available: Math.round((mat.available + returned) * 1000) / 1000,
      version: mat.version + 1,
      modifiedBy: a.changedBy,
      modifiedByLabel: a.changedByLabel,
      modifiedAt: a.changedAt,
      lastEventId: d.stockEventId,
    };
    validateMaterial(next);
    materials = materials.map((m) => (m.id === mat.id ? next : m));
    history = [
      ...history,
      {
        id: d.stockEventId,
        materialId: mat.id,
        materialName: mat.name,
        measurementUnit: mat.measurementUnit,
        action: 'material.sale_returned',
        jobId: job.id,
        checkoutId: job.checkoutId,
        beforeAvailable: mat.available,
        afterAvailable: next.available,
        reason: a.reason,
        changedBy: a.changedBy,
        changedByLabel: a.changedByLabel,
        changedAt: a.changedAt,
        before: materialSnapshot(mat),
        after: materialSnapshot(next),
        detailsComplete: true,
      },
    ];
  }
  // Cancelling a confirmed choice-of-materials job: what was not really used goes back to stock.
  let stockChanges = [];
  if (Array.isArray(d.choiceUsages) && d.choiceUsages.length) {
    if (event.kind !== 'sale.cancelled') throw Error('Stock may only be returned when cancelling a sale.');
    stockChanges = choiceUsagePlan(ledger, job, d.choiceUsages, true);
    ({ materials, materialHistory: history } = applyStockDeltas(
      { ...ledger, materials, materialHistory: history },
      job,
      stockChanges,
      d.stockIds,
      d.materialVersions,
      a,
      'material.sale_returned',
    ));
    if (stockChanges.length)
      after = {
        ...after,
        materialUsed: {
          ...job.materialUsed,
          usages: currentChoiceUsages({ ...ledger, materialHistory: history }, job),
        },
      };
  }
  const changes = ledger.payments.flatMap((p) => {
    const next = payments.find((x) => x.id === p.id);
    return JSON.stringify(p) === JSON.stringify(next) ? [] : [{ before: p, after: next }];
  });
  const record = {
    id: event.id,
    jobId: job.id,
    customerId: job.customerId,
    action: event.kind,
    ...a,
    before: job,
    after,
    creditReleased: released,
    refundAmount: refund,
    method: d.method,
    methodLabel: d.methodLabel,
    paidOn: d.paidOn,
    returnQuantity: returned,
    stockChanges,
    paymentChanges: changes,
    event,
  };
  return {
    ...ledger,
    jobs: ledger.jobs.map((j) => (j.id === job.id ? after : j)),
    payments,
    materials,
    materialHistory: history,
    saleAdjustments: [...ledger.saleAdjustments, record],
  };
}
export function applyWaste(input, event) {
  const ledger = normalizeLedger(input),
    d = event.data,
    a = audit(event);
  const old = ledger.materialWaste.find((r) => r.id === event.id);
  if (old) {
    if (!sameEvent(old.event, event)) throw Error('Waste ID already used for different details.');
    return ledger;
  }
  const mat = ledger.materials.find((m) => m.id === d.materialId);
  if (!mat || mat.archived) throw Error('Choose an active material.');
  if (mat.version !== d.baseVersion) throw Error('Material changed. Sync and reopen the waste entry.');
  if (!['Waste', 'Damage', 'Reprint'].includes(d.category)) throw Error('Choose waste, damage or reprint.');
  if (
    typeof d.quantity !== 'number' ||
    !Number.isFinite(d.quantity) ||
    d.quantity <= 0 ||
    d.quantity > 1000000000000 ||
    Math.abs(d.quantity * 1000 - Math.round(d.quantity * 1000)) > 0.001
  )
    throw Error('Enter a positive quantity with at most three decimals.');
  if (d.jobId) {
    const job = ledger.jobs.find((j) => j.id === d.jobId);
    if (!job) throw Error('Linked job not found.');
    if (job.materialId !== mat.id) throw Error('Linked job must use the selected material.');
  }
  const next = {
    ...mat,
    available: Math.round((mat.available - d.quantity) * 1000) / 1000,
    version: mat.version + 1,
    modifiedBy: a.changedBy,
    modifiedByLabel: a.changedByLabel,
    modifiedAt: a.changedAt,
    lastEventId: event.id,
  };
  validateMaterial(next);
  const record = {
    id: event.id,
    materialId: mat.id,
    materialName: mat.name,
    measurementUnit: mat.measurementUnit,
    quantity: d.quantity,
    category: d.category,
    jobId: d.jobId || null,
    ...a,
    beforeAvailable: mat.available,
    afterAvailable: next.available,
    event,
  };
  return {
    ...ledger,
    materials: ledger.materials.map((m) => (m.id === mat.id ? next : m)),
    materialWaste: [...ledger.materialWaste, record],
    materialHistory: [
      ...ledger.materialHistory,
      {
        id: event.id,
        materialId: mat.id,
        materialName: mat.name,
        measurementUnit: mat.measurementUnit,
        action: 'material.wasted',
        jobId: d.jobId || null,
        beforeAvailable: mat.available,
        afterAvailable: next.available,
        reason: a.reason,
        changedBy: a.changedBy,
        changedByLabel: a.changedByLabel,
        changedAt: a.changedAt,
        before: materialSnapshot(mat),
        after: materialSnapshot(next),
        detailsComplete: true,
      },
    ],
  };
}

/**
 * The methods a job was paid by (its payments' allocations to it), with what each paid, for a refund
 * split between them. Methods switched off since stay listed.
 * @param {{ payments: { method: string, methodLabel?: string, allocations?: { jobId: string, amount: number }[] }[] }} ledger
 * @param {string} jobId
 * @param {{ label: string, kind: string }[]} methods
 * @returns {{ label: string, kind: string, paid: number }[]}
 */
export function refundMethods(ledger, jobId, methods) {
  /** @type {Map<string, { label: string, kind: string, paid: number }>} */
  const byLabel = new Map();
  for (const p of ledger.payments) {
    const share = (p.allocations ?? []).filter((a) => a.jobId === jobId).reduce((n, a) => n + a.amount, 0);
    if (!(share > 0)) continue;
    const label = p.methodLabel ?? p.method;
    const kind = methods.find((m) => m.label === label)?.kind ?? p.method;
    const row = byLabel.get(label) ?? { label, kind, paid: 0 };
    row.paid += share;
    byLabel.set(label, row);
  }
  return [...byLabel.values()];
}
/**
 * A refund amount spread over the methods, cash first, each up to what it paid.
 * @param {{ label: string, kind: string, paid: number }[]} paidBy
 * @param {number} total
 * @returns {{ label: string, kind: string, paid: number, amount: number }[]}
 */
export function cashFirst(paidBy, total) {
  const order = [...paidBy].sort((a, b) => (a.kind === 'Cash' ? 0 : 1) - (b.kind === 'Cash' ? 0 : 1));
  let left = total;
  const out = order.map((m) => {
    const amount = Math.min(m.paid, left);
    left -= amount;
    return { ...m, amount };
  });
  if (left > 0 && out.length) out[out.length - 1].amount += left;
  return paidBy.map(
    (m) =>
      /** @type {{ label: string, kind: string, paid: number, amount: number }} */ (
        out.find((o) => o.label === m.label)
      ),
  );
}
