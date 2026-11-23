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
      {
        id: 'paper',
        description: 'Paper',
        price: 100,
        archived: false,
        materialId: 'm1',
        costing: { key: 'paper', amount: 40000, per: 1 },
      },
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
        materialUsed: {
          usages: [
            { materialId: 'm1', quantity: 1 },
            { materialId: 'm2', quantity: 1 },
          ],
        },
      },
    ],
  };
  const r = profitLoss(l, '2026-11-01', '2026-11-30');
  assert.equal(r.sales, 100000);
  assert.equal(r.jobCost, 40000);
  assert.equal(r.grossProfit, 60000);
  assert.equal(r.unknownJobs, 1);
});

test('expenses linked to orders count in their job cost, not under expenses', async () => {
  const { jobCost } = await import('../src/profit.mjs');
  const { expenseJobIds } = await import('../src/expenses.mjs');
  const job = (id, amount) => ({
    id,
    serviceId: 'svc',
    service: 'Banner',
    description: 'Banner',
    quantity: '1',
    amount,
    productionStatus: 'Completed',
    createdAt: '2026-11-03T10:00:00Z',
  });
  const l = {
    ...emptyLedger(),
    services: [
      { id: 'svc', description: 'Banner', price: 100, archived: false, costing: { amount: 10000, per: 1 } },
    ],
    jobs: [job('a', 30000), job('b', 10000), { ...job('c', 50000), productionStatus: 'Cancelled' }],
    expenses: [
      {
        id: 'x',
        category: 'Outsourcing',
        amount: 8000,
        incurredOn: '2026-11-04',
        voided: false,
        materials: [],
        jobIds: ['a', 'b', 'c'],
      },
      { id: 'y', category: 'Power', amount: 5000, incurredOn: '2026-11-04', voided: false, materials: [] },
    ],
  };
  assert.equal(jobCost(l, l.jobs[0]).kobo, 10000 + 6000, 'shared by order amount: 3/4 of ₦80');
  assert.equal(jobCost(l, l.jobs[1]).kobo, 10000 + 2000);
  const r = profitLoss(l, '2026-11-01', '2026-11-30');
  assert.equal(r.jobCost, 28000);
  assert.deepEqual(r.expenses, [{ category: 'Power', amount: 5000 }]);
  assert.equal(r.linkedToOrders, 8000);
  assert.throws(() => expenseJobIds(l, ['a'], [{ materialId: 'm' }]), /stock purchase/);
  assert.throws(() => expenseJobIds(l, ['nope']), /not found/);
  assert.throws(() => expenseJobIds(l, ['a', 'a']), /once/);
});

test('Estimated cost method: material cost price for jobs, waste and cancelled order losses', () => {
  const line = (id, jobId, action, before, after, day) => ({
    id,
    materialId: 'm',
    jobId,
    action,
    beforeAvailable: before,
    afterAvailable: after,
    changedAt: `2026-11-${day}T10:00:00Z`,
  });
  const l = {
    ...emptyLedger(),
    // No restock prices anywhere: the material's own cost price is all there is.
    materials: [{ id: 'm', name: 'Art paper', available: 80, measurementUnit: 'sheet', costPrice: 5000 }],
    services: [{ id: 's', description: 'Flyers', price: 20000, archived: false, materialId: 'm' }],
    jobs: [
      {
        id: 'sold',
        serviceId: 's',
        materialId: 'm',
        materialNeeded: 10,
        service: 'Flyers',
        description: 'Sold',
        quantity: '10',
        amount: 200000,
        productionStatus: 'Completed',
        createdAt: '2026-11-05T10:00:00Z',
      },
      {
        id: 'gone',
        serviceId: 's',
        materialId: 'm',
        materialNeeded: 6,
        service: 'Flyers',
        description: 'Cancelled',
        quantity: '6',
        amount: 120000,
        productionStatus: 'Cancelled',
        createdAt: '2026-11-06T10:00:00Z',
      },
    ],
    materialHistory: [
      line('h1', 'sold', 'material.job_used', 100, 90, '05'),
      line('h2', 'gone', 'material.job_used', 90, 84, '06'),
      line('h3', 'gone', 'material.job_corrected', 84, 86, '07'), // 2 of the 6 sheets came back
      line('h4', null, 'material.wasted', 86, 83, '08'),
    ],
  };
  const r = profitLoss(l, '2026-11-01', '2026-11-30');
  assert.equal(r.method, 'estimated');
  assert.equal(r.jobCost, 50000, '10 sheets at ₦50');
  assert.equal(r.waste, 15000, '3 sheets wasted');
  assert.equal(r.cancelledLoss, 20000, '4 sheets kept by the cancelled order');
  assert.equal(r.lateCost, 0);
  assert.equal(r.grossProfit, 200000 - 50000 - 15000 - 20000);
  const rows = profitLossSections(r, { money: String })[0].rows.map((row) => row[0]);
  assert.ok(rows.includes('Cost of goods used (estimated)'));
  assert.ok(!rows.includes('Late cost adjustments'));
});
