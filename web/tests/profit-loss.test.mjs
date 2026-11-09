import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { previousPeriod, profitLoss, profitLossSections } from '../src/profit-loss.mjs';

test('profit and loss: gross profit, expenses by category (stock purchases apart), other income', () => {
  const l = {
    ...emptyLedger(),
    services: [
      {
        id: 's',
        description: 'Design',
        price: 1000000,
        archived: false,
        costing: { key: 'design', amount: 200000, per: 1 },
      },
    ],
    jobs: [
      {
        id: 'j1',
        serviceId: 's',
        service: 'Design',
        description: 'Logo',
        quantity: '1',
        amount: 1000000,
        productionStatus: 'Completed',
        createdAt: '2026-11-03T10:00:00Z',
      },
      {
        id: 'j2',
        serviceId: 'x',
        service: 'Other',
        description: 'Misc',
        quantity: '1',
        amount: 300000,
        productionStatus: 'Added',
        createdAt: '2026-11-04T10:00:00Z',
      },
      {
        id: 'j3',
        serviceId: 's',
        service: 'Design',
        description: 'Old',
        quantity: '1',
        amount: 500000,
        productionStatus: 'Completed',
        createdAt: '2026-10-20T10:00:00Z',
      },
    ],
    expenses: [
      {
        id: 'e1',
        category: 'Rent',
        amount: 400000,
        incurredOn: '2026-11-01',
        materials: [],
        voided: false,
        payments: [],
      },
      {
        id: 'e2',
        category: 'Fuel',
        amount: 50000,
        incurredOn: '2026-11-02',
        materials: [],
        voided: false,
        payments: [],
      },
      {
        id: 'e3',
        category: 'Materials',
        amount: 900000,
        incurredOn: '2026-11-02',
        materials: [{ materialId: 'm' }],
        voided: false,
        payments: [],
      },
      {
        id: 'e4',
        category: 'Fuel',
        amount: 70000,
        incurredOn: '2026-11-05',
        materials: [],
        voided: true,
        payments: [],
      },
    ],
    accountEntries: [
      {
        id: 'g',
        action: 'money',
        moneyType: 'other_income',
        amount: 100000,
        direction: 1,
        accountId: 'a',
        paidOn: '2026-11-06',
      },
    ],
  };
  assert.deepEqual(previousPeriod('2026-11-01', '2026-11-30'), { from: '2026-10-02', to: '2026-10-31' });
  const r = profitLoss(l, '2026-11-01', '2026-11-30');
  assert.equal(r.sales, 1300000);
  assert.equal(r.grossProfit, 1300000 - r.jobCost);
  assert.deepEqual(r.expenses, [
    { category: 'Rent', amount: 400000 },
    { category: 'Fuel', amount: 50000 },
  ]);
  assert.equal(r.stockPurchases, 900000);
  assert.equal(r.otherIncome, 100000);
  assert.equal(r.net, r.grossProfit - 450000 + 100000);
  assert.equal(r.unknownJobs, 1);
  assert.equal(r.previous.sales, 500000);
  const rows = profitLossSections(r, { money: (k) => (typeof k === 'number' ? k / 100 : k) })[0].rows;
  assert.deepEqual(
    rows.find((x) => x[0] === 'Net profit'),
    ['Net profit', r.net / 100, r.previous.net / 100],
  );
});

test('profit and loss: a partly costed job counts its known cost and is still flagged', () => {
  const l = {
    ...emptyLedger(),
    services: [
      { id: 'paper', description: 'Paper', price: 100, archived: false, materialId: 'm1', costing: { key: 'paper', amount: 40000, per: 1 } },
    ],
    jobs: [
      {
        id: 'j',
        serviceId: 'bag',
        service: 'Bag',
        description: 'Bag',
        quantity: '1',
        amount: 100000,
        productionStatus: 'Completed',
        createdAt: '2026-11-03T10:00:00Z',
        materialChoice: { options: ['m1', 'm2'], work: 1 },
        materialUsed: { usages: [{ materialId: 'm1', quantity: 1 }, { materialId: 'm2', quantity: 1 }] },
      },
    ],
  };
  const r = profitLoss(l, '2026-11-01', '2026-11-30');
  assert.equal(r.sales, 100000);
  assert.equal(r.jobCost, 40000);
  assert.equal(r.grossProfit, 60000);
  assert.equal(r.unknownJobs, 1);
});
