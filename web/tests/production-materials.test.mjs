import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
import { extraMaterialsEvent, extraMaterialsCost, validProduction } from '../src/production-materials.mjs';

const actor = { id: 'u', label: 'Ada' };
const at = '2026-11-07T09:00:00Z';
const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: at };
const id = () => crypto.randomUUID();

function shop() {
  let ledger = emptyLedger();
  const apply = (kind, data) => {
    ledger = applyEvent(ledger, { id: id(), kind, data: { ...data, ...audit } });
    return data.id;
  };
  const material = (name, available) =>
    apply('material.created', {
      id: id(),
      name,
      available,
      measurementUnit: 'sheet',
      requireSize: false,
      minimumStock: 0,
      reason: 'Opening',
    });
  const film = material('Lamination film (A4 units)', 100);
  const fbb = material('FBB board', 50);
  const glue = material('Glue', 10);
  const a2 = apply('service.created', {
    id: id(),
    description: 'A2 lamination',
    materialId: film,
    price: 80000,
    production: { perItem: 4 },
  });
  const bag = apply('service.created', {
    id: id(),
    description: 'Paper bag',
    materialId: null,
    price: 150000,
    production: { extraMaterials: true },
  });
  apply('service.created', {
    id: id(),
    description: 'FBB cost',
    materialId: fbb,
    price: 0,
    private: true,
    costing: { key: 'fbb', amount: 30000, per: 1 },
  });
  const customer = apply('customer.created', {
    id: id(),
    name: 'Bello',
    phone: '0801',
    address: '',
    creditLimit: 0,
  });
  return { get: () => ledger, set: (l) => (ledger = l), film, fbb, glue, a2, bag, customer };
}
const sell = (s, serviceId, quantity) => {
  const line = {
    id: id(),
    serviceId,
    description: 'Job',
    quantity: String(quantity),
    source: 'In shop / USB',
    sourceNote: '',
  };
  const event = prepareCheckout(
    s.get(),
    {
      customerId: s.customer,
      lines: [line],
      cashReceived: 0,
      useWallet: false,
      paidOn: '2026-11-07',
      method: 'Cash',
      reference: '',
    },
    actor,
    id(),
    at,
  );
  s.set(applyEvent(s.get(), event));
  return s.get().jobs.find((j) => j.id === line.id);
};
const stock = (s, mid) => s.get().materials.find((m) => m.id === mid).available;

test('a service can use several units of its material per item (A2 lamination = 4 A4 units)', () => {
  const s = shop();
  const job = sell(s, s.a2, 3);
  assert.equal(job.materialNeeded, 12);
  assert.equal(job.amount, 240000, 'The price is per item, not per unit of material');
  assert.equal(stock(s, s.film), 88);
});

test('materials can be added in production, corrected and returned; stock moves by the difference', () => {
  const s = shop();
  const job = sell(s, s.bag, 100);
  let event = extraMaterialsEvent(
    s.get(),
    job,
    [
      { materialId: s.fbb, quantity: 25 },
      { materialId: s.glue, quantity: 1.5 },
    ],
    actor,
  );
  s.set(applyEvent(s.get(), event));
  let after = s.get().jobs.find((j) => j.id === job.id);
  assert.deepEqual(after.extraMaterials.usages, [
    { materialId: s.fbb, quantity: 25 },
    { materialId: s.glue, quantity: 1.5 },
  ]);
  assert.equal(stock(s, s.fbb), 25);
  assert.equal(stock(s, s.glue), 8.5);
  assert.equal(after.amount, 150000 * 100, 'The price does not change');
  // 25 sheets of FBB at ₦300 each (from its cost); glue has no cost set.
  assert.deepEqual(extraMaterialsCost(s.get(), after.extraMaterials.usages), {
    kobo: 750000,
    unpriced: [s.glue],
  });
  // Correct FBB to 20 (5 back to stock), leave glue alone.
  event = extraMaterialsEvent(s.get(), after, [{ materialId: s.fbb, quantity: 20 }], actor);
  s.set(applyEvent(s.get(), event));
  after = s.get().jobs.find((j) => j.id === job.id);
  assert.equal(stock(s, s.fbb), 30);
  assert.equal(after.extraMaterials.usages.length, 2);
  const history = s.get().materialHistory.filter((h) => h.jobId === job.id);
  assert.deepEqual(
    history.map((h) => h.action),
    ['material.job_used', 'material.job_used', 'material.job_corrected'],
  );
});

test('only services set to accept them take added materials, and never their own material', () => {
  const s = shop();
  const lam = sell(s, s.a2, 1);
  assert.throws(
    () => extraMaterialsEvent(s.get(), lam, [{ materialId: s.glue, quantity: 1 }], actor),
    /does not take added materials/,
  );
  const bag = sell(s, s.bag, 1);
  assert.throws(
    () => extraMaterialsEvent(s.get(), bag, [{ materialId: s.glue, quantity: -1 }], actor),
    /how much/,
  );
  assert.throws(
    () =>
      extraMaterialsEvent(
        s.get(),
        bag,
        [
          { materialId: s.glue, quantity: 1 },
          { materialId: s.glue, quantity: 2 },
        ],
        actor,
      ),
    /once/,
  );
});

test('production settings keep only what differs from the defaults', () => {
  assert.deepEqual(validProduction({ extraMaterials: false, costCovered: true, perItem: 1 }), {});
  assert.deepEqual(validProduction({ extraMaterials: true, costCovered: true, perItem: 4 }), {
    extraMaterials: true,
    costCovered: true,
    perItem: 4,
  });
  assert.equal(validProduction(undefined), undefined);
  assert.throws(() => validProduction({ perItem: 0 }));
  assert.throws(() => validProduction({ perItem: 1.0005 }));
  assert.throws(() => validProduction({ other: true }));
});
