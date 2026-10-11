import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyEvent, jobBalance, customerBalance } from '../src/domain.mjs';
import { prepareCheckout, accountToken, walletBalance, applyJobStatus } from '../src/checkout.mjs';
import { returnableStock } from '../src/sale-adjustments.mjs';
import { receiptHtml } from '../src/receipts.mjs';
import { drawerSnapshot } from '../src/my-sales.mjs';
const actor = { id: '10000000-0000-4000-8000-000000000001', label: 'Manager' };
const customerId = '20000000-0000-4000-8000-000000000001',
  materialId = '30000000-0000-4000-8000-000000000001',
  serviceId = '40000000-0000-4000-8000-000000000001';
function fixture() {
  let ledger = {
    ...emptyLedger(),
    customers: [
      {
        id: customerId,
        name: 'Customer',
        phone: '0801',
        address: 'Road',
        creditLimit: 0,
        archived: false,
        version: 1,
      },
    ],
    materials: [
      {
        id: materialId,
        name: 'Paper',
        available: 10,
        measurementUnit: 'sheet',
        requireSize: false,
        archived: false,
        version: 1,
      },
    ],
    services: [
      { id: serviceId, description: 'Printing', materialId, price: 10000, version: 1, archived: false },
    ],
  };
  const event = prepareCheckout(
    ledger,
    {
      customerId,
      lines: [
        {
          id: crypto.randomUUID(),
          serviceId,
          description: 'Print job',
          quantity: 2,
          source: 'In shop / USB',
        },
      ],
      cashReceived: 20000,
      useWallet: false,
      method: 'Cash',
      paidOn: '2026-10-08',
      reference: '',
    },
    actor,
  );
  return applyEvent(ledger, event);
}
function command(ledger, kind, extra = {}) {
  const job = ledger.jobs[0],
    now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind,
    data: {
      jobId: job.id,
      baseVersion: job.version ?? 1,
      expectedAccount: accountToken(ledger, customerId),
      reason: 'Customer requested change',
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
      ...extra,
    },
  };
}
function refund(ledger, n, method = 'Cash') {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return command(ledger, 'sale.refunded', { refundAmount: n, method, methodLabel: method, paidOn: day });
}
const waste = (ledger, extra = {}) => ({
  id: crypto.randomUUID(),
  kind: 'material.wasted',
  data: {
    materialId,
    baseVersion: ledger.materials[0].version,
    quantity: 1,
    category: 'Reprint',
    jobId: ledger.jobs[0].id,
    reason: 'Print spoiled',
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: new Date().toISOString(),
    ...extra,
  },
});
test('Paid sale correction releases only excess credit and preserves original receipt and cash', () => {
  const base = fixture(),
    original = structuredClone(base),
    event = command(base, 'sale.corrected', { amount: 15000, description: 'Revised charge' }),
    next = applyEvent(base, event);
  assert.equal(next.jobs[0].amount, 15000);
  assert.equal(jobBalance(next, next.jobs[0]).paid, 15000);
  assert.equal(walletBalance(next, customerId), 5000);
  assert.equal(next.payments[0].amount, 20000);
  assert.deepEqual(next.checkouts, base.checkouts);
  assert.deepEqual(base, original);
  assert.equal(next.materials[0].available, 8);
  assert.equal(next.saleAdjustments[0].paymentChanges[0].before.allocations[0].amount, 20000);
  assert.deepEqual(applyEvent(next, event), next);
  assert.throws(
    () => applyEvent(next, { ...event, data: { ...event.data, reason: 'Other reason' } }),
    /ID already used/,
  );
});
test('Charge increase creates debt without changing material consumption or receipt', () => {
  const base = fixture(),
    next = applyEvent(
      base,
      command(base, 'sale.corrected', { amount: 30000, description: 'Larger agreed charge' }),
    );
  assert.equal(customerBalance(next, customerId), 10000);
  assert.equal(walletBalance(next, customerId), 0);
  assert.equal(next.materials[0].available, 8);
});
test('Cancellation does not automatically return used stock and blocks further production', () => {
  const base = fixture(),
    next = applyEvent(base, command(base, 'sale.cancelled'));
  assert.equal(next.materials[0].available, 8);
  assert.equal(jobBalance(next, next.jobs[0]).status, 'Cancelled');
  assert.equal(walletBalance(next, customerId), 20000);
  assert.equal(customerBalance(next, customerId), 0);
  assert.throws(() =>
    applyJobStatus(next, {
      id: crypto.randomUUID(),
      kind: 'job.status_changed',
      data: {
        id: next.jobs[0].id,
        baseVersion: 2,
        status: 'In Queue',
        modifiedBy: actor.id,
        modifiedByLabel: actor.label,
        modifiedAt: new Date().toISOString(),
      },
    }),
  );
  assert.throws(() => applyEvent(next, command(next, 'sale.cancelled')), /already cancelled/);
});
test('Explicit usable stock return is limited to actual recorded usage', () => {
  const base = fixture();
  assert.equal(returnableStock(base, base.jobs[0].id), 2);
  const e = command(base, 'sale.cancelled', {
      returnQuantity: 1.5,
      materialVersion: base.materials[0].version,
      stockEventId: crypto.randomUUID(),
    }),
    next = applyEvent(base, e);
  assert.equal(next.materials[0].available, 9.5);
  assert.equal(returnableStock(next, next.jobs[0].id), 0.5);
  assert.equal(next.materialHistory.at(-1).action, 'material.sale_returned');
  assert.deepEqual(applyEvent(next, e), next);
  assert.throws(() => applyEvent(base, command(base, 'sale.cancelled', { returnQuantity: 3 })), /exceed/);
  assert.throws(
    () =>
      applyEvent(
        base,
        command(base, 'sale.cancelled', {
          returnQuantity: 1,
          materialVersion: 0,
          stockEventId: crypto.randomUUID(),
        }),
      ),
    /changed/,
  );
});
test('Refund consumes released wallet credit exactly once and reduces approving user drawer cash', () => {
  const base = fixture(),
    cancelled = applyEvent(base, command(base, 'sale.cancelled')),
    e = refund(cancelled, 12000),
    next = applyEvent(cancelled, e);
  assert.equal(walletBalance(next, customerId), 8000);
  assert.equal(next.payments[0].amount, 20000);
  assert.equal(next.payments.at(-1).refundId, e.id);
  assert.equal(drawerSnapshot(next, actor.id).expectedCash, 8000);
  assert.equal(drawerSnapshot(next, actor.id).totalRefunded, 12000);
  assert.deepEqual(applyEvent(next, e), next);
  assert.throws(() => applyEvent(next, refund(next, 9000)), /exceeds/);
  assert.throws(() => applyEvent(base, refund(base, 1000)), /exceeds/);
});
test('POS refund and supervisor refund on another cashier sale do not debit cashier cash', () => {
  let base = fixture();
  base.checkouts[0].createdBy = 'cashier';
  base = applyEvent(base, command(base, 'sale.cancelled'));
  const next = applyEvent(base, refund(base, 5000, 'POS'));
  assert.equal(drawerSnapshot(next, 'cashier').expectedCash, 20000);
  assert.equal(drawerSnapshot(next, actor.id).expectedCash, 0);
  assert.equal(drawerSnapshot(next, actor.id).totalRefunded, 5000);
});
test('Closed refunds are not deducted again from a later drawer', () => {
  let base = fixture();
  base = applyEvent(base, command(base, 'sale.cancelled'));
  const e = refund(base, 5000);
  base = applyEvent(base, e);
  base.drawerClosings = [
    {
      id: 'closing',
      fromUserId: actor.id,
      toUserId: 'other',
      closedAt: new Date().toISOString(),
      checkoutIds: base.checkouts.map((r) => r.id),
      refundIds: [e.id],
      countedCash: 15000,
    },
  ];
  assert.equal(drawerSnapshot(base, actor.id).expectedCash, 0);
  assert.equal(drawerSnapshot(base, actor.id).refunds.length, 0);
});
test('Stale account or job and unsupported refunds leave input intact', () => {
  const base = fixture(),
    e = command(base, 'sale.cancelled'),
    changed = { ...base, jobs: base.jobs.map((j) => ({ ...j, version: 2 })) };
  assert.throws(() => applyEvent(changed, e), /changed/);
  const bad = command(base, 'sale.corrected', { amount: 1.5, description: 'Change' });
  assert.throws(() => applyEvent(base, bad), /valid amount/);
  assert.throws(() => applyEvent(base, command(base, 'sale.cancelled', { reason: '' })), /reason/);
});
test('Waste and reprints debit only additional material, preserve jobs and money, retry safely', () => {
  const base = fixture(),
    e = waste(base, { quantity: 9 }),
    next = applyEvent(base, e);
  assert.equal(next.materials[0].available, -1);
  assert.deepEqual(next.jobs, base.jobs);
  assert.deepEqual(next.payments, base.payments);
  assert.equal(next.materialWaste[0].beforeAvailable, 8);
  assert.equal(next.materialWaste[0].afterAvailable, -1);
  assert.equal(next.materialHistory.at(-1).action, 'material.wasted');
  assert.deepEqual(applyEvent(next, e), next);
  assert.throws(() => applyEvent(next, waste(base)), /changed/);
  assert.throws(() => applyEvent(base, waste(base, { quantity: -1 })), /positive/);
  assert.throws(() => applyEvent(base, waste(base, { quantity: 0.0001 })), /three decimals/);
  assert.throws(() => applyEvent(base, waste(base, { jobId: 'missing' })), /not found/);
});

test('Original receipt amounts remain immutable while later adjustments print with escaped reasons', () => {
  let ledger = fixture();
  ledger = applyEvent(ledger, command(ledger, 'sale.cancelled', { reason: '<script>unsafe</script>' }));
  const html = receiptHtml(ledger.checkouts[0], 'Business', false, ledger.saleAdjustments);
  assert.match(html, /Original receipt/);
  assert.match(html, /Later adjustments/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(ledger.checkouts[0].total, 20000);
});

test('Waste rejects a different job material and materialless jobs, but allows unlinked waste', () => {
  const base = fixture(),
    original = structuredClone(base);
  for (const materialId of ['other-material', null, undefined]) {
    const wrong = { ...base, jobs: base.jobs.map((j) => ({ ...j, materialId })) };
    assert.throws(() => applyEvent(wrong, waste(wrong)), /must use the selected material/);
  }
  assert.deepEqual(base, original);
  const unlinked = applyEvent(base, waste(base, { jobId: undefined }));
  assert.equal(unlinked.materialWaste[0].jobId, null);
  assert.equal(unlinked.materials[0].available, 7);
});
