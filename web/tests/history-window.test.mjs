import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyEvent, customerBalance } from '../src/domain.mjs';
import { prepareCheckout, walletBalance } from '../src/checkout.mjs';
import { historyCheck, trimHistory } from '../src/history-window.mjs';

const actor = { id: '10000000-0000-4000-8000-000000000001', label: 'Cashier' };
const ids = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const customer = (n, name) => ({
  id: ids(n),
  name,
  phone: '080' + n,
  address: '',
  creditLimit: 10000000,
  archived: false,
  version: 1,
});

/** A small business with sales from July to October: old paid, old unpaid, wallet top-ups, recent. */
function business() {
  let ledger = {
    ...emptyLedger(),
    customers: [customer(1, 'Ada'), customer(2, 'Bayo'), customer(3, 'Chi')],
    materials: [
      {
        id: ids(10),
        name: 'Paper',
        available: 1000,
        measurementUnit: 'sheet',
        requireSize: false,
        archived: false,
        version: 1,
      },
    ],
    services: [
      {
        id: ids(20),
        description: 'Printing',
        materialId: ids(10),
        price: 10000,
        version: 1,
        archived: false,
      },
      { id: ids(21), description: 'Design', materialId: null, price: 50000, version: 1, archived: false },
    ],
  };
  let n = 100;
  const sale = (customerId, day, quantity, cash, serviceId = ids(20), useWallet = false) => {
    const event = prepareCheckout(
      ledger,
      {
        customerId,
        lines: [{ id: ids(n++), serviceId, description: 'Job', quantity, source: 'In shop / USB' }],
        cashReceived: cash,
        useWallet,
        method: 'Cash',
        paidOn: day,
        reference: '',
      },
      actor,
      ids(n++),
      `${day}T10:00:00.000Z`,
    );
    ledger = applyEvent(ledger, event);
    return event.data;
  };
  const collect = (checkout, day) => {
    ledger = {
      ...ledger,
      jobs: ledger.jobs.map((j) =>
        j.checkoutId === checkout.id
          ? { ...j, productionStatus: 'Collected', modifiedAt: `${day}T15:00:00.000Z` }
          : j,
      ),
    };
  };
  const close = (checkouts, day) => {
    const id = ids(n++);
    ledger = {
      ...ledger,
      checkouts: ledger.checkouts.map((c) =>
        checkouts.some((x) => x.id === c.id) ? { ...c, drawerClosingId: id } : c,
      ),
      drawerClosings: [
        ...ledger.drawerClosings,
        {
          id,
          fromUserId: actor.id,
          fromUserLabel: actor.label,
          toUserId: actor.id,
          toUserLabel: actor.label,
          closedAt: `${day}T20:00:00.000Z`,
          checkoutIds: checkouts.map((c) => c.id),
          openingId: null,
          openingCash: 0,
          cashCollected: 0,
          totalCollected: 0,
          posCollected: 0,
          transferCollected: 0,
          walletUsed: 0,
          jobSales: 0,
          expectedCash: 0,
          countedCash: 0,
          difference: 0,
          note: '',
        },
      ],
    };
  };
  // July: Ada pays in full and overpays (wallet ₦300); Bayo pays half (still owes).
  const a1 = sale(ids(1), '2026-07-02', 2, 50000);
  collect(a1, '2026-07-03');
  const b1 = sale(ids(2), '2026-07-05', 4, 20000);
  collect(b1, '2026-07-06');
  close([a1, b1], '2026-07-05');
  // August: Ada uses part of her wallet; Chi pays for design in full.
  const a2 = sale(ids(1), '2026-08-10', 1, 0, ids(20), true);
  collect(a2, '2026-08-11');
  const c1 = sale(ids(3), '2026-08-12', 1, 50000, ids(21));
  collect(c1, '2026-08-13');
  close([a2, c1], '2026-08-12');
  // October: recent work, one not yet collected and the drawer still open.
  const a3 = sale(ids(1), '2026-10-20', 3, 30000);
  collect(a3, '2026-10-21');
  sale(ids(3), '2026-10-22', 1, 20000);
  return ledger;
}

test('a trimmed copy drops old closed records and carries the wallet forward', () => {
  const ledger = business();
  const { ledger: trimmed, dropped, carried } = trimHistory(ledger, '2026-09-01');
  assert.equal(dropped.jobs, 3, "Ada's two old jobs and Chi's design go; Bayo still owes");
  assert.equal(trimmed.jobs.length, 3);
  assert.ok(
    trimmed.jobs.some((j) => j.customerId === ids(2)),
    'old unpaid job stays',
  );
  assert.equal(carried, 1, "only Ada's wallet is carried forward");
  assert.equal(walletBalance(trimmed, ids(1)), walletBalance(ledger, ids(1)));
  assert.equal(customerBalance(trimmed, ids(2)), customerBalance(ledger, ids(2)));
  assert.ok(trimmed.drawerClosings.length >= 1, 'the latest drawer closing stays');
  assert.ok(trimmed.checkouts.length < ledger.checkouts.length);
});

test('every checked figure is the same from the full and the trimmed copy', () => {
  const ledger = business();
  const result = historyCheck(ledger, { now: '2026-10-23T12:00:00.000Z', cutoff: '2026-09-01' });
  assert.deepEqual(result.differences, []);
  assert.ok(result.checked > 20);
  assert.ok(result.dropped.jobs > 0);
  // With the cutoff before everything, nothing is dropped and all figures match.
  const none = historyCheck(ledger, { now: '2026-10-23T12:00:00.000Z', cutoff: '2026-01-01' });
  assert.equal(none.dropped.jobs, 0);
  assert.deepEqual(none.differences, []);
});
