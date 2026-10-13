import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { applyCheckout, prepareCheckout } from '../src/checkout.mjs';
import { pageName, renameTerms, stageName, termDefaults, termPresets, validateTerms } from '../src/terms.mjs';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';
import { receiptModel } from '../src/receipts.mjs';

const audit = { modifiedBy: 'owner', modifiedByLabel: 'Owner', modifiedAt: '2026-10-12T12:00:00Z' };
const retail = validateTerms({ preset: 'retail' });

test('Words: presets, custom words and safe defaults', () => {
  assert.deepEqual(validateTerms(undefined), termDefaults());
  assert.equal(retail.job, 'order');
  assert.equal(retail.stages.Added, 'Order placed');
  const custom = validateTerms({ ...retail, preset: 'custom', job: ' Sale ', stages: { Added: 'Paid' } });
  assert.equal(custom.job, 'sale');
  assert.equal(custom.stages.Added, 'Paid');
  assert.equal(custom.stages.Collected, 'Collected');
  assert.equal(validateTerms({ preset: 'nonsense' }).preset, 'print');
  assert.throws(() => validateTerms({ preset: 'custom', job: '' }), /Words/);
  assert.throws(() => validateTerms({ preset: 'custom', job: 'x'.repeat(31) }), /Words/);
  assert.throws(() => validateTerms({ preset: 'custom', job: '<b>' }), /Words/);
  assert.ok(Object.keys(termPresets).includes('mixed'));
  // Older saved settings without words still load, as a print shop.
  const old = { ...defaultBranding(), businessName: 'Shop' };
  delete old.terms;
  assert.equal(validateBranding(old).terms.job, 'job');
});

test('Words: interface text is renamed with matching capitals; other words are left alone', () => {
  assert.equal(renameTerms('Add job', retail), 'Add order');
  assert.equal(renameTerms('Jobs in this checkout', retail), 'Orders in this checkout');
  assert.equal(renameTerms('Top 5 services', retail), 'Top 5 products');
  assert.equal(renameTerms('Base material', retail), 'Base stock item');
  assert.equal(renameTerms('JOB', retail), 'ORDER');
  assert.equal(renameTerms('Jobsite and serviceable', retail), 'Jobsite and serviceable');
  assert.equal(renameTerms('Add job', termDefaults()), 'Add job');
  assert.equal(stageName('Added', retail), 'Order placed');
  assert.equal(stageName('Printing', retail), 'Printing');
  assert.equal(pageName('Jobs', retail), 'Orders');
  assert.equal(pageName('Material Waste', retail), 'Stock item Waste');
  assert.equal(pageName('Point of Service', retail), 'Point of Service');
});

const shop = () => {
  let ledger = emptyLedger();
  ledger = applyEvent(ledger, {
    id: 'm1',
    kind: 'material.created',
    data: { id: 'pen', name: 'Pen', measurementUnit: 'piece', available: 10, requireSize: false, ...audit },
  });
  ledger = applyEvent(ledger, {
    id: 's1',
    kind: 'service.created',
    data: { id: 'pen-sale', description: 'Pen', materialId: 'pen', price: 50000, shelfItem: true, ...audit },
  });
  ledger = applyEvent(ledger, {
    id: 's2',
    kind: 'service.created',
    data: { id: 'print', description: 'Printing', materialId: null, price: 10000, ...audit },
  });
  ledger = applyEvent(ledger, {
    id: 'c1',
    kind: 'customer.created',
    data: { id: 'ada', name: 'Ada', phone: '08011111111', address: '', creditLimit: 0, ...audit },
  });
  return ledger;
};
const sale = (ledger) =>
  prepareCheckout(
    ledger,
    {
      customerId: 'ada',
      lines: [
        {
          id: 'j1',
          serviceId: 'pen-sale',
          description: 'Pen',
          quantity: '3',
          source: 'In shop / USB',
          dueAt: '2026-10-20T12:00:00Z',
        },
        {
          id: 'j2',
          serviceId: 'print',
          description: 'Flyer',
          quantity: '1',
          source: 'In shop / USB',
          dueAt: '2026-10-20T12:00:00Z',
        },
      ],
      cashReceived: 160000,
      useWallet: true,
      method: 'Cash',
      paidOn: '2026-10-12',
      reference: '',
    },
    { id: 'owner', label: 'Owner' },
    'sale-1',
    '2026-10-12T12:00:00Z',
  );

test('Shelf items are Collected at checkout, without a deadline, and take stock', () => {
  const ledger = shop();
  assert.equal(ledger.services.find((s) => s.id === 'pen-sale').shelfItem, true);
  assert.equal(ledger.services.find((s) => s.id === 'print').shelfItem, false);
  const event = sale(ledger);
  const [pen, flyer] = event.data.jobs;
  assert.deepEqual([pen.productionStatus, pen.shelfItem, pen.dueAt], ['Collected', true, undefined]);
  assert.deepEqual(
    [flyer.productionStatus, flyer.shelfItem, flyer.dueAt],
    ['Added', undefined, '2026-10-20T12:00:00.000Z'],
  );
  const after = applyCheckout(ledger, event);
  assert.equal(after.materials.find((m) => m.id === 'pen').available, 7);
  assert.equal(after.jobs.find((j) => j.id === 'j1').productionStatus, 'Collected');
});

test('Editing a service keeps or changes its shelf setting; bad values are refused', () => {
  let ledger = shop();
  const update = (values, id) =>
    applyEvent(ledger, {
      id,
      kind: 'service.updated',
      data: {
        id: 'pen-sale',
        baseVersion: ledger.services[0].version,
        description: 'Pen',
        materialId: 'pen',
        price: 50000,
        ...audit,
        ...values,
      },
    });
  ledger = update({}, 'u1');
  assert.equal(ledger.services[0].shelfItem, true, 'older apps that do not send the flag keep it');
  ledger = update({ shelfItem: false }, 'u2');
  assert.equal(ledger.services[0].shelfItem, false);
  assert.throws(() => update({ shelfItem: 'yes' }, 'u3'), /off the shelf/);
});

test('A new product is a stock item plus its shelf item, saved together', () => {
  let ledger = emptyLedger();
  for (const event of [
    {
      id: 'p1',
      kind: 'material.created',
      data: {
        id: 'mug',
        name: 'Mug',
        measurementUnit: 'piece',
        available: 24,
        requireSize: false,
        minimumStock: 5,
        reason: 'Opening stock',
        ...audit,
      },
    },
    {
      id: 'p2',
      kind: 'service.created',
      data: {
        id: 'mug-sale',
        description: 'Mug',
        materialId: 'mug',
        price: 300000,
        shelfItem: true,
        ...audit,
      },
    },
  ])
    ledger = applyEvent(ledger, event);
  assert.equal(ledger.materials[0].available, 24);
  assert.deepEqual([ledger.services[0].materialId, ledger.services[0].shelfItem], ['mug', true]);
});

test('Receipts use the business words for their item lines', () => {
  const ledger = shop();
  const record = applyCheckout(ledger, sale(ledger)).checkouts[0];
  const business = { ...defaultBranding(), businessName: 'Shop', terms: retail };
  const m = receiptModel(record, business);
  assert.equal(m.itemHeading, 'Order');
  assert.ok(m.totals.some((t) => t.label === 'New orders'));
  assert.equal(receiptModel(record, { ...defaultBranding(), businessName: 'Shop' }).itemHeading, 'Job');
});

test('Words keep fixed names: Point of Service and printer jobs', () => {
  assert.equal(
    renameTerms('Open Point of Service to add a job', retail),
    'Open Point of Service to add an order',
  );
  assert.equal(renameTerms('QZ Tray sends print jobs', retail), 'QZ Tray sends print jobs');
});

test('Articles follow the new word', () => {
  assert.equal(renameTerms('Add a job, then an item', retail), 'Add an order, then an item');
  assert.equal(renameTerms('A material is low', retail), 'A stock item is low');
  assert.equal(renameTerms('An item', retail), 'An item');
  assert.equal(renameTerms('Add a job', termDefaults()), 'Add a job');
});
