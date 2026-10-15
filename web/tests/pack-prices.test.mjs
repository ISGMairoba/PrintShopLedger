import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { prepareCheckout, quoteLine } from '../src/checkout.mjs';
import { packBreakdown, packSummary, packTotal, validPackPrices } from '../src/pack-prices.mjs';
import { quickSaleInput } from '../src/quick-sale.mjs';
import { productEditEvents } from '../src/product-edit.mjs';

// The shop's price list: ₦100 each, 25 for ₦1,500, 50 for ₦3,000, 100 for ₦5,500.
const packs = [
  { quantity: 25, price: 150000 },
  { quantity: 50, price: 300000 },
  { quantity: 100, price: 550000 },
];

test('Packs plus loose pieces: largest pack first, then smaller packs, then single pieces', () => {
  const price = (q) => packTotal(10000, packs, q);
  assert.equal(price(1), 10000);
  assert.equal(price(24), 240000);
  assert.equal(price(25), 150000);
  assert.equal(price(30), 200000); // 1 park + 5 loose
  assert.equal(price(50), 300000);
  assert.equal(price(75), 450000); // 50 + 25
  assert.equal(price(100), 550000);
  assert.equal(price(130), 750000); // 100 + 25 + 5 loose
  assert.equal(price(25.5), 155000); // a fraction is charged at the single price
  assert.equal(packTotal(10000, [], 3), 30000);
  assert.deepEqual(packBreakdown(packs, 130), [
    { quantity: 100, price: 550000, count: 1 },
    { quantity: 25, price: 150000, count: 1 },
  ]);
  assert.equal(packSummary(10000, packs, 130), '1 × 100 for ₦5,500.00 + 1 × 25 for ₦1,500.00 + 5 × ₦100.00');
});

test('Pack prices are checked like the server checks them', () => {
  assert.deepEqual(
    validPackPrices(packs).map((p) => p.quantity),
    [100, 50, 25],
  );
  assert.throws(() => validPackPrices([{ quantity: 1, price: 5 }]), /2 or more/);
  assert.throws(() => validPackPrices([{ quantity: 5, price: 0 }]), /price/);
  assert.throws(
    () =>
      validPackPrices([
        { quantity: 5, price: 5 },
        { quantity: 5, price: 6 },
      ]),
    /two prices/,
  );
  assert.throws(
    () => validPackPrices(Array.from({ length: 7 }, (_, i) => ({ quantity: i + 2, price: 1 }))),
    /6/,
  );
});

const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: '2026-10-15T09:00:00Z' };
const shop = () => {
  let l = emptyLedger();
  for (const e of [
    {
      id: 'm1',
      kind: 'material.created',
      data: {
        id: 'env',
        name: 'Envelope',
        measurementUnit: 'piece',
        available: 1000,
        requireSize: false,
        ...audit,
      },
    },
    {
      id: 'm2',
      kind: 'material.created',
      data: { id: 'flex', name: 'Flex', measurementUnit: 'sqm', available: 100, requireSize: true, ...audit },
    },
    {
      id: 's1',
      kind: 'service.created',
      data: {
        id: 'env-s',
        description: 'Envelope',
        materialId: 'env',
        price: 10000,
        shelfItem: true,
        packPrices: packs,
        ...audit,
      },
    },
    {
      id: 'c1',
      kind: 'customer.created',
      data: { id: 'bayo', name: 'Bayo', phone: '0802', address: '', creditLimit: 0, ...audit },
    },
  ])
    l = applyEvent(l, e);
  return l;
};

test('Checkout and quick sale charge pack prices and record the packs used', () => {
  const ledger = shop();
  const line = {
    serviceId: 'env-s',
    description: 'Envelope',
    quantity: '130',
    width: '',
    height: '',
    source: 'In shop / USB',
  };
  const quoted = quoteLine(ledger, line);
  assert.equal(quoted.amount, 750000);
  assert.equal(quoted.materialNeeded, 130, 'stock still goes down by the pieces sold');
  assert.equal(quoted.packBreakdown.length, 2);
  assert.equal(quoteLine(ledger, { ...line, quantity: '10' }).packBreakdown, undefined);
  const sale = quickSaleInput(ledger, [{ serviceId: 'env-s', quantity: 30 }], {
    customerId: null,
    tendered: 200000,
    method: 'Cash',
    methodLabel: 'Cash',
    paidOn: '2026-10-15',
    source: 'In shop / USB',
    actor: { id: 'u', label: 'Ada' },
    now: '2026-10-15T09:00:00Z',
  });
  assert.equal(sale.total, 200000);
  const event = prepareCheckout(
    ledger,
    sale.input,
    { id: 'u', label: 'Ada' },
    'sale-1',
    '2026-10-15T09:00:00Z',
  );
  assert.equal(event.data.total, 200000);
});

test('Pack prices are for items sold by count, and can be changed on Edit product', () => {
  const ledger = shop();
  assert.throws(
    () =>
      applyEvent(ledger, {
        id: 's2',
        kind: 'service.created',
        data: {
          id: 'flex-s',
          description: 'Flex',
          materialId: 'flex',
          price: 500,
          packPrices: packs,
          ...audit,
        },
      }),
    /by count/,
  );
  const { events, summary } = productEditEvents(
    ledger,
    'env-s',
    { name: 'Envelope', price: 10000, packPrices: [{ quantity: 25, price: 140000 }] },
    { id: 'u', label: 'Ada' },
  );
  assert.deepEqual(summary, ['Change the pack prices']);
  const after = applyEvent(ledger, events[0]);
  assert.deepEqual(after.services[0].packPrices, [{ quantity: 25, price: 140000 }]);
});
