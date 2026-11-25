import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStockCountEvent,
  canFinish,
  countMaterials,
  countReminderDue,
  countReview,
  reservedMap,
  reservedStock,
  stockAsOf,
} from '../src/stock-count.mjs';
import { materialsAt, validProductionSettings } from '../src/production-materials.mjs';
import { setMaterialsAtSale, setStockBelowZeroBlocked } from '../src/stock-rule.mjs';
import { applyCheckout } from '../src/checkout.mjs';
import { fixture } from './pricing-fixture.mjs';

const at = (h) => new Date(Date.parse('2026-11-26T08:00:00Z') + h * 3600000).toISOString();
const who = { modifiedBy: 'u1', modifiedByLabel: 'Ada' };
const base = () => ({
  materials: [
    { id: 'm1', name: 'A4 paper', measurementUnit: 'sheet', available: 100, version: 1, costPrice: 5000, createdAt: at(-100) },
    { id: 'm2', name: 'Card', measurementUnit: 'sheet', available: 20, version: 1, createdAt: at(-100) },
    { id: 'm3', name: 'Old ink', measurementUnit: 'bottle', available: 3, version: 1, archived: true, createdAt: at(-100) },
  ],
  materialHistory: [],
  materialShelves: [{ id: 'm2', shelf: 'Rack B' }, { id: 'm1', shelf: 'Rack A' }],
  jobs: [],
  stockCounts: [],
});

test('A count: lines by shelf, saved as typed, finished with what moved since each row', () => {
  let l = base();
  assert.deepEqual(
    countMaterials(l, { kind: 'all' }).map((m) => m.id),
    ['m1', 'm2'],
  );
  assert.deepEqual(
    countMaterials(l, { kind: 'shelf', shelves: ['Rack B'] }).map((m) => m.id),
    ['m2'],
  );
  l = applyStockCountEvent(l, {
    id: 'e1',
    kind: 'count.saved',
    data: { id: 'c1', baseVersion: 0, name: 'Month-end', scope: { kind: 'all' }, lines: [{ materialId: 'm1', counted: null }, { materialId: 'm2', counted: null }], ...who, modifiedAt: at(0) },
  });
  l = applyStockCountEvent(l, {
    id: 'e2',
    kind: 'count.saved',
    data: {
      id: 'c1',
      baseVersion: 1,
      name: 'Month-end',
      scope: { kind: 'all' },
      lines: [
        { materialId: 'm1', counted: 90, countedAt: at(1) },
        { materialId: 'm2', counted: null },
      ],
      ...who,
      modifiedAt: at(1),
    },
  });
  // 10 sold after the row was counted.
  l = {
    ...l,
    materials: l.materials.map((m) => (m.id === 'm1' ? { ...m, available: 90 } : m)),
    materialHistory: [{ id: 'h1', materialId: 'm1', beforeAvailable: 100, afterAvailable: 90, changedAt: at(2) }],
  };
  assert.equal(stockAsOf(l, 'm1', at(1)), 100);
  const review = countReview(l, l.stockCounts[0]);
  assert.equal(review.lines[0].difference, -10);
  assert.equal(review.lines[0].setTo, 80);
  assert.equal(review.lines[0].value, -50000);
  assert.equal(review.lines[0].big, true);
  assert.equal(review.uncounted, 1);
  assert.equal(canFinish(review, 1), false);
  assert.equal(canFinish(review, 2), true);
  assert.equal(canFinish(review, 2, { flagPercent: 5, flagValue: 500000, approveRank: 3 }), false);
  l = applyStockCountEvent(l, {
    id: 'e3',
    kind: 'count.finished',
    data: { id: 'c1', baseVersion: 2, stockIds: { m1: 's1', m2: 's2' }, ...who, modifiedAt: at(3) },
  });
  assert.equal(l.materials.find((m) => m.id === 'm1').available, 80);
  assert.equal(l.materials.find((m) => m.id === 'm2').available, 20);
  assert.equal(l.materialHistory.at(-1).reason, 'Stock count: Month-end');
  assert.equal(l.stockCounts[0].status, 'finished');
  assert.throws(
    () =>
      applyStockCountEvent(l, { id: 'e4', kind: 'count.cancelled', data: { id: 'c1', baseVersion: 3, ...who, modifiedAt: at(4) } }),
    /already finished/,
  );
  // A stale save is refused.
  assert.throws(
    () =>
      applyStockCountEvent(l, {
        id: 'e5',
        kind: 'count.saved',
        data: { id: 'c1', baseVersion: 1, name: 'x', lines: [{ materialId: 'm1' }], ...who, modifiedAt: at(4) },
      }),
    /changed on another device/,
  );
});

test('Reserved by jobs that take materials in production, until their check is confirmed', () => {
  const l = {
    ...base(),
    jobs: [
      { id: 'j1', materialsAt: 'production', materialId: 'm1', materialNeeded: 30, productionStatus: 'Printing' },
      { id: 'j2', materialsAt: 'production', materialId: 'm1', materialNeeded: 5, productionStatus: 'Cancelled' },
      { id: 'j3', materialsAt: 'production', materialId: 'm1', materialNeeded: 7, materialCheck: { status: 'confirmed' } },
      { id: 'j4', materialId: 'm1', materialNeeded: 9 },
      { id: 'j5', materialsAt: 'production', templateSnapshot: { stock: [{ materialId: 'm2', quantity: 4 }] } },
    ],
  };
  assert.equal(reservedStock(l, 'm1'), 30);
  assert.equal(reservedStock(l, 'm1', 'j1'), 0);
  assert.deepEqual(reservedMap(l), { m1: 30, m2: 4 });
});

test('When materials leave stock: the business, a service of its own, shelf items at the sale', () => {
  assert.equal(materialsAt({}, {}), 'checkout');
  assert.equal(materialsAt({}, { materialsAt: 'production' }), 'production');
  assert.equal(materialsAt({ production: { materialsAt: 'checkout' } }, { materialsAt: 'production' }), 'checkout');
  assert.equal(materialsAt({ shelfItem: true, production: { materialsAt: 'production' } }, {}), 'checkout');
  const s = validProductionSettings({ extraMaterialsRank: 1, materialsAt: 'production', stockCount: { reminder: 'weekly' } });
  assert.equal(s.materialsAt, 'production');
  assert.equal(s.stockCount.reminder, 'weekly');
  assert.equal(s.stockCount.blind, true);
  assert.throws(() => validProductionSettings({ materialsAt: 'later' }), /Invalid production/);
});

test('A sale in production takes nothing; with stock below zero blocked, what is free must cover it', () => {
  const { ledger, event } = fixture();
  const before = ledger.materials.map((m) => [m.id, m.available]);
  try {
    setMaterialsAtSale('production');
    const l = applyCheckout(ledger, event);
    assert.deepEqual(
      l.materials.map((m) => [m.id, m.available]),
      before,
    );
    assert.ok(l.jobs.filter((j) => j.checkoutId === event.data.id).every((j) => j.materialsAt === 'production'));
    setMaterialsAtSale('checkout');
    const taken = applyCheckout(ledger, event);
    assert.notDeepEqual(
      taken.materials.map((m) => [m.id, m.available]),
      before,
    );
    // Blocked, and nothing free: refused.
    setMaterialsAtSale('production');
    setStockBelowZeroBlocked(true);
    const empty = { ...ledger, materials: ledger.materials.map((m) => ({ ...m, available: 0 })) };
    assert.throws(() => applyCheckout(empty, event), /Not enough/);
  } finally {
    setMaterialsAtSale('checkout');
    setStockBelowZeroBlocked(false);
  }
});

test('The count reminder: off by default, weekly, every N days, month-end', () => {
  const l = { ...base(), stockCounts: [{ status: 'finished', finishedAt: '2026-11-01T10:00:00Z' }] };
  assert.equal(countReminderDue(l, undefined, new Date('2026-11-26T10:00:00Z')), false);
  assert.equal(countReminderDue(l, { reminder: 'weekly' }, new Date('2026-11-06T10:00:00Z')), false);
  assert.equal(countReminderDue(l, { reminder: 'weekly' }, new Date('2026-11-09T10:00:00Z')), true);
  assert.equal(countReminderDue(l, { reminder: 'days', reminderDays: 30 }, new Date('2026-11-26T10:00:00Z')), false);
  assert.equal(countReminderDue(l, { reminder: 'monthEnd' }, new Date(2026, 10, 30, 12)), true);
  assert.equal(countReminderDue(l, { reminder: 'monthEnd' }, new Date(2026, 10, 15, 12)), false);
});
