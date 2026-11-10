import test from 'node:test';
import assert from 'node:assert/strict';
import { jobCost, profitReport, profitSections } from '../src/profit.mjs';

const ledger = {
  services: [
    { id: 'lam', materialId: 'film', costing: null },
    { id: 'film-cost', materialId: 'film', private: true, costing: { key: 'film', amount: 5000, per: 1 } },
    { id: 'design', materialId: null, costing: { key: 'design', amount: 20000, per: 1 } },
    { id: 'bag', materialId: null, costing: null },
    { id: 'glue-cost', materialId: 'glue', private: true, costing: { key: 'glue', amount: 1000, per: 2 } },
  ],
  jobs: [],
};
const job = (over) => ({
  id: Math.random().toString(),
  createdAt: '2026-11-05T10:00:00Z',
  description: 'x',
  productionStatus: 'Added',
  ...over,
});

test('job cost: template estimate, service cost, material cost, added materials', () => {
  assert.deepEqual(jobCost(ledger, job({ templateSnapshot: { price: { cost: '1234.5' } } })), {
    kobo: 123450,
    known: true,
    basis: 'Template estimate',
  });
  // 3 × A2 lamination using 12 A4 units of film at ₦50 each.
  assert.equal(
    jobCost(ledger, job({ serviceId: 'lam', materialId: 'film', materialNeeded: 12, quantity: 3 })).kobo,
    60000,
  );
  assert.equal(
    jobCost(ledger, job({ serviceId: 'design', materialId: null, materialNeeded: 0, quantity: 2 })).kobo,
    40000,
  );
  assert.equal(
    jobCost(ledger, job({ serviceId: 'bag', materialId: null, materialNeeded: 0, quantity: 1 })).known,
    false,
  );
  const bag = job({
    serviceId: 'bag',
    materialId: null,
    materialNeeded: 0,
    quantity: 1,
    extraMaterials: {
      usages: [
        { materialId: 'film', quantity: 2 },
        { materialId: 'glue', quantity: 4 },
      ],
    },
  });
  // Added materials count, but the bag itself has no cost set: unknown overall.
  assert.deepEqual(jobCost(ledger, bag), { kobo: 12000, known: false, basis: 'No cost set' });
  const template = job({
    templateSnapshot: { price: { cost: '100' } },
    extraMaterials: { usages: [{ materialId: 'film', quantity: 2 }], costCovered: true },
  });
  assert.equal(jobCost(ledger, template).kobo, 10000, 'Covered by the template price: not added again');
});

test('profit report: period, cancelled left out, unknown jobs kept apart', () => {
  const l = {
    ...ledger,
    jobs: [
      job({ serviceId: 'design', service: 'Design', amount: 100000, quantity: 1, materialNeeded: 0 }),
      job({
        serviceId: 'design',
        service: 'Design',
        amount: 50000,
        quantity: 1,
        materialNeeded: 0,
        productionStatus: 'Cancelled',
      }),
      job({ serviceId: 'bag', service: 'Paper bag', amount: 30000, quantity: 1, materialNeeded: 0 }),
      job({
        serviceId: 'design',
        service: 'Design',
        amount: 100000,
        quantity: 1,
        materialNeeded: 0,
        createdAt: '2026-12-01T10:00:00Z',
      }),
    ],
  };
  const r = profitReport(l, '2026-11-01', '2026-11-30');
  assert.deepEqual(r.totals, {
    jobs: 2,
    revenue: 100000,
    cost: 20000,
    profit: 80000,
    margin: 80,
    unknownJobs: 1,
    unknownRevenue: 30000,
    partialCost: 0,
    otherIncome: 0,
  });
  assert.equal(r.byItem[0].item, 'Design');
  assert.equal(profitSections(r, { money: (k) => (k / 100).toFixed(2) })[0].rows[4][1], '800.00');
});

test('profit: a job keeps the costs it was sold with', async () => {
  const { jobCost } = await import('../src/profit.mjs');
  const ledger = {
    services: [
      { id: 's', description: 'Flyer', price: 100, archived: false, costing: { amount: 8000, per: 1 } },
      {
        id: 'p',
        description: 'Paper',
        price: 100,
        archived: false,
        materialId: 'm',
        costing: { amount: 3000, per: 1 },
      },
    ],
  };
  const sold = {
    id: 'j',
    serviceId: 's',
    quantity: '2',
    amount: 30000,
    costRates: { service: 5000, materials: {} },
  };
  assert.equal(jobCost(ledger, sold).kobo, 10000, 'the cost when sold, not today’s');
  assert.equal(jobCost(ledger, { ...sold, costRates: undefined }).kobo, 16000, 'older jobs use today’s cost');
  const material = {
    id: 'k',
    serviceId: 'x',
    materialId: 'm',
    materialNeeded: 4,
    amount: 30000,
    costRates: { service: null, materials: { m: 2000 } },
  };
  assert.equal(jobCost(ledger, material).kobo, 8000);
  const noCostThen = { ...material, costRates: { service: null, materials: { m: null } } };
  assert.equal(jobCost(ledger, noCostThen).kobo, 12000, 'a cost set after the sale still counts');
});
