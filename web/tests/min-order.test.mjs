import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteLine } from '../src/checkout.mjs';
import { setMinOrderRule, belowMinimum, startQuantity } from '../src/min-order.mjs';
import { addToCart } from '../src/quick-sale.mjs';
import { applyFieldEvent, cleanMinQuantity, displayEvent } from '../src/item-fields.mjs';

const service = {
  id: 's1',
  description: 'Envelope',
  materialId: null,
  price: 5000,
  packPrices: [{ quantity: 50, price: 200000 }],
  minQuantity: 20,
  version: 1,
};
const ledger = { services: [service], materials: [], pricing: { templates: [] } };
const line = (quantity) => ({
  id: 'l1',
  serviceId: 's1',
  description: 'Envelope',
  quantity: String(quantity),
  source: 'In shop / USB',
  sourceNote: '',
});

test('Below an item’s minimum order a sale is refused, or allowed with a note', () => {
  setMinOrderRule('block');
  assert.throws(() => quoteLine(ledger, line(10)), /minimum order for Envelope is 20/);
  assert.equal(quoteLine(ledger, line(20)).quantity, 20);
  // Packs count their pieces: 50 (one pack) is above the minimum.
  assert.equal(quoteLine(ledger, line(50)).amount, 200000);
  setMinOrderRule('warn');
  assert.equal(quoteLine(ledger, line(10)).quantity, 10);
  assert.equal(belowMinimum(service, 10), 'Minimum order is 20.');
  assert.equal(belowMinimum(service, 20), '');
  setMinOrderRule('block');
});

test('Quick sale’s first tap adds the minimum order, then one at a time', () => {
  assert.equal(startQuantity(service), 20);
  assert.equal(startQuantity({}), 1);
  let cart = addToCart([], 's1', 1, 20);
  assert.equal(cart[0].quantity, 20);
  cart = addToCart(cart, 's1', 1, 20);
  assert.equal(cart[0].quantity, 21);
});

test('The minimum order is set with the item’s icon, category, code and tags', () => {
  assert.equal(cleanMinQuantity(''), 0);
  assert.throws(() => cleanMinQuantity('2.5'), /whole number/);
  const event = displayEvent(
    service,
    { icon: '', category: '', tags: [], minQuantity: '100' },
    { id: 'u', label: 'Ada' },
  );
  assert.equal(event.data.minQuantity, 100);
  const next = applyFieldEvent({ services: [service] }, event);
  assert.equal(next.services[0].minQuantity, 100);
});
