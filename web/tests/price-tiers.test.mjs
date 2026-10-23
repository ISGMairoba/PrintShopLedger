import test from 'node:test';
import assert from 'node:assert/strict';
import { countPrice, tierList, tierPrice, validPriceTiers } from '../src/price-tiers.mjs';
import { fixture, id, actor } from './pricing-fixture.mjs';
import { quoteLine } from '../src/checkout.mjs';
import { validateService } from '../src/services.mjs';

const tiers = [
  { from: 101, price: 6000 },
  { from: 26, price: 8000 },
];

test('the whole quantity is charged at the rate of its range', () => {
  assert.deepEqual(validPriceTiers(tiers), [
    { from: 26, price: 8000 },
    { from: 101, price: 6000 },
  ]);
  assert.equal(tierPrice(10000, tiers, 1), 10000);
  assert.equal(tierPrice(10000, tiers, 25), 10000);
  assert.equal(tierPrice(10000, tiers, 26), 8000);
  assert.equal(tierPrice(10000, tiers, 100), 8000);
  assert.equal(tierPrice(10000, tiers, 101), 6000);
  assert.equal(countPrice({ price: 10000, priceTiers: tiers }, 30), 240000);
  assert.equal(tierList(10000, validPriceTiers(tiers)), '1–25: ₦100.00 · 26–100: ₦80.00 · 101+: ₦60.00');
  assert.throws(() => validPriceTiers([{ from: 1, price: 5 }]), /2 or more/);
  assert.throws(
    () =>
      validPriceTiers([
        { from: 5, price: 5 },
        { from: 5, price: 6 },
      ]),
    /two ranges/,
  );
});

test('sales use the range rate; a custom-price service uses the price typed at the sale', () => {
  const { ledger } = fixture();
  const audit = { ...ledger.services[0], materialId: null, private: false, costing: null, shelfItem: false };
  ledger.services.push(
    { ...audit, id: id(50), description: 'Binding', price: 10000, priceTiers: validPriceTiers(tiers) },
    { ...audit, id: id(51), description: 'Consultation', price: 500000, customPrice: true },
  );
  const line = (serviceId, quantity, extra = {}) =>
    quoteLine(ledger, {
      id: id(52),
      serviceId,
      description: 'Job',
      quantity,
      source: 'In shop / USB',
      sourceNote: '',
      ...extra,
    });
  const ranged = line(id(50), 30);
  assert.equal(ranged.unitPrice, 8000);
  assert.equal(ranged.amount, 240000);
  assert.equal(line(id(50), 5).amount, 50000);
  const custom = line(id(51), 2, { unitPrice: 1250000 });
  assert.equal(custom.unitPrice, 1250000);
  assert.equal(custom.amount, 2500000);
  assert.throws(() => line(id(51), 1), /Enter the price for Consultation/);
  assert.throws(() => line(id(51), 1, { unitPrice: -5 }), /Enter the price/);
  // Other services ignore a price sent with the line.
  assert.equal(line(id(50), 30, { unitPrice: 1 }).unitPrice, 8000);
});

test('ranges and custom prices exclude pack prices, shelf sales and templates-only use', () => {
  const { ledger } = fixture();
  const base = { id: id(60), description: 'X', price: 100, materialId: null };
  assert.throws(
    () => validateService({ ...base, priceTiers: tiers, packPrices: [{ quantity: 10, price: 500 }] }, ledger),
    /not both/,
  );
  assert.throws(
    () => validateService({ ...base, customPrice: true, shelfItem: true }, ledger),
    /off the shelf/,
  );
  assert.throws(
    () => validateService({ ...base, customPrice: true, priceTiers: tiers }, ledger),
    /pack prices or quantity ranges/,
  );
  assert.doesNotThrow(() => validateService({ ...base, customPrice: true }, ledger));
  assert.doesNotThrow(() => validateService({ ...base, priceTiers: tiers }, ledger));
  void actor;
});
