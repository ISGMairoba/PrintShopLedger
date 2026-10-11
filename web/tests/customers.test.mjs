import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger, customerBalance } from '../src/domain.mjs';
import {
  createCustomerEvent,
  customerMatches,
  normalizeCustomer,
  phoneKey,
  phoneOwner,
} from '../src/customers.mjs';
import { resolveCustomerState } from '../src/customer-conflicts.mjs';
import { sortRows } from '../src/table-sort.mjs';
const actor = { id: 'test-user', label: 'Test User' },
  now = '2026-10-05T12:00:00.000Z';
const create = () =>
  createCustomerEvent(
    { name: ' Jane Doe ', phone: '08012345678', address: 'Market Road', creditLimit: 12345 },
    actor,
    (() => {
      let i = 0;
      return () => String(++i);
    })(),
    now,
  );
const edit = (kind, version, values = {}) => ({
  id: kind + version,
  kind,
  data: {
    id: '2',
    baseVersion: version,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
    ...values,
  },
});
test('customer creation trims fields and keeps audit, cents and distinct IDs', () => {
  const event = create(),
    ledger = applyEvent(emptyLedger(), event),
    c = ledger.customers[0];
  assert.notEqual(event.id, event.data.id);
  assert.equal(c.name, 'Jane Doe');
  assert.equal(c.creditLimit, 12345);
  assert.equal(c.createdByLabel, 'Test User');
  assert.equal(c.version, 1);
  assert.deepEqual(applyEvent(ledger, event), ledger);
});
test('name and phone required; optional address; limits reject negative and fractional kobo', () => {
  for (const values of [
    { name: '' },
    { phone: '' },
    { creditLimit: -1 },
    { creditLimit: 0.5 },
    { creditLimit: 100000000001 },
  ])
    assert.throws(() => createCustomerEvent({ ...create().data, ...values }, actor));
  assert.equal(createCustomerEvent({ name: 'A', phone: '1' }, actor, () => 'id', now).data.address, '');
});
test('edits preserve creation audit; archive and restore retain jobs and payments', () => {
  let ledger = applyEvent(emptyLedger(), create());
  ledger = applyEvent(ledger, {
    id: 'job-event',
    kind: 'job.created',
    data: { id: 'job', customerId: '2', description: 'Job', service: 'Print', amount: 10000, createdAt: now },
  });
  const original = ledger.customers[0],
    jobs = ledger.jobs,
    payments = ledger.payments;
  ledger = applyEvent(
    ledger,
    edit('customer.updated', 1, { name: 'Jane Updated', phone: '123', address: 'New Road', creditLimit: 0 }),
  );
  assert.equal(ledger.customers[0].createdAt, original.createdAt);
  assert.equal(ledger.customers[0].createdBy, original.createdBy);
  ledger = applyEvent(ledger, edit('customer.archived', 2));
  assert.equal(ledger.customers[0].archived, true);
  assert.equal(ledger.jobs, jobs);
  assert.equal(ledger.payments, payments);
  assert.equal(customerBalance(ledger, '2'), 10000);
  assert.throws(
    () => applyEvent(ledger, edit('customer.updated', 3, { name: 'Jane', phone: '1' })),
    /Restore/,
  );
  ledger = applyEvent(ledger, edit('customer.restored', 3));
  assert.equal(ledger.customers[0].archived, false);
  assert.throws(() => applyEvent(ledger, edit('customer.archived', 1)), /changed elsewhere/);
});
test('legacy customers and queued creates remain usable', () => {
  const old = { id: 'old', name: 'Old customer', phone: '', createdAt: now };
  const ledger = applyEvent(emptyLedger(), { id: 'legacy', kind: 'customer.created', data: old });
  assert.equal(ledger.customers[0].creditLimit, 0);
  assert.equal(normalizeCustomer(old).modifiedByLabel, 'Unknown (older record)');
});
test('search includes ID, address, phone, credit and hidden audit fields', () => {
  const c = applyEvent(emptyLedger(), create()).customers[0];
  for (const q of ['jane', 'market', '080123', '123.45', 'test user', '2026-10-05', 'active'])
    assert.ok(customerMatches(c, q, [c]), q);
  assert.equal(customerMatches(c, 'missing', [c]), false);
});
test('conflict choices preserve unrelated work and regenerate versioned edits', () => {
  const cloud = applyEvent(emptyLedger(), create());
  const local = applyEvent(
    cloud,
    edit('customer.updated', 1, { name: 'Local', phone: '1', creditLimit: 400 }),
  );
  const remote = applyEvent(
    cloud,
    edit('customer.updated', 1, { name: 'Remote', phone: '2', creditLimit: 500 }),
  );
  const state = {
    ledger: local,
    pending: [edit('customer.updated', 1, { name: 'Local', phone: '1', creditLimit: 400 })],
  };
  const kept = resolveCustomerState(state, remote, '2', 'local', () => 'fresh', now);
  assert.equal(kept.ledger.customers[0].name, 'Local');
  assert.equal(kept.pending[0].data.baseVersion, 2);
  const discarded = resolveCustomerState(state, remote, '2', 'cloud', () => 'fresh', now);
  assert.equal(discarded.ledger.customers[0].name, 'Remote');
  assert.equal(discarded.pending.length, 0);
});
test('sorting compares numeric quantities and prices, is stable and leaves input unchanged', () => {
  const rows = [
    { v: 10, id: 'a' },
    { v: 2, id: 'b' },
    { v: 2, id: 'c' },
    { v: null, id: 'd' },
  ];
  assert.deepEqual(
    sortRows(rows, (r) => r.v, 'asc').map((r) => r.id),
    ['b', 'c', 'a', 'd'],
  );
  assert.deepEqual(
    sortRows(rows, (r) => r.v, 'desc').map((r) => r.id),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(
    sortRows(['Item 10', 'item 2'], (v) => v),
    ['item 2', 'Item 10'],
  );
});

test('phone numbers compare in local Nigerian form', () => {
  for (const value of ['+234 803 123 4567', '2348031234567', '0803-123-4567', '803 123 4567'])
    assert.equal(phoneKey(value), '08031234567');
  assert.equal(phoneKey(''), '');
  assert.equal(phoneOwner([{ id: 'a', phone: '08031234567' }], '+2348031234567', 'a'), null);
});

test('each phone number belongs to one customer', () => {
  const actor = { id: 'u', label: 'Joy' };
  const at = '2026-10-11T10:00:00.000Z';
  let n = 0;
  const make = (fields) => createCustomerEvent(fields, actor, () => `id-${++n}`, at);
  let ledger = applyEvent(emptyLedger(), make({ name: 'Ada', phone: '0803 123 4567' }));
  assert.throws(
    () => applyEvent(ledger, make({ name: 'Bola', phone: '+234 803 123 4567' })),
    /already belongs to Ada/,
  );
  ledger = applyEvent(ledger, make({ name: 'Bola', phone: '0805 000 0000' }));
  const bola = ledger.customers.find((c) => c.name === 'Bola');
  const update = (phone) => ({
    id: `upd-${++n}`,
    kind: 'customer.updated',
    data: { id: bola.id, baseVersion: 1, name: 'Bola', phone, modifiedBy: 'u', modifiedAt: at },
  });
  assert.throws(() => applyEvent(ledger, update('08031234567')), /already belongs to Ada/);
  assert.equal(
    applyEvent(ledger, update('08050000000')).customers.find((c) => c.id === bola.id).phone,
    '08050000000',
  );
});

test('older customers that already share a number stay editable without changing it', () => {
  const at = '2026-10-11T10:00:00.000Z';
  const ledger = {
    ...emptyLedger(),
    customers: [
      { id: 'j1', name: 'JAURO', phone: '09034342491', createdAt: at, version: 1 },
      { id: 'j2', name: 'JAURO', phone: '09034342491', createdAt: at, version: 1 },
    ],
  };
  const next = applyEvent(ledger, {
    id: 'e1',
    kind: 'customer.updated',
    data: {
      id: 'j2',
      baseVersion: 1,
      name: 'JAURO',
      phone: '09034342491',
      address: 'Kano',
      modifiedBy: 'u',
      modifiedAt: at,
    },
  });
  assert.equal(next.customers.find((c) => c.id === 'j2').address, 'Kano');
});
