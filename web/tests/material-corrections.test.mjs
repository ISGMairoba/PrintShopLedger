import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { applyMaterialEvent } from '../src/materials.mjs';
import { materialsCheckEvent } from '../src/material-check.mjs';
import {
  correctionBlocked,
  materialCorrectionAlerts,
  materialCorrectionEvent,
  materialDecisionEvent,
  materialRoute,
  pendingMaterialCorrections,
} from '../src/material-corrections.mjs';

const at = '2026-11-14T10:00:00Z';
const cashier = { id: 'c', label: 'Cashier', level: 1, confirms: false };
const admin = { id: 'a', label: 'Admin', level: 2, confirms: true };
const manager = { id: 'm', label: 'Manager', level: 3, confirms: true };
const owner = { id: 'o', label: 'Owner', level: 4, confirms: true };
const stock = (l) => l.materials.find((m) => m.id === 'p').available;
const job = (l) => l.jobs[0];
const use = (n) => [{ line: 'm:p', materialId: 'p', quantity: n }];

/** A job that took 10 sheets, confirmed by an Admin. */
function setup() {
  let l = applyMaterialEvent(emptyLedger(), {
    id: crypto.randomUUID(),
    kind: 'material.created',
    data: {
      id: 'p',
      name: 'Paper',
      available: 100,
      measurementUnit: 'sheet',
      requireSize: false,
      modifiedBy: 'o',
      modifiedByLabel: 'Owner',
      modifiedAt: at,
    },
  });
  l = {
    ...l,
    teamPeople: [cashier, admin, manager, owner].map((p) => ({ id: p.id, name: p.label, member: true, rank: p.level })),
    jobs: [
      {
        id: 'abcdef12-0000-4000-8000-000000000001',
        customerId: 'c1',
        service: 'Flyers',
        description: '10 flyers',
        amount: 1000,
        materialId: 'p',
        materialNeeded: 10,
        measurementUnit: 'sheet',
        checkMaterials: true,
        productionStatus: 'Printing',
        version: 1,
        createdAt: at,
      },
    ],
  };
  return applyEvent(l, materialsCheckEvent(l, l.jobs[0], use(10), admin));
}

test('material corrections: a cashier asks, an Admin approves; stock moves by the difference', () => {
  let l = setup();
  assert.equal(stock(l), 90);
  assert.throws(() => materialCorrectionEvent(l, job(l), use(12), 'x', cashier, {}), /Give a reason/);
  assert.throws(() => materialCorrectionEvent(l, job(l), use(10), 'Same', admin, {}), /Change at least one/);
  const ask = materialCorrectionEvent(l, job(l), use(12), 'Two spoiled', cashier, {});
  assert.equal(ask.data.route, 'request');
  l = applyEvent(l, ask);
  assert.equal(stock(l), 90);
  assert.equal(pendingMaterialCorrections(l).length, 1);
  assert.match(correctionBlocked(job(l), {}), /waiting for approval/);
  assert.throws(() => materialDecisionEvent(l, job(l), true, '', cashier), /Someone else/);
  l = applyEvent(l, materialDecisionEvent(l, job(l), true, '', admin));
  assert.equal(stock(l), 88);
  assert.equal(job(l).materialCorrection, undefined);
  assert.equal(job(l).materialCheck.recordedBy, 'c');
  assert.equal(job(l).materialCheck.corrections[0].approvedBy, 'a');
  const change = l.materialHistory.at(-1);
  assert.equal(change.action, 'material.job_used');
  assert.match(change.reason, /^Correction: 2 sheet more used on job #ABCDEF12 · Two spoiled/);
});

test('material corrections: whose entry decides the route; a Manager alerts the higher rank', () => {
  let l = setup();
  assert.equal(materialRoute(l, job(l), admin, {}, false), 'direct');
  l = applyEvent(l, materialCorrectionEvent(l, job(l), use(13), 'Owner checked', owner, {}));
  assert.equal(stock(l), 87);
  assert.equal(materialRoute(l, job(l), admin, {}, false), 'request');
  const fix = materialCorrectionEvent(l, job(l), use(12), 'Recount', manager, {});
  assert.equal(fix.data.route, 'alert');
  l = applyEvent(l, fix);
  assert.equal(stock(l), 88);
  assert.equal(materialCorrectionAlerts(l, 'o').length, 1);
  // An Admin asks; a Manager or above decides; declining keeps the audit and moves nothing.
  l = applyEvent(l, materialCorrectionEvent(l, job(l), use(10), 'Looks high', admin, {}));
  assert.equal(job(l).materialCorrection.approverRank, 3);
  l = applyEvent(l, materialDecisionEvent(l, job(l), false, 'It was 12', owner));
  assert.equal(stock(l), 88);
  assert.equal(job(l).materialCheck.corrections.at(-1).status, 'declined');
});

test('material corrections: stock counted since needs an approver; the window closes after collection', () => {
  let l = setup();
  l = {
    ...l,
    materialHistory: [
      ...l.materialHistory,
      { id: 'count', materialId: 'p', action: 'material.stock_set', changedAt: '2099-01-01T00:00:00Z' },
    ],
  };
  const ask = materialCorrectionEvent(l, job(l), use(11), 'After count', owner, {});
  assert.equal(ask.data.route, 'request');
  l = applyEvent(l, ask);
  assert.throws(() => materialDecisionEvent(l, job(l), true, '', owner), /Someone else/);
  const late = {
    ...job(setup()),
    productionStatus: 'Collected',
    stageAt: new Date(Date.now() - 8 * 86400000).toISOString(),
  };
  assert.match(correctionBlocked(late, {}), /up to 7 days/);
  assert.equal(correctionBlocked(late, { teamWork: { correctionDays: 10 } }), '');
});
