import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { prepareCheckout, accountToken } from '../src/checkout.mjs';
import {
  approvalEvent,
  correctionChanges,
  ownSaleAdjustments,
  ownSaleJobs,
} from '../src/correction-requests.mjs';

const at = '2026-10-17T09:00:00Z';
const id = () => crypto.randomUUID();
const cashier = { id: 'cashier', label: 'Musa' },
  admin = { id: 'admin', label: 'Ada' };

function shop() {
  let ledger = emptyLedger();
  const audit = { modifiedBy: admin.id, modifiedByLabel: admin.label, modifiedAt: at };
  const apply = (kind, data) => {
    ledger = applyEvent(ledger, { id: id(), kind, data: { ...data, ...audit } });
    return data.id;
  };
  const service = apply('service.created', {
    id: id(),
    description: 'Design',
    materialId: null,
    price: 300000,
  });
  const customer = apply('customer.created', {
    id: id(),
    name: 'Bello',
    phone: '0801',
    address: '',
    creditLimit: 0,
  });
  const sell = (who, jobId) => {
    ledger = applyEvent(
      ledger,
      prepareCheckout(
        ledger,
        {
          customerId: customer,
          lines: [
            {
              id: jobId,
              serviceId: service,
              description: 'Logo',
              quantity: '1',
              source: 'WhatsApp',
              sourceNote: '',
            },
          ],
          cashReceived: 0,
          useWallet: false,
          paidOn: '2026-10-17',
          method: 'Cash',
          reference: '',
        },
        who,
        id(),
        at,
      ),
    );
    return jobId;
  };
  const mine = sell(cashier, id()),
    theirs = sell(admin, id());
  return { get: () => ledger, set: (l) => (ledger = l), mine, theirs, customer };
}

test('a cashier sees only the jobs and corrections from their own sales', () => {
  const s = shop();
  assert.deepEqual(
    ownSaleJobs(s.get(), cashier.id).map((j) => j.id),
    [s.mine],
  );
  assert.deepEqual(ownSaleAdjustments(s.get(), cashier.id), []);
});

test('approving refreshes the version checks, keeps the cashier’s correction and records both people', () => {
  const s = shop();
  const job = s.get().jobs.find((j) => j.id === s.mine);
  const request = {
    id: id(),
    jobId: job.id,
    kind: 'sale.corrected',
    reason: 'Wrong price',
    requestedBy: cashier.id,
    requestedByLabel: cashier.label,
    requestedAt: at,
    status: 'pending',
    event: {
      id: '',
      kind: 'sale.corrected',
      data: {
        jobId: job.id,
        baseVersion: job.version ?? 1,
        expectedAccount: accountToken(s.get(), job.customerId),
        reason: 'Wrong price',
        amount: 250000,
        description: 'Logo',
        modifiedBy: cashier.id,
        modifiedByLabel: cashier.label,
        modifiedAt: at,
      },
    },
  };
  request.event.id = request.id;
  // Meanwhile the other job was corrected, so the customer's account changed.
  const other = s.get().jobs.find((j) => j.id === s.theirs);
  s.set(
    applyEvent(s.get(), {
      id: id(),
      kind: 'sale.corrected',
      data: {
        jobId: other.id,
        baseVersion: other.version ?? 1,
        expectedAccount: accountToken(s.get(), other.customerId),
        reason: 'x',
        amount: 100000,
        description: 'Logo',
        modifiedBy: admin.id,
        modifiedByLabel: admin.label,
        modifiedAt: at,
      },
    }),
  );
  assert.throws(() => applyEvent(s.get(), request.event));
  const event = approvalEvent(s.get(), request, admin, at);
  assert.equal(event.id, request.id);
  assert.equal(event.data.amount, 250000);
  assert.equal(event.data.modifiedBy, admin.id);
  assert.equal(event.data.requestedByLabel, cashier.label);
  const next = applyEvent(s.get(), event);
  assert.equal(next.jobs.find((j) => j.id === s.mine).amount, 250000);
  const rows = correctionChanges(s.get(), next, s.mine);
  assert.deepEqual(rows[0], ['Charge', '₦3,000.00', '₦2,500.00'].map(String));
  const record = next.saleAdjustments.find((r) => r.id === request.id);
  assert.equal(record.changedBy, admin.id);
  assert.equal(ownSaleAdjustments(next, cashier.id).length, 1);
});
