import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCostFile,
  reviewCostImport,
  costImportEvents,
  MAX_COST_FILE_BYTES,
} from '../src/cost-transfer.mjs';
import { emptyLedger } from '../src/domain.mjs';
import { applyServiceEvent } from '../src/services.mjs';

const actor = { id: 'b1000000-0000-4000-8000-000000000001', label: 'Cost manager' };
const pack = () => ({
  format: 'printshopledger.pricing-costs',
  version: 1,
  costs: [
    {
      description: 'Paper ream',
      costing: { key: 'test_paper', amount: 430000, per: 500, unit: 'A4 sheets' },
    },
    {
      description: 'Carbon paper',
      costing: { key: 'test_carbon', amount: 17000, per: 16, unit: 'A5 sheets' },
    },
  ],
});
const costs = () => readCostFile(JSON.stringify(pack()));

test('saved cost import creates private services without money or stock changes and repeats without duplicates', () => {
  const before = emptyLedger();
  let after = before;
  const events = costImportEvents(costs(), before, actor);
  for (const event of events) after = applyServiceEvent(after, event);
  assert.equal(after.services.length, 2);
  assert.ok(after.services.every((s) => s.private && s.price === 0 && s.materialId === null));
  assert.deepEqual(after.materials, before.materials);
  assert.deepEqual(after.payments, before.payments);
  assert.deepEqual(after.materialHistory, before.materialHistory);
  assert.equal(costImportEvents(costs(), after, actor).length, 0);
});

test('saved cost import retains current prices and properties for matching formula names', () => {
  let ledger = emptyLedger();
  for (const e of costImportEvents(costs(), ledger, actor)) ledger = applyServiceEvent(ledger, e);
  ledger.services[0].costing.amount = 500000;
  ledger.services[0].description = 'Current paper';
  const before = structuredClone(ledger);
  const review = reviewCostImport(costs(), ledger);
  assert.equal(review[0].existing.costing.amount, 500000);
  assert.equal(costImportEvents(costs(), ledger, actor).length, 0);
  assert.deepEqual(ledger, before);
});

test('a linked material or missing cost on an existing formula name requires manual resolution', () => {
  let ledger = emptyLedger();
  for (const e of costImportEvents(costs(), ledger, actor)) ledger = applyServiceEvent(ledger, e);
  ledger.services[0].materialId = actor.id;
  assert.throws(() => reviewCostImport(costs(), ledger), /incompatible/);
  ledger.services[0].materialId = null;
  delete ledger.services[0].costing.amount;
  assert.throws(() => reviewCostImport(costs(), ledger), /incompatible/);
});

test('cost files reject invalid versions, names, money, per values, duplicate keys and oversized input', () => {
  assert.throws(() => readCostFile('{'), /valid/);
  assert.throws(() => readCostFile(' '.repeat(MAX_COST_FILE_BYTES + 1)), /2 MB/);
  for (const mutate of [
    (p) => (p.version = 2),
    (p) => (p.costs = []),
    (p) => (p.costs[0].description = ''),
    (p) => (p.costs[0].costing.amount = 1.5),
    (p) => (p.costs[0].costing.per = 0),
    (p) => (p.costs[0].costing.key = 'quantity'),
    (p) => (p.costs[0].costing = { key: 'only_name' }),
    (p) => p.costs.push(p.costs[0]),
  ]) {
    const value = pack();
    mutate(value);
    assert.throws(() => readCostFile(JSON.stringify(value)));
  }
});
