import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, actor } from './pricing-fixture.mjs';
import { applyCheckout, accountToken } from '../src/checkout.mjs';
import { applySaleAdjustment } from '../src/sale-adjustments.mjs';
import { serviceChangeEvent } from '../src/service-change.mjs';

const stock = (l, n) => l.materials.find((m) => m.id === id(n)).available;
const change = (l, job, c) =>
  applySaleAdjustment(
    l,
    serviceChangeEvent(
      l,
      job,
      { reason: 'Wrong item picked', stockMode: 'reconcile', description: job.description, ...c },
      actor,
      accountToken(l, job.customerId),
      '2026-10-14T08:00:00Z',
    ),
  );

test('service change: template to template, to a normal service and back, with stock put right', () => {
  const { ledger, event } = fixture();
  let l = applyCheckout(ledger, event);
  let job = l.jobs[0];
  assert.equal(stock(l, 3), 2000 - 650);
  // Another paper: the 70gsm goes back, the 80gsm is taken; the cards stay.
  l = change(l, job, {
    target: 'template',
    serviceId: id(9),
    quantity: 50,
    templateInputs: { sheets_per_book: 25, inner_paper: 2, cover_card: 1 },
  });
  job = l.jobs[0];
  assert.equal(stock(l, 3), 2000);
  assert.equal(stock(l, 4), 2000 - 650);
  assert.equal(stock(l, 10), 100 - 53);
  assert.equal(l.saleAdjustments.at(-1).action, 'sale.service_changed');
  // To a normal service: all template stock goes back; the service's material is taken.
  l = {
    ...l,
    services: [
      ...l.services,
      {
        ...l.services[2],
        id: id(50),
        description: 'Art card print',
        shelfItem: false,
        price: 30000,
        costing: undefined,
      },
    ],
  };
  l = change(l, job, {
    target: 'service',
    serviceId: id(50),
    quantity: 5,
    unitPrice: 30000,
    materialId: id(10),
  });
  job = l.jobs[0];
  assert.equal(job.templateSnapshot, undefined);
  assert.equal(job.amount, 150000);
  assert.equal(stock(l, 4), 2000);
  assert.equal(stock(l, 10), 95);
  // The money already paid beyond the new amount is the customer's credit.
  assert.ok(l.saleAdjustments.at(-1).creditReleased > 0);
  // And back to the template.
  l = change(l, job, {
    target: 'template',
    serviceId: id(9),
    quantity: 50,
    templateInputs: { sheets_per_book: 25, inner_paper: 1, cover_card: 1 },
  });
  assert.equal(stock(l, 3), 2000 - 650);
  assert.equal(stock(l, 10), 100 - 53);
});

test('service change: refused once the materials are confirmed', () => {
  const { ledger, event } = fixture();
  let l = applyCheckout(ledger, event);
  l = { ...l, jobs: l.jobs.map((j) => ({ ...j, materialCheck: { status: 'confirmed', usages: [] } })) };
  assert.throws(
    () =>
      change(l, l.jobs[0], {
        target: 'template',
        serviceId: id(9),
        quantity: 40,
        templateInputs: { sheets_per_book: 25, inner_paper: 1, cover_card: 1 },
      }),
    /materials are confirmed/,
  );
});
