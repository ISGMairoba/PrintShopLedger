import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSales, stockValue } from '../src/stock-value.mjs';

test('stock value: at cost, missing costs apart, shelf stock at its selling price', () => {
  const ledger = {
    materials: [
      { id: 'pen', name: 'Pens', available: 10, archived: false },
      { id: 'film', name: 'Film', available: 40, archived: false },
      { id: 'card', name: 'Card', available: 5, archived: false },
      { id: 'old', name: 'Old', available: 99, archived: true },
      { id: 'neg', name: 'Short', available: -3, archived: false },
    ],
    services: [
      {
        id: 'pen-cost',
        materialId: 'pen',
        private: true,
        archived: false,
        costing: { amount: 5000, per: 1 },
      },
      { id: 'pen-sale', materialId: 'pen', shelfItem: true, archived: false, price: 20000 },
      {
        id: 'film-cost',
        materialId: 'film',
        private: true,
        archived: false,
        costing: { amount: 100000, per: 50 },
      },
      {
        id: 'card-sale',
        materialId: 'card',
        shelfItem: true,
        archived: false,
        price: 10000,
        production: { perItem: 5 },
      },
      { id: 'neg-cost', materialId: 'neg', archived: false, costing: { amount: 100, per: 1 } },
    ],
  };
  const v = stockValue(ledger);
  assert.equal(v.atCost, 10 * 5000 + 40 * 2000, 'stock below zero counts as none');
  assert.equal(v.costed, 3);
  assert.deepEqual(v.uncostedNames, ['Card']);
  assert.equal(v.shelfItems, 2);
  assert.equal(v.shelfAtPrice, 10 * 20000 + (5 / 5) * 10000);
  assert.equal(v.shelfAtCost, 50000);
  assert.equal(v.shelfUncosted, 1);
});

test('recent sales: newest sales first, payments without jobs left out', () => {
  const sale = (id, at, jobs) => ({
    id,
    createdAt: at,
    customerId: 'c',
    jobs,
    total: 1000,
    cashReceived: 500,
    method: 'Cash',
    createdByLabel: 'Ada',
  });
  const ledger = {
    customers: [{ id: 'c', name: 'Bayo' }],
    checkouts: [
      sale('a', '2026-11-01T10:00:00Z', [{ description: 'Flyers' }]),
      sale('b', '2026-11-02T10:00:00Z', []),
      sale('c', '2026-11-03T10:00:00Z', [{ description: 'Pens' }, { description: 'Card' }]),
    ],
  };
  const r = recentSales(ledger, 10);
  assert.deepEqual(
    r.map((x) => x.record.id),
    ['c', 'a'],
  );
  assert.equal(r[0].customer, 'Bayo');
  assert.deepEqual(r[0].items, ['Pens', 'Card']);
  assert.equal(recentSales(ledger, 1).length, 1);
});
