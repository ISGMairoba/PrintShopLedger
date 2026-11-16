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
  data: {
    id: 'paper',
    baseVersion: version++,
    quantity,
    reason: '',
    ...(cost ? { cost } : {}),
    ...audit(minute),
  },
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
    data: {
      id: 'paper',
      name: 'Paper',
      measurementUnit: 'sheet',
      available: 100,
      requireSize: false,
      ...audit(0),
    },
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

test('Actual job cost, waste, expenses for restocks (on time and late) and profit & loss', async () => {
  const { applyCheckout, prepareCheckout } = await import('../src/checkout.mjs');
  const { quickSaleInput } = await import('../src/quick-sale.mjs');
  const { actualJobCost, wasteCost, lateCostsIn } = await import('../src/actual-cost.mjs');
  const { profitLoss } = await import('../src/profit-loss.mjs');
  const actor = { id: 'u', label: 'Ada' };
  version = 1;
  let l = emptyLedger();
  for (const e of [
    { id: 'm1', kind: 'material.created', data: { id: 'paper', name: 'Pen', measurementUnit: 'piece', available: 0, requireSize: false, ...audit(0) } },
    { id: 's1', kind: 'service.created', data: { id: 'pen', description: 'Pen', materialId: 'paper', price: 50000, shelfItem: true, ...audit(0) } },
    { id: 'c1', kind: 'customer.created', data: { id: 'bayo', name: 'Bayo', phone: '0802', address: '', creditLimit: 0, ...audit(0) } },
  ])
    l = applyEvent(l, e);
  version = l.materials[0].version;
  // 10 pens for ₦1,000 (₦100 each), with ₦500 delivery recorded with the restock: ₦150 each.
  l = applyEvent(l, stock('r1', 1, 10, { supplierPrice: 100000 }));
  l = { ...l, expenses: [{ id: 'x1', amount: 50000, restockIds: ['r1'], createdAt: at(1), incurredOn: '2026-11-16', category: 'Delivery', voided: false }] };
  assert.equal(materialValuation(l, 'paper').average, 15000);
  // Sell 2: the job took ₦300 of stock.
  const sale = quickSaleInput(l, [{ serviceId: 'pen', quantity: 2 }], {
    customerId: 'bayo', tendered: 100000, method: 'Cash', methodLabel: 'Cash', paidOn: '2026-11-16', source: 'In shop / USB', actor, now: at(2),
  });
  l = applyCheckout(l, prepareCheckout(l, sale.input, actor, 'k1', at(2)));
  const job = l.jobs.find((j) => j.checkoutId === 'k1');
  assert.deepEqual(
    [actualJobCost(l, job).kobo, actualJobCost(l, job).basis],
    [30000, 'Actual'],
  );
  // A dearer restock later does not change that sale.
  version = l.materials[0].version;
  l = applyEvent(l, stock('r2', 3, 8, { supplierPrice: 240000 }));
  assert.equal(actualJobCost(l, job).kobo, 30000);
  // (8 × ₦150 + ₦2,400) ÷ 16 = ₦225 each.
  assert.equal(materialValuation(l, 'paper').average, 22500);
  // A late ₦800 delivery for r1 (10 received, 16 in stock): all of it joins the stock still held.
  l = { ...l, expenses: [...l.expenses, { id: 'x2', amount: 80000, restockIds: ['r1'], createdAt: at(4), incurredOn: '2026-11-16', category: 'Delivery', voided: false }] };
  assert.equal(materialValuation(l, 'paper').value, 16 * 22500 + 80000);
  assert.equal(lateCostsIn(l, '2026-11-16', '2026-11-16').length, 0);
  // Profit & loss: sales ₦1,000 − goods used ₦300; the deliveries are in the stock, not expenses.
  const pl = profitLoss(l, '2026-11-16', '2026-11-16');
  assert.deepEqual(
    [pl.sales, pl.jobCost, pl.operating, pl.linkedToRestocks, pl.net],
    [100000, 30000, 0, 130000, 70000],
  );
  assert.deepEqual(wasteCost(l, '2026-11-16', '2026-11-16'), { kobo: 0, unknown: 0 });
});

test('A cost linked late, after the stock was used, is a late cost adjustment', async () => {
  const { lateCostsIn } = await import('../src/actual-cost.mjs');
  version = 1;
  let l = emptyLedger();
  l = applyEvent(l, {
    id: 'm1',
    kind: 'material.created',
    data: { id: 'paper', name: 'Paper', measurementUnit: 'sheet', available: 0, requireSize: false, ...audit(0) },
  });
  l = applyEvent(l, stock('r1', 1, 10, { supplierPrice: 100000 }));
  // All 10 used (a count to zero), then ₦500 of delivery is linked: all of it is late.
  l = applyEvent(l, stock('s1', 2, 0, null, 'material.stock_set'));
  l = { ...l, expenses: [{ id: 'x1', amount: 50000, restockIds: ['r1'], createdAt: at(3), incurredOn: '2026-11-16', voided: false }] };
  const late = lateCostsIn(l, '2026-11-16', '2026-11-16');
  assert.deepEqual(late.map((c) => Math.round(c.amount)), [50000]);
});
