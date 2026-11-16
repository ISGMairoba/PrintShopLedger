import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { materialValuation, validRestockCost } from '../src/actual-cost.mjs';

const at = (minute) => `2026-11-16T09:${String(minute).padStart(2, '0')}:00Z`;
const audit = (minute) => ({ modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: at(minute) });
let version = 1;
const stock = (id, minute, quantity, cost, kind = 'material.stock_added') => ({
  id,
  kind,
  data: { id: 'paper', baseVersion: version++, quantity, reason: '', ...(cost ? { cost } : {}), ...audit(minute) },
});

test('Restock cost: a supplier price for the quantity, optional supplier and what is already included', () => {
  assert.equal(validRestockCost(undefined), null);
  assert.deepEqual(validRestockCost({ supplierPrice: 500000, supplier: ' Ade ', included: '' }), {
    supplierPrice: 500000,
    supplier: 'Ade',
  });
  assert.throws(() => validRestockCost({ supplierPrice: -1 }), /supplier price/);
  assert.throws(() => validRestockCost({ supplierPrice: 1.5 }), /supplier price/);
});

test('Moving average: restocks set the actual cost; use takes stock at the average of the moment', () => {
  version = 1;
  let l = emptyLedger();
  // 100 sheets in stock before go-live, estimated at ₦10 a sheet (no costing → no estimate here).
  l = applyEvent(l, {
    id: 'm1',
    kind: 'material.created',
    data: { id: 'paper', name: 'Paper', measurementUnit: 'sheet', available: 100, requireSize: false, ...audit(0) },
  });
  let v = materialValuation(l, 'paper');
  assert.equal(v.average, null, 'no estimate and no restock: no cost yet');
  // Restock 100 sheets for ₦2,000 (₦20 a sheet).
  l = applyEvent(l, stock('r1', 1, 100, { supplierPrice: 200000 }));
  v = materialValuation(l, 'paper');
  assert.equal(l.materialHistory.at(-1).after.cost.supplierPrice, 200000);
  // The 100 already there had no cost known, so they take the restock's price: ₦20 a sheet.
  assert.equal(v.restocks, 1);
  assert.equal(v.average, 2000);
  // A count sets 150: no cost of its own; stock moves at the average.
  l = applyEvent(l, stock('s1', 2, 150, null, 'material.stock_set'));
  v = materialValuation(l, 'paper');
  assert.equal(v.quantity, 150);
  assert.equal(v.value, 300000);
  // Restock 50 more for ₦2,500 (₦50 a sheet): (₦3,000 + ₦2,500) ÷ 200 = ₦27.50 a sheet.
  l = applyEvent(l, stock('r2', 3, 50, { supplierPrice: 250000, supplier: 'Ade' }));
  v = materialValuation(l, 'paper');
  assert.equal(v.quantity, 200);
  assert.equal(v.value, 550000);
  assert.equal(v.average, 2750);
  assert.equal(v.unitCost.get('s1'), 2000, 'earlier movements keep the average of their moment');
  // A return without a price comes in at the average and is counted as no cost.
  l = applyEvent(l, stock('a1', 4, 10, null));
  v = materialValuation(l, 'paper');
  assert.deepEqual([v.quantity, v.average, v.noCost], [210, 2750, 10]);
});
