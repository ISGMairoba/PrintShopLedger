import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger, jobBalance } from '../src/domain.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
import { anchorJob, paymentCorrectionEvent, receiptPayments } from '../src/payment-correction.mjs';

const actor = { id: 'u', label: 'Ada' };
const at = '2026-10-17T09:00:00Z';
const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: at };
const id = () => crypto.randomUUID();

function shop() {
  let ledger = emptyLedger();
  const apply = (kind, data) => {
    ledger = applyEvent(ledger, { id: id(), kind, data: { ...data, ...audit } });
    return data.id;
  };
  const service = apply('service.created', {
    id: id(),
    description: 'Design',
    materialId: null,
    price: 500000,
  });
  const customer = apply('customer.created', {
    id: id(),
    name: 'Bello',
    phone: '0801',
    address: '',
    creditLimit: 0,
  });
  const jobId = id();
  const event = prepareCheckout(
    ledger,
    {
      customerId: customer,
      lines: [
        {
          id: jobId,
          serviceId: service,
          description: 'Logo',
          quantity: '1',
          source: 'In shop / USB',
          sourceNote: '',
        },
      ],
      cashReceived: 500000,
      useWallet: false,
      paidOn: '2026-10-17',
      method: 'Cash',
      reference: '',
    },
    actor,
    id(),
    at,
  );
  ledger = applyEvent(ledger, event);
  return { ledger, customer, jobId, checkoutId: event.data.id };
}
const change = (p, patch) => ({
  amount: p.amount,
  method: p.method,
  methodLabel: p.methodLabel ?? p.method,
  paidOn: p.paidOn,
  reference: p.reference,
  reason: 'Fix',
  ...patch,
});

test('₦0 removes a duplicate payment: the job shows as owed again and the record is kept', () => {
  const s = shop();
  let ledger = s.ledger;
  const job = ledger.jobs.find((j) => j.id === s.jobId);
  assert.equal(jobBalance(ledger, job).outstanding, 0);
  // Recorded twice in error: correct this copy down to ₦0.
  const payment = ledger.payments.find((p) => p.checkoutId === s.checkoutId || p.id === s.checkoutId);
  assert.ok(payment);
  assert.equal(anchorJob(ledger, payment).id, s.jobId);
  assert.deepEqual(
    receiptPayments(ledger, s.checkoutId).map((p) => p.id),
    [payment.id],
  );
  const event = paymentCorrectionEvent(
    ledger,
    payment,
    change(payment, { amount: 0, reason: 'Duplicate' }),
    actor,
  );
  ledger = applyEvent(ledger, event);
  const after = ledger.payments.find((p) => p.id === payment.id);
  assert.equal(after.amount, 0);
  assert.equal(after.allocations.length, 0);
  assert.equal(
    jobBalance(
      ledger,
      ledger.jobs.find((j) => j.id === s.jobId),
    ).outstanding,
    500000,
  );
  const record = ledger.saleAdjustments.find((r) => r.id === event.id);
  assert.equal(record.action, 'payment.corrected');
  assert.equal(record.methodDeltas.Cash, -500000);
  assert.equal(record.paymentChanges[0].before.amount, 500000);
});

test('method, date and reference can be changed; the date alone counts as a change', () => {
  const s = shop();
  let ledger = s.ledger;
  const payment = ledger.payments[0];
  ledger = applyEvent(
    ledger,
    paymentCorrectionEvent(ledger, payment, change(payment, { paidOn: '2026-10-16' }), actor),
  );
  let after = ledger.payments[0];
  assert.equal(after.paidOn, '2026-10-16');
  assert.equal(after.amount, 500000);
  ledger = applyEvent(
    ledger,
    paymentCorrectionEvent(
      ledger,
      after,
      change(after, { method: 'POS', methodLabel: 'POS', reference: 'Moniepoint 12' }),
      actor,
    ),
  );
  after = ledger.payments[0];
  assert.equal(after.method, 'POS');
  assert.equal(after.reference, 'Moniepoint 12');
  assert.throws(
    () => applyEvent(ledger, paymentCorrectionEvent(ledger, after, change(after, {}), actor)),
    /Nothing changed/,
  );
  assert.throws(
    () =>
      applyEvent(
        ledger,
        paymentCorrectionEvent(ledger, after, change(after, { paidOn: '2026-02-30' }), actor),
      ),
    /valid payment date/,
  );
});

test('a wrong amount: more goes to what is owed, then to credit; less is taken back from credit first', () => {
  const s = shop();
  let ledger = s.ledger;
  const payment = ledger.payments[0];
  ledger = applyEvent(
    ledger,
    paymentCorrectionEvent(ledger, payment, change(payment, { amount: 700000 }), actor),
  );
  let after = ledger.payments[0];
  assert.equal(after.walletAdded, 200000);
  ledger = applyEvent(
    ledger,
    paymentCorrectionEvent(ledger, after, change(after, { amount: 400000 }), actor),
  );
  after = ledger.payments[0];
  assert.equal(after.walletAdded, 0);
  assert.equal(after.allocations[0].amount, 400000);
  assert.equal(
    jobBalance(
      ledger,
      ledger.jobs.find((j) => j.id === s.jobId),
    ).outstanding,
    100000,
  );
});
