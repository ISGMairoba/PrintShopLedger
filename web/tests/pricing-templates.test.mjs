import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, actor } from './pricing-fixture.mjs';
import { applyCheckout, quoteLine, prepareCheckout } from '../src/checkout.mjs';
import { prepareQuotation, applyQuotationEvent, quotationCheckout } from '../src/quotations.mjs';
import { parseFormula, evaluateFormula, validatePricingSettings } from '../src/pricing-templates.mjs';
import { eventResources } from '../src/sync-dependencies.mjs';

test('book uses retail, materialless and material services, creates one job, and deducts each stock once', () => {
  const { ledger, event } = fixture();
  assert.equal(event.data.jobs.length, 1);
  assert.equal(event.data.total, 1750000);
  assert.equal(event.data.jobs[0].productionStatus, 'Added');
  assert.deepEqual(
    event.data.jobs[0].templateSnapshot.components.map((c) => c.quantity),
    [5, 5, 110, 10],
  );
  const next = applyCheckout(ledger, event);
  assert.equal(next.jobs.length, 1);
  assert.deepEqual(
    next.materials.map((m) => m.available),
    [95, 90],
  );
  assert.equal(next.materialHistory.length, 2);
  assert.equal(next.payments[0].allocations[0].jobId, id(20));
  assert.equal(next.payments[0].allocations[0].amount, 500000);
  assert.equal(next.jobs[0].amount, 1750000);
  assert.deepEqual(applyCheckout(next, event), next);
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [100, 200],
  );
});
test('saved event replays offline with its template snapshot; service/count changes demand review', () => {
  const { ledger, event } = fixture();
  const offline = structuredClone(ledger);
  delete offline.pricing;
  assert.equal(applyCheckout(offline, event).jobs.length, 1);
  const changed = structuredClone(ledger);
  changed.services[1].price++;
  assert.throws(() => applyCheckout(changed, event), /Template price/);
  const counted = structuredClone(ledger);
  counted.materialHistory.push({
    id: id(50),
    materialId: id(4),
    action: 'material.stock_set',
    changedAt: '2026-10-13T09:00:00Z',
  });
  assert.throws(() => applyCheckout(counted, event), /stock count/);
  const later = structuredClone(applyCheckout(ledger, event));
  later.services[0].price = 1;
  later.pricing.templates[0].name = 'Changed';
  assert.equal(later.jobs[0].templateSnapshot.template.name, 'Book');
  assert.equal(later.jobs[0].templateSnapshot.components[0].unitPrice, 20000);
});
test('quotations keep template inputs/snapshot without posting stock and conversion reprices', () => {
  const { ledger, line } = fixture();
  const e = prepareQuotation(
    ledger,
    { id: id(80), customerId: id(2), lines: [line], validUntil: '2026-11-01', note: '' },
    actor,
  );
  const saved = applyQuotationEvent(ledger, e);
  assert.equal(saved.jobs.length, 0);
  assert.deepEqual(saved.materials, ledger.materials);
  assert.equal(saved.quotations[0].lines[0].templateSnapshot.components.length, 4);
  const start = quotationCheckout(saved, saved.quotations[0]);
  assert.equal(start.lines[0].templateInputs.pages, 41);
  assert.equal(start.changes.length, 0);
  const changed = structuredClone(saved);
  changed.services[1].price += 10000;
  assert.match(quotationCheckout(changed, saved.quotations[0]).changes[0], /prices changed/);
});
test('discounts apply once to the parent, leaving component stock quantities intact', () => {
  const { ledger, input } = fixture();
  input.lines[0].discount = { kind: 'percent', value: 10 };
  input.cashReceived = 0;
  const event = prepareCheckout(ledger, input, actor);
  assert.equal(event.data.total, 1575000);
  assert.deepEqual(
    applyCheckout(ledger, event).materials.map((m) => m.available),
    [95, 90],
  );
});
test('formula grammar supports chaining and rounding and rejects code, cycles, unknown variables and invalid inputs', () => {
  assert.equal(
    evaluateFormula(parseFormula('ceil(quantity / 4) * 2 + max(1, 3)'), () => 5),
    7,
  );
  for (const s of ['globalThis.alert(1)', 'constructor(1)', 'quantity ** 2', 'eval(1)', '1;2'])
    assert.throws(() => parseFormula(s));
  const { ledger, line } = fixture();
  assert.throws(
    () => quoteLine(ledger, { ...line, templateInputs: { pages: 1, pagesPerSheet: 0, coversPerCard: 2 } }),
    /range/,
  );
  const cycle = structuredClone(ledger.pricing);
  cycle.templates[0].derived[0].formula = 'sheets';
  cycle.templates[0].derived[1].formula = 'cards';
  assert.throws(() => validatePricingSettings(cycle), /Circular/);
  const unknown = structuredClone(ledger.pricing);
  unknown.templates[0].components[0].quantityFormula = 'missing';
  assert.throws(() => validatePricingSettings(unknown), /Unknown/);
  const disabled = structuredClone(ledger);
  disabled.pricing.enabled = false;
  assert.throws(() => quoteLine(disabled, line), /unavailable/);
});
test('shared materials and size-based services use the normal pricing and stock rules', () => {
  const { ledger, line } = fixture();
  ledger.services[1].materialId = id(3);
  let q = quoteLine(ledger, line);
  assert.equal(q.templateSnapshot.components[1].materialNeeded, 5);
  const next = applyCheckout(
    ledger,
    prepareCheckout(
      ledger,
      {
        customerId: id(2),
        lines: [line],
        cashReceived: 0,
        useWallet: false,
        paidOn: '2026-10-13',
        method: 'Cash',
      },
      actor,
    ),
  );
  assert.equal(next.materials[0].available, 90);
  ledger.materials[1].requireSize = true;
  const c = ledger.pricing.templates[0].components[2];
  c.widthFormula = '2';
  c.heightFormula = '0.5';
  ledger.pricing = validatePricingSettings(ledger.pricing);
  q = quoteLine(ledger, line);
  assert.equal(q.templateSnapshot.components[2].materialNeeded, 110);
});
test('held dependencies include every component service and material', () => {
  const { ledger, event } = fixture();
  const keys = eventResources(event, ledger);
  for (const n of [5, 6, 7, 8]) assert.ok(keys.has('service:' + id(n)));
  assert.ok(keys.has('material:' + id(3)));
  assert.ok(keys.has('material:' + id(4)));
});

test('optional components can use zero, and decimal formula rounding is exact', () => {
  const { ledger, line } = fixture();
  ledger.pricing.templates[0].components[0].quantityFormula = '0';
  ledger.pricing.templates[0].components[1].quantityFormula = '1.2345';
  ledger.pricing = validatePricingSettings(ledger.pricing);
  const q = quoteLine(ledger, line);
  assert.equal(q.templateSnapshot.components[0].quantity, 0);
  assert.equal(q.templateSnapshot.components[0].amount, 0);
  assert.equal(q.templateSnapshot.components[1].quantity, 1.235);
  assert.equal(
    evaluateFormula(parseFormula('0.1 + 0.2'), () => 0),
    0.3,
  );
  assert.throws(() => parseFormula('0.00000000000001'), /twelve/);
});
