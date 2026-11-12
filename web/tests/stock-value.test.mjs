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

test('stock value: shelf stock is valued at the lowest price per item (biggest pack or range)', async () => {
  const { lowestUnitPrice } = await import('../src/stock-value.mjs');
  const bags = {
    price: 7000,
    packPrices: [
      { quantity: 25, price: 150000 },
      { quantity: 50, price: 300000 },
      { quantity: 100, price: 550000 },
    ],
  };
  assert.equal(lowestUnitPrice(bags), 5500, '₦5,500 ÷ 100 = ₦55 each');
  assert.equal(
    lowestUnitPrice({
      price: 10000,
      priceTiers: [
        { from: 10, price: 9000 },
        { from: 50, price: 8000 },
      ],
    }),
    8000,
  );
  assert.equal(lowestUnitPrice({ price: 10000 }), 10000);
  const ledger = {
    materials: [{ id: 'bag', name: 'Bags', available: 5177, archived: false }],
    services: [{ id: 'b', materialId: 'bag', shelfItem: true, archived: false, ...bags }],
  };
  assert.equal(stockValue(ledger).shelfAtPrice, 5177 * 5500);
});

test('dashboard expenses: by category and by payee in the period, voided left out', async () => {
  const { expenseBreakdown } = await import('../src/expense-breakdown.mjs');
  const e = (id, category, amount, incurredOn, extra = {}) => ({
    id,
    category,
    amount,
    incurredOn,
    payee: '',
    voided: false,
    ...extra,
  });
  const ledger = {
    payees: [{ id: 'p1', name: 'NEPA' }],
    expenses: [
      e('1', 'Power', 5000, '2026-11-02', { payeeId: 'p1' }),
      e('2', 'power', 3000, '2026-11-03', { payee: 'NEPA office' }),
      e('3', 'Paper', 9000, '2026-11-04', { payee: 'Ade Stores' }),
      e('4', 'Paper', 1000, '2026-11-05', { voided: true }),
      e('5', 'Paper', 2000, '2026-10-30'),
    ],
  };
  const cats = expenseBreakdown(ledger, '2026-11-01', '2026-11-30', 'category');
  assert.deepEqual(
    cats.map((c) => [c.name, c.amount]),
    [
      ['Paper', 9000],
      ['Power', 8000],
    ],
  );
  const payees = expenseBreakdown(ledger, '2026-11-01', '2026-11-30', 'payee');
  assert.deepEqual(
    payees.map((c) => [c.name, c.amount]),
    [
      ['Ade Stores', 9000],
      ['NEPA', 5000],
      ['NEPA office', 3000],
    ],
  );
});
