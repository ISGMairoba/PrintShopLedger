import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { applyCheckout, prepareCheckout } from '../src/checkout.mjs';
import {
  addToCart,
  quickSaleInput,
  setQuantity,
  shelfProducts,
  typeQuantity,
  walkInCustomer,
} from '../src/quick-sale.mjs';

const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: '2026-10-13T09:00:00Z' };
const actor = { id: 'u', label: 'Ada' };
const shop = () => {
  let l = emptyLedger();
  for (const e of [
    {
      id: 'm1',
      kind: 'material.created',
      data: { id: 'pen', name: 'Pen', measurementUnit: 'piece', available: 10, requireSize: false, ...audit },
    },
    {
      id: 'm2',
      kind: 'material.created',
      data: { id: 'flex', name: 'Flex', measurementUnit: 'sqm', available: 10, requireSize: true, ...audit },
    },
    {
      id: 's1',
      kind: 'service.created',
      data: {
        id: 'pen-s',
        description: 'Blue pen',
        materialId: 'pen',
        price: 20000,
        shelfItem: true,
        ...audit,
      },
    },
    {
      id: 's2',
      kind: 'service.created',
      data: {
        id: 'flex-s',
        description: 'Flex sheet',
        materialId: 'flex',
        price: 50000,
        shelfItem: true,
        ...audit,
      },
    },
    {
      id: 's3',
      kind: 'service.created',
      data: { id: 'print', description: 'Printing', materialId: null, price: 100, ...audit },
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
const opts = (extra) => ({
  method: 'Cash',
  methodLabel: 'Cash',
  paidOn: '2026-10-13',
  source: 'In shop / USB',
  actor,
  now: '2026-10-13T09:00:00Z',
  ...extra,
});

test('Only shelf items without sizes are offered, with their stock', () => {
  const p = shelfProducts(shop());
  assert.deepEqual(
    p.map((x) => [x.name, x.stock]),
    [['Blue pen', 10]],
  );
});

test('The cart adds, changes and removes quantities', () => {
  let cart = addToCart([], 'pen-s');
  cart = addToCart(cart, 'pen-s');
  assert.deepEqual(cart, [{ serviceId: 'pen-s', quantity: 2 }]);
  assert.deepEqual(setQuantity(cart, 'pen-s', 5), [{ serviceId: 'pen-s', quantity: 5 }]);
  assert.deepEqual(setQuantity(cart, 'pen-s', 0), []);
});

test('A walk-in sale is paid in full, gives change, creates the walk-in customer once', () => {
  let ledger = shop();
  const cart = [{ serviceId: 'pen-s', quantity: 3 }];
  assert.throws(
    () => quickSaleInput(ledger, cart, opts({ customerId: null, tendered: 50000 })),
    /paid in full/,
  );
  const { input, total, change } = quickSaleInput(ledger, cart, opts({ customerId: null, tendered: 100000 }));
  assert.deepEqual([total, change, input.cashReceived], [60000, 40000, 60000]);
  assert.equal(input.newCustomer.data.name, 'Walk-in customer');
  const event = prepareCheckout(ledger, input, actor, 'sale-1', '2026-10-13T09:00:00Z');
  ledger = applyCheckout(ledger, event);
  const pen = ledger.jobs.find((j) => j.checkoutId === 'sale-1');
  assert.deepEqual([pen.productionStatus, pen.amount], ['Collected', 60000]);
  assert.equal(ledger.materials.find((m) => m.id === 'pen').available, 7);
  assert.equal(ledger.payments[0].walletAdded, 0, 'change is not kept as credit');
  // The next walk-in sale reuses the same customer.
  const again = quickSaleInput(ledger, cart, opts({ customerId: null, tendered: 60000 }));
  assert.equal(again.input.newCustomer, null);
  assert.equal(again.input.customerId, walkInCustomer(ledger).id);
});

test('A named customer can pay part now; the rest is owed', () => {
  const ledger = shop();
  const { input, change } = quickSaleInput(
    ledger,
    [{ serviceId: 'pen-s', quantity: 2 }],
    opts({ customerId: 'bayo', tendered: 10000 }),
  );
  assert.deepEqual(
    [input.customerId, input.cashReceived, change, input.newCustomer],
    ['bayo', 10000, 0, null],
  );
  const after = applyCheckout(
    ledger,
    prepareCheckout(ledger, input, actor, 'sale-2', '2026-10-13T09:00:00Z'),
  );
  assert.equal(after.checkouts[0].outstandingAfter, 30000);
});

test('Quick sale discounts follow the rank: per item percentage for cashiers, whole sale for Admin+', () => {
  const ledger = shop();
  const cart = [
    { serviceId: 'pen-s', quantity: 3 },
    { serviceId: 'print', quantity: 100 },
  ];
  const cashier = { maxPercent: 10, canFlat: false };
  const tenPercent = { kind: 'percent', value: 10, reason: 'Regular' };
  const sale = quickSaleInput(
    ledger,
    cart,
    opts({ customerId: null, tendered: 100000, discount: tenPercent, policy: cashier }),
  );
  // ₦600 + ₦100 = ₦700, less 10% on each item = ₦630.
  assert.equal(sale.total, 63000);
  assert.equal(sale.input.orderDiscount, undefined);
  assert.ok(sale.input.lines.every((l) => l.discount?.value === 10));
  const event = prepareCheckout(ledger, sale.input, actor, 'sale-d', '2026-10-13T09:00:00Z');
  assert.equal(event.data.total, 63000);
  assert.throws(
    () =>
      quickSaleInput(
        ledger,
        cart,
        opts({
          customerId: null,
          tendered: 100000,
          discount: { kind: 'percent', value: 20 },
          policy: cashier,
        }),
      ),
    /limit is 10%/,
  );
  const admin = { maxPercent: 100, canFlat: true };
  const flat = quickSaleInput(
    ledger,
    cart,
    opts({ customerId: null, tendered: 100000, discount: { kind: 'amount', value: 5000 }, policy: admin }),
  );
  assert.equal(flat.total, 65000);
  assert.deepEqual(flat.input.orderDiscount, { kind: 'amount', value: 5000 });
  assert.equal(
    prepareCheckout(ledger, flat.input, actor, 'sale-f', '2026-10-13T09:00:00Z').data.total,
    65000,
  );
});

test('Typing a quantity of zero keeps the item in the cart until it is removed', () => {
  const cart = [{ serviceId: 'pen-s', quantity: 2 }];
  assert.deepEqual(typeQuantity(cart, 'pen-s', 0), [{ serviceId: 'pen-s', quantity: 0 }]);
  assert.deepEqual(typeQuantity(cart, 'pen-s', Number('')), [{ serviceId: 'pen-s', quantity: 0 }]);
  assert.deepEqual(typeQuantity(cart, 'pen-s', 5), [{ serviceId: 'pen-s', quantity: 5 }]);
  assert.deepEqual(setQuantity(cart, 'pen-s', 0), []);
  assert.throws(
    () => quickSaleInput(shop(), typeQuantity(cart, 'pen-s', 0), opts({ customerId: null, tendered: 0 })),
    /more than zero/,
  );
});
