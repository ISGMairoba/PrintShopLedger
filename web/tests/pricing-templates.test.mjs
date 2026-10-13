import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, actor, bookTemplate } from './pricing-fixture.mjs';
import { applyCheckout, quoteLine, prepareCheckout } from '../src/checkout.mjs';
import { prepareQuotation, applyQuotationEvent, quotationCheckout } from '../src/quotations.mjs';
import {
  FieldError,
  canonical,
  clientSpecs,
  discountCeiling,
  evaluate,
  expenseControls,
  formulaFromControls,
  parseFormula,
  policyDiscountLimit,
  priceTemplate,
  scenarioInputs,
  suggestCostKey,
  templateProblem,
  validCosting,
  validatePricingSettings,
  validateTemplate,
} from '../src/pricing-templates.mjs';
import { applyServiceEvent } from '../src/services.mjs';
import { shelfProducts } from '../src/quick-sale.mjs';
import { eventResources } from '../src/sync-dependencies.mjs';

const value = (f, names = {}) =>
  canonical(
    evaluate(parseFormula(f), (n) => {
      if (!(n in names)) throw Error('Unknown ' + n);
      return names[n];
    }),
  );

test("Costora's T-shirt sample prices the same: ₦160,000 cost, ₦208,000 price, 7.69% discount limit", () => {
  const { ledger } = fixture();
  const svc = (n, key, amount) => ({
    id: id(n),
    description: key,
    materialId: null,
    price: 0,
    archived: false,
    version: 1,
    costing: { key, amount, per: 1 },
  });
  ledger.services = [
    svc(41, 'shirt_cost', 200000),
    svc(42, 'dtf_rate', 160000),
    svc(43, 'heat_rate', 10000),
    svc(44, 'design_fee', 500000),
    svc(45, 'delivery_fee', 300000),
  ];
  const t = validateTemplate({
    id: id(40),
    version: 1,
    archived: false,
    name: 'Custom T-shirt printing',
    variables: [
      { key: 'quantity', label: 'Quantity', kind: 'number', default: 50, min: 1, max: 100000, integer: true },
      {
        key: 'areas',
        label: 'Print areas per shirt',
        kind: 'number',
        default: 2,
        min: 1,
        max: 6,
        integer: true,
      },
      {
        key: 'a4_ratio',
        label: 'A4 ratio per print area',
        kind: 'number',
        default: 0.25,
        min: 0.01,
        max: 10,
      },
      { key: 'delivery', label: 'Delivery required', kind: 'yesno', default: 1 },
    ],
    computed: [],
    expenses: [
      { key: 'garments', label: 'Garments', formula: 'quantity * shirt_cost' },
      { key: 'printing', label: 'DTF printing', formula: 'quantity * areas * a4_ratio * dtf_rate' },
      { key: 'heating', label: 'Heating', formula: 'quantity * areas * heat_rate' },
      { key: 'design', label: 'Design', formula: 'design_fee' },
      { key: 'transport', label: 'Delivery', formula: 'IF(delivery, delivery_fee, 0)' },
      { key: 'misc', label: 'Order preparation', formula: '2000' },
    ],
    pricing: { method: 'markup', rate: 30, floor: 20, maxDiscount: 10, rounding: 1 },
  });
  const s = priceTemplate(ledger, t, { areas: 2, a4_ratio: 0.25, delivery: 1 }, 50);
  assert.equal(s.price.cost, '160000');
  assert.equal(s.price.amount, 20800000);
  assert.equal(s.price.minimum, 19200000);
  assert.equal(policyDiscountLimit(t.pricing), 7.69);
  assert.equal(discountCeiling(t.pricing), 7.69);
  // Margin divides instead: 30% margin on 157,000 (no delivery) is 224,285.71, rounded up to ₦100.
  const margin = { ...t, pricing: { ...t.pricing, method: 'margin', rounding: 100 } };
  assert.equal(
    priceTemplate(ledger, margin, { areas: 2, a4_ratio: 0.25, delivery: 0 }, 50).price.amount,
    22430000,
  );
});

test('book: computed quantities, costs from items, markup, rounding and stock for the chosen paper', () => {
  const { ledger, event, line } = fixture();
  const job = event.data.jobs[0];
  const s = job.templateSnapshot;
  assert.deepEqual(
    s.outputs.map((o) => o.value),
    ['650', '53'],
  );
  assert.deepEqual(
    s.expenses.map((e) => e.amount),
    ['6500', '10600', '5000'],
  );
  assert.equal(s.price.cost, '22100');
  assert.equal(s.price.raw, '28730');
  assert.equal(job.amount, 2880000); // rounded up to ₦100
  assert.equal(job.unitPrice, 57600);
  assert.equal(s.price.minimum, 2652000);
  assert.deepEqual(
    s.references.map((r) => [r.key, r.rate]),
    [
      ['art_card', '200'],
      ['binding', '100'],
      ['paper_70', '10'],
    ],
  );
  assert.deepEqual(
    s.stock.map((x) => [x.name, x.quantity, x.stockEventId]),
    [
      ['Paper 70gsm', 650, id(30)],
      ['Art card', 53, id(31)],
    ],
  );
  const next = applyCheckout(ledger, event);
  assert.deepEqual(
    next.materials.map((m) => m.available),
    [1350, 2000, 47],
  );
  assert.equal(next.materialHistory.length, 2);
  assert.equal(next.jobs[0].amount, 2880000);
  assert.deepEqual(applyCheckout(next, event), next);
  // Choosing 80 gsm costs 13 a sheet and takes from the other paper.
  const heavy = quoteLine(ledger, {
    ...event.data.jobs[0],
    templateInputs: { sheets_per_book: 25, inner_paper: 2, cover_card: 1 },
    templateSnapshot: undefined,
    templateStockIds: line.templateStockIds,
  });
  assert.equal(heavy.templateSnapshot.expenses[0].amount, '8450');
  assert.equal(heavy.templateSnapshot.stock[0].materialId, id(4));
  assert.equal(heavy.templateSnapshot.stock[0].stockEventId, id(32));
});

test('client view shows only client-visible variables; never costs', () => {
  const { event } = fixture();
  const specs = clientSpecs(event.data.jobs[0].templateSnapshot, 50);
  assert.deepEqual(specs, [
    { label: 'Number of books', value: '50 books' },
    { label: 'Sheets per book', value: '25 sheets' },
    { label: 'Inner paper', value: '70 gsm paper' },
  ]);
  assert.ok(!JSON.stringify(specs).includes('Art card'));
});

test('a saved order replays offline from its snapshot; changed costs or counts need review', () => {
  const { ledger, event } = fixture();
  const offline = structuredClone(ledger);
  delete offline.pricing;
  assert.equal(applyCheckout(offline, event).jobs.length, 1);
  const changed = structuredClone(ledger);
  changed.services[0].costing.amount = 550000;
  changed.services[0].version = 2;
  assert.throws(() => applyCheckout(changed, event), /Template price/);
  const counted = structuredClone(ledger);
  counted.materialHistory.push({
    id: id(50),
    materialId: id(3),
    action: 'material.stock_set',
    changedAt: '2026-10-13T09:00:00Z',
  });
  assert.throws(() => applyCheckout(counted, event), /stock count|Template price/);
  const later = structuredClone(applyCheckout(ledger, event));
  later.pricing.templates[0].name = 'Changed';
  assert.equal(later.jobs[0].templateSnapshot.template.name, 'Books');
});

test('discounts: at most the template maximum, and never below the minimum profit', () => {
  const { ledger, input } = fixture();
  input.cashReceived = 0;
  input.lines[0].discount = { kind: 'percent', value: 5 };
  assert.equal(prepareCheckout(ledger, input, actor).data.total, 2736000);
  input.lines[0].discount = { kind: 'percent', value: 6 };
  assert.throws(() => prepareCheckout(ledger, input, actor), /most discount allowed on Books is 5%/);
  const generous = structuredClone(ledger);
  generous.pricing.templates[0].pricing.maxDiscount = 20;
  input.lines[0].discount = { kind: 'percent', value: 9 };
  assert.throws(() => prepareCheckout(generous, input, actor), /below its minimum 20% markup/);
  input.lines[0].discount = { kind: 'percent', value: 7 };
  assert.equal(prepareCheckout(generous, input, actor).data.total, 2678400);
  // An order discount shared onto the template line is held to the same limits.
  input.lines[0].discount = undefined;
  input.orderDiscount = { kind: 'percent', value: 10 };
  assert.throws(() => prepareCheckout(generous, input, actor), /below its minimum/);
});

test('quotations keep the snapshot, move no stock, and conversion notices cost changes', () => {
  const { ledger, line } = fixture();
  const e = prepareQuotation(
    ledger,
    { id: id(80), customerId: id(2), lines: [line], validUntil: '2026-11-01', note: '' },
    actor,
  );
  const saved = applyQuotationEvent(ledger, e);
  assert.equal(saved.jobs.length, 0);
  assert.deepEqual(saved.materials, ledger.materials);
  assert.equal(saved.quotations[0].lines[0].amount, 2880000);
  const start = quotationCheckout(saved, saved.quotations[0]);
  assert.equal(start.lines[0].templateInputs.sheets_per_book, 25);
  assert.equal(start.changes.length, 0);
  const changed = structuredClone(saved);
  changed.services[3].costing.amount = 20000;
  changed.services[3].version = 2;
  assert.match(quotationCheckout(changed, saved.quotations[0]).changes[0], /costs changed/);
});

test('formula grammar: Costora functions, comparisons, IF only evaluates its branch, exact decimals', () => {
  assert.equal(value('CEILING(7, 5)'), '10');
  assert.equal(value('FLOOR(7.9)'), '7');
  assert.equal(value('ROUND(2.5, 0) + ROUND(-2.5, 0)'), '0');
  assert.equal(value('ROUNDUP(2.01, 1)'), '2.1');
  assert.equal(value('ROUND(1234, -2)'), '1200');
  assert.equal(value('SUM(1, 2, 3) * MAX(1, 4, 2) - MIN(5, 3)'), '21');
  assert.equal(value('ABS(-3) + (2 > 1) + (2 == 2) + (1 != 1)'), '5');
  assert.equal(value('IF(0, 1 / 0, 4)'), '4');
  assert.equal(value('0.1 + 0.2'), '0.3');
  assert.equal(value('-2 * 3'), '-6');
  assert.equal(value('if(1, 2, 3)'), '2'); // function names are not case sensitive
  // Leftovers from repeating decimals never push a rounding step up.
  assert.equal(value('CEILING(2 / 3 * 3)'), '2');
  assert.equal(value('2 / 3 * 3 == 2'), '1');
  for (const s of [
    'globalThis.alert(1)',
    'constructor(1)',
    'quantity ** 2',
    'eval(1)',
    '1;2',
    'Quantity',
    'MAX(1)',
    'IF(1,2)',
  ])
    assert.throws(() => parseFormula(s), s);
  assert.throws(() => value('1 / 0'), /divides by zero/);
  assert.throws(() => value('CEILING(5, 0)'), /step/);
  assert.throws(() => value('ROUND(1, 0.5)'), /whole number/);
  assert.throws(() => value('1000000000000 * 2'), /limits/);
});

test('templates reject cycles, duplicate or reserved names, bad options and mismatched methods', () => {
  const t = bookTemplate();
  const bad = (change, pattern) => {
    const x = structuredClone(t);
    change(x);
    assert.throws(() => validateTemplate(x), pattern);
  };
  bad((x) => {
    x.computed[0].formula = 'cards_required';
    x.computed[1].formula = 'paper_required';
  }, /Circular/);
  bad((x) => (x.expenses[0].key = 'quantity'), /used twice/);
  bad((x) => (x.computed[0].key = 'inner_paper_rate'), /used twice/);
  bad((x) => (x.expenses[0].key = 'max'), /function name/);
  bad((x) => (x.variables[0].kind = 'options'), /Quantity must stay a number/);
  bad((x) => x.variables.splice(0, 1), /quantity/);
  bad(
    (x) => (x.variables[2].options[1].serviceId = x.variables[2].options[0].serviceId),
    /different costed item/,
  );
  bad((x) => (x.variables[1].default = 900), /default/);
  bad((x) => (x.expenses[0].calculation.input = 'cards_required'), /does not match/);
  bad((x) => (x.pricing.floor = 40), /Minimum profit rate/);
  bad((x) => Object.assign(x.pricing, { method: 'margin', rate: 100 }), /Profit rate/);
  bad((x) => (x.pricing.rounding = 0), /Round prices/);
  // Saved templates come back unchanged when checked again.
  const once = validateTemplate(t);
  assert.deepEqual(validateTemplate(structuredClone(once)), once);
  assert.throws(
    () => validatePricingSettings({ enabled: true, templates: [t, { ...t, id: id(70) }] }),
    /different name/,
  );
});

test('inputs are checked per field, and unknown costs are reported', () => {
  const { ledger, line } = fixture();
  const t = ledger.pricing.templates[0];
  assert.throws(
    () => priceTemplate(ledger, t, { sheets_per_book: 0, inner_paper: 1, cover_card: 1 }, 50),
    (e) => e instanceof FieldError && e.field === 'sheets_per_book' && /from 1 to 500/.test(e.message),
  );
  assert.throws(
    () => priceTemplate(ledger, t, { sheets_per_book: 2.5, inner_paper: 1, cover_card: 1 }, 50),
    (e) => e.field === 'sheets_per_book' && /whole number/.test(e.message),
  );
  assert.throws(
    () => priceTemplate(ledger, t, { sheets_per_book: 25, inner_paper: 3, cover_card: 1 }, 50),
    /from 1 to 2/,
  );
  assert.throws(
    () => priceTemplate(ledger, t, {}, 0),
    (e) => e.field === 'quantity',
  );
  assert.throws(() => priceTemplate(ledger, t, { other: 1 }, 50), /changed/);
  const missing = structuredClone(ledger);
  missing.services = missing.services.filter((s) => s.costing.key !== 'binding');
  assert.match(templateProblem(missing, t), /Unknown value "binding"/);
  assert.equal(templateProblem(ledger, t), '');
  const disabled = structuredClone(ledger);
  disabled.pricing.enabled = false;
  assert.throws(() => quoteLine(disabled, line), /unavailable/);
});

test('private items are for templates only; formula names are unique', () => {
  const { ledger, input } = fixture();
  input.lines = [
    { id: id(60), serviceId: id(8), description: 'Labour', quantity: 1, source: 'In shop / USB' },
  ];
  assert.throws(() => prepareCheckout(ledger, input, actor), /templates only/);
  ledger.services[2].private = true;
  assert.equal(shelfProducts(ledger).length, 0);
  const audit = { modifiedBy: id(1), modifiedByLabel: 'Template tester', modifiedAt: '2026-10-13T08:00:00Z' };
  const create = (n, costing, extra = {}) =>
    applyServiceEvent(ledger, {
      id: id(n),
      kind: 'service.created',
      data: { id: id(n + 1), description: 'Plate', materialId: null, price: 0, costing, ...extra, ...audit },
    });
  assert.throws(() => create(61, { key: 'binding', amount: 100, per: 1 }), /already used/);
  assert.throws(() => create(63, { key: 'Plate', amount: 100, per: 1 }), /Formula name/);
  assert.throws(() => create(65, null, { private: true }), /needs a template cost/);
  const next = create(67, { key: 'plate', amount: 300000, per: 4, unit: 'pack' }, { private: true });
  assert.deepEqual(next.services.at(-1).costing, { key: 'plate', amount: 300000, per: 4, unit: 'pack' });
  assert.equal(next.services.at(-1).private, true);
  assert.equal(suggestCostKey('Art card', ledger.services), 'art_card_2');
  assert.equal(suggestCostKey('300gsm Card!', ledger.services), 'gsm_card');
  assert.throws(() => validCosting({ key: 'quantity', amount: 1, per: 1 }), /Formula name/);
  assert.throws(() => validCosting({ key: 'sum', amount: 1, per: 1 }), /Formula name/);
});

test('held dependencies include every cost item and stock material', () => {
  const { ledger, event } = fixture();
  const keys = eventResources(event, ledger);
  for (const n of [5, 7, 8]) assert.ok(keys.has('service:' + id(n)), String(n));
  assert.ok(keys.has('material:' + id(3)));
  assert.ok(keys.has('material:' + id(10)));
});

test('expense methods match Costora and comparisons combine options', () => {
  const keys = ['quantity', 'areas'];
  for (const c of [
    { method: 'fixed', rate: '5000' },
    { method: 'perItem', rate: '100' },
    { method: 'perInput', rate: '100', input: 'areas' },
    { method: 'orderInput', rate: '40', input: 'areas' },
    { method: 'batch', rate: '5000', capacity: '25' },
  ]) {
    const controls = { input: 'quantity', capacity: '25', ...c };
    const back = expenseControls(formulaFromControls(controls), keys);
    assert.equal(back.method, c.method);
    assert.equal(back.rate, c.rate);
  }
  assert.equal(expenseControls('quantity * areas + 1', keys).method, 'custom');
  const t = validateTemplate(bookTemplate());
  const rows = scenarioInputs(
    t,
    { quantity: 50, sheets_per_book: 25, inner_paper: 1, cover_card: 1 },
    { quantity: ['10', '20', '20', '50'], inner_paper: ['1', '2'] },
  );
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[1], { quantity: 10, sheets_per_book: 25, inner_paper: 2, cover_card: 1 });
  assert.throws(
    () =>
      scenarioInputs(
        t,
        {},
        {
          quantity: Array.from({ length: 11 }, (_, i) => String(i + 1)),
          sheets_per_book: Array.from({ length: 10 }, (_, i) => String(i + 1)),
        },
      ),
    /100/,
  );
});
