import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './pricing-fixture.mjs';
import { canonical, itemTotal, parseFormula, formulaText } from '../src/pricing-formulas.mjs';
import { priceTemplate, validateTemplate } from '../src/pricing-templates.mjs';

const bag = {
  id: id(61),
  description: 'Nylon bag',
  materialId: null,
  price: 13000,
  archived: false,
  version: 2,
  costing: { key: 'nylon_bag' },
  packPrices: [
    { price: 600000, quantity: 50 },
    { price: 1150000, quantity: 100 },
  ],
};
const priceOf = (formula, quantity, extra = []) => {
  const { ledger } = fixture();
  ledger.services.push(bag, ...extra);
  const t = structuredClone(ledger.pricing.templates[0]);
  t.expenses.push({ key: 'bags', label: 'Bags', formula });
  return priceTemplate(ledger, validateTemplate(t), { sheets_per_book: 25, inner_paper: 1, cover_card: 1 }, quantity);
};

test('PRICE(item, count) charges packs first, then single pieces', () => {
  assert.equal(formulaText(parseFormula('PRICE(nylon_bag, quantity)')), 'PRICE(nylon_bag_price, quantity)');
  assert.throws(() => parseFormula('PRICE(2, quantity)'), /formula name/);
  assert.equal(canonical(itemTotal({ amount: bag.price, packPrices: bag.packPrices }, 130)), '15400'); // 100 for ₦11,500 + 30 × ₦130
  assert.equal(canonical(itemTotal({ amount: bag.price, packPrices: bag.packPrices }, 50)), '6000');
  assert.equal(canonical(itemTotal({ amount: bag.price, packPrices: bag.packPrices }, 49)), '6370');
  assert.equal(
    canonical(itemTotal({ amount: 1000, priceTiers: [{ from: 10, price: 800 }, { from: 50, price: 600 }] }, 60)),
    '360',
  );
  const s = priceOf('PRICE(nylon_bag, quantity)', 130);
  assert.equal(s.expenses.at(-1).amount, '15400');
  assert.deepEqual(s.references.find((r) => r.key === 'nylon_bag_price').packPrices, bag.packPrices);
  // The plain _price stays the single price, and keeps its old reference.
  const single = priceOf('quantity * nylon_bag_price', 130);
  assert.equal(single.expenses.at(-1).amount, '16900');
  assert.equal(single.references.find((r) => r.key === 'nylon_bag_price').packPrices, undefined);
});

test('items without a fixed selling price are refused, not counted as ₦0', () => {
  const svc = (patch) => ({ ...bag, id: id(62), description: 'Design', costing: { key: 'design' }, packPrices: [], ...patch });
  assert.throws(() => priceOf('design_price', 1, [svc({ private: true, price: 0 })]), /private \(not sold\).*Use its cost: design/);
  assert.throws(() => priceOf('design_price', 1, [svc({ customPrice: true })]), /priced at the sale/);
  assert.throws(() => priceOf('PRICE(design, 2)', 1, [svc({ price: 0 })]), /has no selling price/);
});
