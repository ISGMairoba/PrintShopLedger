import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPartnerEvent, partnerSplit, readyToStock, refillNeeded, stockFrom } from '../src/partners.mjs';
import { featureOn } from '../src/business-type.mjs';

const item = { id: 's1', customerId: 'sara', agreedStock: 200, refillAt: 80, batchSize: 250, refillPrompt: 'ask' };
const who = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: '2026-11-26T10:00:00Z' };

test('An order: from stock first, the rest made in the best batch size while stock is below agreed', () => {
  assert.deepEqual(partnerSplit({ ...item, onHand: 200 }, 300), {
    itemId: 's1',
    fromStock: 200,
    toMake: 100,
    made: 250,
    design: 1,
  });
  // Enough in stock: nothing made.
  assert.equal(partnerSplit({ ...item, onHand: 500 }, 300).made, 0);
  // Stock left at or above agreed after the sale: make only what is needed.
  assert.equal(partnerSplit({ ...item, agreedStock: 0, onHand: 0 }, 30).made, 30);
  assert.equal(refillNeeded({ ...item, onHand: 50, status: 'active' }), 250);
  assert.equal(refillNeeded({ ...item, onHand: 120, status: 'active' }), null);
  assert.equal(refillNeeded({ ...item, onHand: 0, refillPrompt: 'never', status: 'active' }), null);
});

test('Partner stock moves: agreement, sale from stock, leftover back, count; Partners starts off', () => {
  let l = { jobs: [], partnerItems: [], customers: [], services: [] };
  l = applyPartnerEvent(l, {
    id: 'e1',
    kind: 'partner.item_saved',
    data: { ...item, endRule: 'partnerPays', collectRule: 'together', baseVersion: 0, ...who, id: 's1' },
  });
  l = { ...l, partnerItems: l.partnerItems.map((p) => ({ ...p, onHand: 200 })) };
  l.jobs = [
    {
      id: 'j1',
      productionStatus: 'Added',
      partner: { itemId: 's1', fromStock: 200, toMake: 100, made: 250 },
    },
  ];
  l = applyPartnerEvent(l, { id: 'e2', kind: 'partner.stock_taken', data: { id: 's1', jobId: 'j1', ...who } });
  assert.equal(l.partnerItems[0].onHand, 0);
  assert.throws(
    () => applyPartnerEvent(l, { id: 'e3', kind: 'partner.stock_taken', data: { id: 's1', jobId: 'j1', ...who } }),
    /Already taken/,
  );
  l = { ...l, jobs: l.jobs.map((j) => ({ ...j, productionStatus: 'Completed' })) };
  assert.equal(readyToStock(l).length, 1);
  assert.equal(stockFrom(l.jobs[0]), 150);
  l = applyPartnerEvent(l, { id: 'e4', kind: 'partner.stock_built', data: { id: 's1', jobId: 'j1', ...who } });
  assert.equal(l.partnerItems[0].onHand, 150);
  assert.equal(readyToStock(l).length, 0);
  l = applyPartnerEvent(l, {
    id: 'e5',
    kind: 'partner.stock_adjusted',
    data: { id: 's1', quantity: 148, reason: 'Counted', ...who },
  });
  assert.deepEqual(
    l.partnerItems[0].moves.map((m) => m.kind),
    ['sold', 'leftover', 'set'],
  );
  assert.equal(featureOn({ businessType: 'both' }, 'Partners'), false);
  assert.equal(featureOn({ businessType: 'both', features: { Partners: true } }, 'Partners'), true);
});
