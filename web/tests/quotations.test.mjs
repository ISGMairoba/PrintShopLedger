import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import {
  defaultValidUntil,
  prepareQuotation,
  priceQuotation,
  quotationCheckout,
  quotationModel,
  quotationRef,
  quotationState,
} from '../src/quotations.mjs';
import { eventResources } from '../src/sync-dependencies.mjs';
import { canAccessPage, navigationPages } from '../src/page-access.mjs';
import { defaultBranding } from '../src/business-branding.mjs';

const audit = { modifiedBy: 'owner', modifiedByLabel: 'Owner', modifiedAt: '2026-10-13T09:00:00Z' };
const actor = { id: 'owner', label: 'Owner' };
const shop = () => {
  let ledger = emptyLedger();
  for (const event of [
    {
      id: 'm',
      kind: 'material.created',
      data: { id: 'flex', name: 'Flex', measurementUnit: 'sqm', available: 50, requireSize: true, ...audit },
    },
    {
      id: 's1',
      kind: 'service.created',
      data: { id: 'banner', description: 'Banner', materialId: 'flex', price: 300000, ...audit },
    },
    {
      id: 's2',
      kind: 'service.created',
      data: { id: 'design', description: 'Design', materialId: null, price: 1000000, ...audit },
    },
    {
      id: 'c',
      kind: 'customer.created',
      data: { id: 'ada', name: 'Ada', phone: '08011111111', address: '', creditLimit: 0, ...audit },
    },
  ])
    ledger = applyEvent(ledger, event);
  return ledger;
};
const lines = [
  { id: 'l1', serviceId: 'banner', description: 'Shop banner', quantity: '2', width: '2', height: '1.5' },
  {
    id: 'l2',
    serviceId: 'design',
    description: 'Artwork',
    quantity: '1',
    discount: { kind: 'percent', value: 10 },
  },
];

test('Quotation prices use the checkout rules: size, quantity and discounts', () => {
  const p = priceQuotation(shop(), lines, { kind: 'amount', value: 100000, reason: 'Bulk' });
  // Banner: 2 × 2 × 1.5 sqm × ₦3,000 = ₦18,000. Design: ₦10,000 less 10% = ₦9,000.
  assert.equal(p.lines[0].grossAmount, 1800000);
  assert.equal(p.lines[1].lineDiscount, 100000);
  assert.equal(p.subtotal, 2800000);
  assert.equal(p.discountTotal, 100000 + 100000);
  assert.equal(p.total, 2600000);
  assert.equal(
    p.lines.reduce((n, l) => n + l.amount, 0),
    p.total,
  );
  assert.throws(() => priceQuotation(shop(), []), /1 to 50/);
  assert.throws(
    () => priceQuotation(shop(), lines, { kind: 'amount', value: 100 }, { maxPercent: 20, canFlat: false }),
    /Admins/,
  );
});

test('Saving, editing, converting and archiving a quotation', () => {
  let ledger = shop();
  const event = prepareQuotation(
    ledger,
    { customerId: 'ada', lines, validUntil: '2026-10-27', note: 'Proof by Friday' },
    actor,
    null,
    '2026-10-13T09:00:00Z',
  );
  assert.equal(event.kind, 'quotation.saved');
  assert.equal(event.data.customerName, 'Ada');
  ledger = applyEvent(ledger, event);
  let q = ledger.quotations[0];
  assert.deepEqual([q.status, q.version, q.total], ['open', 1, 2700000]);
  assert.equal(quotationRef(q.id), 'Q-' + q.id.replace(/-/g, '').slice(0, 8).toUpperCase());
  // Edit in place.
  ledger = applyEvent(
    ledger,
    prepareQuotation(
      ledger,
      { id: q.id, baseVersion: 1, customerId: 'ada', lines: [lines[1]], validUntil: '2026-10-30', note: '' },
      actor,
    ),
  );
  q = ledger.quotations[0];
  assert.deepEqual(
    [ledger.quotations.length, q.version, q.total, q.validUntil],
    [1, 2, 900000, '2026-10-30'],
  );
  // Same event twice is ignored.
  const convert = {
    id: 'conv',
    kind: 'quotation.converted',
    data: { id: q.id, checkoutId: 'sale-1', ...audit },
  };
  ledger = applyEvent(applyEvent(ledger, convert), convert);
  q = ledger.quotations[0];
  assert.deepEqual([q.status, q.checkoutId, q.version], ['converted', 'sale-1', 3]);
  // Archiving a converted quotation keeps it converted.
  ledger = applyEvent(ledger, { id: 'arch', kind: 'quotation.archived', data: { id: q.id, ...audit } });
  assert.equal(ledger.quotations[0].status, 'converted');
});

test('A quotation can be for someone who is not a saved customer', () => {
  const event = prepareQuotation(
    shop(),
    { customerName: ' Walk-in Bello ', customerPhone: '0809', lines, validUntil: '2026-10-27', note: '' },
    actor,
  );
  assert.deepEqual([event.data.customerId, event.data.customerName], [null, 'Walk-in Bello']);
  assert.throws(
    () => prepareQuotation(shop(), { customerName: '', lines, validUntil: '2026-10-27' }, actor),
    /customer/,
  );
  assert.throws(
    () => prepareQuotation(shop(), { customerName: 'X', lines, validUntil: 'soon' }, actor),
    /valid until/,
  );
});

test('Open quotations expire after their date; the default is two weeks', () => {
  assert.equal(defaultValidUntil('2026-10-13T09:00:00Z'), '2026-10-27');
  const q = { status: 'open', validUntil: '2026-10-20' };
  assert.equal(quotationState(q, '2026-10-20T20:00:00Z'), 'open');
  assert.equal(quotationState(q, '2026-10-21T09:00:00Z'), 'expired');
  assert.equal(quotationState({ ...q, status: 'converted' }, '2027-01-01T00:00:00Z'), 'converted');
});

test('Create order starts checkout from the quote and lists price changes', () => {
  let ledger = shop();
  ledger = applyEvent(
    ledger,
    prepareQuotation(
      ledger,
      { customerName: 'Ada', customerPhone: '08011111111', lines, validUntil: '2026-10-27', note: '' },
      actor,
    ),
  );
  ledger = applyEvent(ledger, {
    id: 'price',
    kind: 'service.updated',
    data: { id: 'design', baseVersion: 1, description: 'Design', materialId: null, price: 1200000, ...audit },
  });
  const start = quotationCheckout(ledger, ledger.quotations[0]);
  assert.equal(start.customerId, 'ada', 'matched by phone to the saved customer');
  assert.deepEqual(start.lines[0], {
    serviceId: 'banner',
    description: 'Shop banner',
    quantity: 2,
    width: 2,
    height: 1.5,
  });
  assert.equal(start.changes.length, 1);
  assert.match(start.changes[0], /Artwork: price changed from ₦10,000\.00 to ₦12,000\.00/);
});

test('The quotation document reads clearly and prints on receipt printers', () => {
  let ledger = shop();
  ledger = applyEvent(
    ledger,
    prepareQuotation(
      ledger,
      { customerId: 'ada', lines, validUntil: '2026-10-27', note: 'Thanks' },
      actor,
      null,
      '2026-10-13T09:00:00Z',
    ),
  );
  const m = quotationModel(
    ledger.quotations[0],
    { ...defaultBranding(), businessName: 'Shop' },
    'page',
    '2026-10-13T10:00:00Z',
  );
  assert.equal(m.title, 'Quotation');
  assert.ok(m.meta.some(([k]) => k === 'Valid until'));
  assert.deepEqual(
    m.totals.map((t) => t.label),
    ['Subtotal', 'Discount', 'Total'],
  );
  assert.ok(m.items[1].meta.includes('Discount 10% -₦1,000.00'));
  assert.ok(!JSON.stringify(m).includes('−'));
  assert.match(m.footer, /valid until 27 Oct 2026/);
  const expired = quotationModel(ledger.quotations[0], 'Shop', 'roll', '2026-11-01T10:00:00Z');
  assert.match(expired.notices[0], /expired/);
});

test('Quotations sync on their own and follow Point of Service access', () => {
  const keys = eventResources({ id: 'e', kind: 'quotation.saved', data: { id: 'q1' } }, emptyLedger());
  assert.deepEqual([...keys], ['quotation:q1']);
  assert.ok(navigationPages.indexOf('Quotations') === navigationPages.indexOf('Point of Service') + 1);
  assert.equal(canAccessPage('Quotations', 1), true);
  assert.equal(
    canAccessPage('Quotations', 1, { 1: ['My Account'], 2: ['My Account'], 3: ['My Account'] }),
    false,
  );
});
