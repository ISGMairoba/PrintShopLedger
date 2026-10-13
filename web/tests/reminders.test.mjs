import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { owingCustomers, reminderEvent, reminderMessage } from '../src/reminders.mjs';
import { eventResources } from '../src/sync-dependencies.mjs';
import { canAccessPage, navigationPages } from '../src/page-access.mjs';

const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: '2026-10-01T09:00:00Z' };
const job = (id, customerId, amount, createdAt, extra = {}) => ({
  id,
  customerId,
  service: 'Printing',
  description: 'Flyers',
  amount,
  createdAt,
  ...extra,
});
const fixture = () => {
  let l = emptyLedger();
  for (const [id, name, phone] of [
    ['a', 'Ada Obi', '0801'],
    ['b', 'Bayo', '0802'],
    ['c', 'Chi', '0803'],
  ])
    l = applyEvent(l, {
      id: 'c-' + id,
      kind: 'customer.created',
      data: { id, name, phone, address: '', creditLimit: 0, ...audit },
    });
  l.jobs = [
    job('j1', 'a', 500000, '2026-09-01T10:00:00Z'),
    job('j2', 'a', 200000, '2026-10-05T10:00:00Z'),
    job('j3', 'b', 900000, '2026-10-10T10:00:00Z'),
    job('j4', 'c', 300000, '2026-08-01T10:00:00Z', { productionStatus: 'Cancelled', amount: 0 }),
    job('j5', 'c', 100000, '2026-10-11T10:00:00Z'),
  ];
  l.payments = [
    {
      id: 'p1',
      customerId: 'c',
      amount: 100000,
      allocations: [{ jobId: 'j5', amount: 100000 }],
      paidOn: '2026-10-11',
      createdAt: '2026-10-11T10:00:00Z',
    },
  ];
  return l;
};

test('Owing customers: oldest debt first, with amount, unpaid jobs and age', () => {
  const rows = owingCustomers(fixture(), '2026-10-13T09:00:00Z');
  assert.deepEqual(
    rows.map((r) => [r.name, r.owed, r.jobs, r.oldest, r.age]),
    [
      ['Ada Obi', 700000, 2, '2026-09-01', 42],
      ['Bayo', 900000, 1, '2026-10-10', 3],
    ],
    'paid and cancelled jobs are left out',
  );
});

test('Reminders are recorded, shown as the last reminder, and never change balances', () => {
  let ledger = fixture();
  const [ada] = owingCustomers(ledger, '2026-10-13T09:00:00Z');
  const event = reminderEvent(ada, 'whatsapp', { id: 'u', label: 'Ada' }, '2026-10-13T09:30:00Z');
  ledger = applyEvent(applyEvent(ledger, event), event);
  assert.equal(ledger.reminders.length, 1);
  const again = owingCustomers(ledger, '2026-10-13T10:00:00Z')[0];
  assert.equal(again.owed, 700000);
  assert.deepEqual(
    [again.lastReminder.remindedAt, again.lastReminder.channel],
    ['2026-10-13T09:30:00Z', 'whatsapp'],
  );
  assert.deepEqual([...eventResources(event, ledger)], ['reminder:' + event.data.id]);
});

test('The reminder message is short and polite', () => {
  const [ada] = owingCustomers(fixture(), '2026-10-13T09:00:00Z');
  assert.equal(
    reminderMessage(ada, 'Packrium'),
    'Hello Ada, this is a friendly reminder from Packrium that ₦7,000.00 is outstanding on your account (the oldest from 1 Sept 2026). Your statement is attached. Thank you.'.replace(
      '1 Sept 2026',
      new Date('2026-09-01T12:00:00Z').toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    ),
  );
});

test('Payment Reminders follow Customers access and sit after Customers', () => {
  assert.equal(navigationPages[navigationPages.indexOf('Customers') + 1], 'Payment Reminders');
  assert.equal(canAccessPage('Payment Reminders', 2), canAccessPage('Customers', 2));
  assert.equal(
    canAccessPage('Payment Reminders', 1, { 1: ['My Account'], 2: ['My Account'], 3: ['My Account'] }),
    false,
  );
});
