import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { prepareCheckout, quoteLine } from '../src/checkout.mjs';
import { progressEvents } from '../src/job-progress.mjs';
import {
  materialConfirmDue,
  materialPending,
  stageMoveEvents,
  suggestedUsage,
} from '../src/material-choice.mjs';

const actor = { id: 'u', label: 'Ada' };
const at = '2026-10-17T09:00:00Z';
const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: at };
const id = () => crypto.randomUUID();

function shop({ stage = 'Printing' } = {}) {
  let ledger = emptyLedger();
  const apply = (kind, data) => {
    ledger = applyEvent(ledger, { id: id(), kind, data: { ...data, ...audit } });
    return data.id;
  };
  const roll = (name, available, unit = 'sq ft', requireSize = true) =>
    apply('material.created', {
      id: id(),
      name,
      available,
      measurementUnit: unit,
      requireSize,
      minimumStock: 0,
      reason: 'Opening stock',
    });
  const r2 = roll('Banner roll 2 ft', 100),
    r5 = roll('Banner roll 5 ft', 250),
    r10 = roll('Banner roll 10 ft', 500);
  const banner = apply('service.created', {
    id: id(),
    description: 'Banner printing',
    materialId: null,
    materialOptions: [r2, r5, r10],
    confirmStage: stage,
    price: 50000,
  });
  const customer = apply('customer.created', {
    id: id(),
    name: 'Bello',
    phone: '0801',
    address: '',
    creditLimit: 0,
  });
  return { ledger, r2, r5, r10, banner, customer, roll, apply: (k, d) => apply(k, d), get: () => ledger };
}
const sell = (s) => {
  const line = {
    id: id(),
    serviceId: s.banner,
    description: 'Shop banners',
    quantity: '2',
    width: '5',
    height: '2',
    source: 'In shop / USB',
    sourceNote: '',
  };
  const event = prepareCheckout(
    s.ledger,
    {
      customerId: s.customer,
      lines: [line],
      cashReceived: 0,
      useWallet: false,
      paidOn: '2026-10-17',
      method: 'Cash',
      reference: '',
    },
    actor,
    id(),
    at,
  );
  return { ledger: applyEvent(s.ledger, event), event, jobId: line.id };
};

test('a choice service is priced by size but takes no stock at the sale', () => {
  const s = shop();
  const quote = quoteLine(s.ledger, {
    serviceId: s.banner,
    description: 'x',
    quantity: '2',
    width: '5',
    height: '2',
    source: 'In shop / USB',
  });
  assert.equal(quote.amount, 50000 * 20);
  assert.equal(quote.materialId, null);
  assert.equal(quote.materialNeeded, 0);
  assert.equal(quote.requireSize, true);
  assert.deepEqual(quote.materialChoice, {
    options: [s.r2, s.r5, s.r10],
    confirmStage: 'Printing',
    work: 20,
  });
  const { ledger, jobId } = sell(s);
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [100, 250, 500],
  );
  const job = ledger.jobs.find((j) => j.id === jobId);
  assert.equal(materialPending(job), true);
  assert.equal(suggestedUsage(job), 20);
});

test('the job cannot pass its confirmation stage until the material is confirmed', () => {
  const s = shop();
  let { ledger, jobId } = sell(s);
  let job = ledger.jobs.find((j) => j.id === jobId);
  // Up to and into Printing is fine.
  for (const e of progressEvents(job, 'Printing', actor, at)) ledger = applyEvent(ledger, e);
  job = ledger.jobs.find((j) => j.id === jobId);
  assert.equal(materialConfirmDue(job, 'Completed'), true);
  assert.throws(
    () => progressEvents(job, 'Completed', actor, at).forEach((e) => applyEvent(ledger, e)),
    /Confirm the material/,
  );
  assert.throws(() => stageMoveEvents(ledger, job, 'Completed', actor), /Confirm the material/);
  // 4 ft of the 5 ft roll (2 banners side by side on a 10 ft roll would have been 2 ft).
  for (const e of stageMoveEvents(ledger, job, 'Completed', actor, [{ materialId: s.r5, quantity: 4 }], at))
    ledger = applyEvent(ledger, e);
  job = ledger.jobs.find((j) => j.id === jobId);
  assert.equal(job.productionStatus, 'Completed');
  assert.equal(materialPending(job), false);
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [100, 246, 500],
  );
  const used = ledger.materialHistory.filter((h) => h.jobId === jobId && h.action === 'material.job_used');
  assert.equal(used.length, 1);
  assert.equal(used[0].beforeAvailable - used[0].afterAvailable, 4);
});

test('skipping straight to Completed still asks, and usage can be split across materials', () => {
  const s = shop();
  let { ledger, jobId } = sell(s);
  const job = ledger.jobs.find((j) => j.id === jobId);
  assert.equal(materialConfirmDue(job, 'In Queue'), false);
  assert.equal(materialConfirmDue(job, 'Completed'), true);
  const events = stageMoveEvents(
    ledger,
    job,
    'Completed',
    actor,
    [
      { materialId: s.r5, quantity: 3 },
      { materialId: s.r2, quantity: 2.5 },
    ],
    at,
  );
  assert.equal(events[0].kind, 'job.material_used');
  for (const e of events) ledger = applyEvent(ledger, e);
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [97.5, 247, 500],
  );
  assert.throws(
    () =>
      stageMoveEvents(ledger, job, 'Completed', actor, [
        { materialId: s.r5, quantity: 1 },
        { materialId: s.r5, quantity: 1 },
      ]),
    /at most once|already confirmed|changed/,
  );
});

test('the confirmation stage is per service: confirming when leaving In Queue', () => {
  const s = shop({ stage: 'In Queue' });
  const { ledger, jobId } = sell(s);
  const job = ledger.jobs.find((j) => j.id === jobId);
  assert.equal(materialConfirmDue(job, 'In Queue'), false);
  assert.equal(materialConfirmDue(job, 'Printing'), true);
});

test('service rules: 2–10 materials, same unit and size rule, not a shelf item, not with a fixed material', () => {
  const s = shop();
  const film = s.roll('Film 12 inch', 50, 'ft', false);
  const base = { id: id(), description: 'Bad', materialId: null, price: 100 };
  assert.throws(() => s.apply('service.created', { ...base, materialOptions: [s.r2] }), /2 to 10/);
  assert.throws(
    () => s.apply('service.created', { ...base, id: id(), materialOptions: [s.r2, film] }),
    /same unit/,
  );
  assert.throws(
    () => s.apply('service.created', { ...base, id: id(), materialOptions: [s.r2, s.r5], shelfItem: true }),
    /off the shelf/,
  );
  assert.throws(
    () => s.apply('service.created', { ...base, id: id(), materialId: s.r2, materialOptions: [s.r2, s.r5] }),
    /not both/,
  );
  // Back to one fixed material: the choice is removed.
  const svc = s.get().services.find((x) => x.id === s.banner);
  s.apply('service.updated', {
    id: svc.id,
    baseVersion: svc.version,
    description: svc.description,
    materialId: s.r5,
    materialOptions: [],
    price: svc.price,
  });
  const after = s.get().services.find((x) => x.id === s.banner);
  assert.equal(after.materialId, s.r5);
  assert.equal(after.materialOptions, undefined);
});

// ---- Corrections: stock follows the material really used ----
import { accountToken } from '../src/checkout.mjs';
const correction = (ledger, job, kind, data) => ({
  id: id(),
  kind,
  data: {
    jobId: job.id,
    baseVersion: job.version ?? 1,
    expectedAccount: accountToken(ledger, job.customerId),
    reason: 'Fix',
    ...audit,
    ...data,
  },
});
const details = (ledger, job, patch) =>
  correction(ledger, job, 'sale.details_corrected', {
    serviceId: job.serviceId,
    serviceVersion: ledger.services.find((s) => s.id === job.serviceId).version,
    description: job.description,
    quantity: job.quantity,
    width: job.width,
    height: job.height,
    unitPrice: job.unitPrice,
    stockMode: 'reconcile',
    stockIds: Object.fromEntries(ledger.materials.map((m) => [m.id, id()])),
    materialVersions: Object.fromEntries(ledger.materials.map((m) => [m.id, m.version])),
    ...patch,
  });
const confirmed = (s, usages) => {
  let { ledger, jobId } = sell(s);
  const job = ledger.jobs.find((j) => j.id === jobId);
  for (const e of stageMoveEvents(ledger, job, 'Completed', actor, usages, at))
    ledger = applyEvent(ledger, e);
  return { ledger, job: ledger.jobs.find((j) => j.id === jobId) };
};

test('before the material is confirmed, a size correction only changes the job size to confirm', () => {
  const s = shop();
  let { ledger, jobId } = sell(s);
  const job = ledger.jobs.find((j) => j.id === jobId);
  ledger = applyEvent(ledger, details(ledger, job, { width: 10 }));
  const after = ledger.jobs.find((j) => j.id === jobId);
  assert.equal(after.amount, 50000 * 40);
  assert.equal(after.materialChoice.work, 40);
  assert.equal(materialPending(after), true);
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [100, 250, 500],
  );
});

test('after it is confirmed, a correction asks the new amount of each material and moves stock by the difference', () => {
  const s = shop();
  let { ledger, job } = confirmed(s, [{ materialId: s.r5, quantity: 4 }]);
  assert.throws(() => applyEvent(ledger, details(ledger, job, { width: 10 })), /really used/);
  ledger = applyEvent(
    ledger,
    details(ledger, job, {
      width: 10,
      choiceUsages: [
        { materialId: s.r5, quantity: 6 },
        { materialId: s.r10, quantity: 1 },
      ],
    }),
  );
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [100, 244, 499],
  );
  job = ledger.jobs.find((j) => j.id === job.id);
  assert.deepEqual(
    job.materialUsed.usages.map((u) => [u.materialId, u.quantity]),
    [
      [s.r5, 6],
      [s.r10, 1],
    ],
  );
  // Keep: the job changes, the stock does not.
  ledger = applyEvent(ledger, details(ledger, job, { quantity: 1, stockMode: 'keep' }));
  assert.deepEqual(
    ledger.materials.map((m) => m.available),
    [100, 244, 499],
  );
});

test('cancelling a confirmed job returns what was not really used, per material', () => {
  const s = shop();
  const { ledger, job } = confirmed(s, [
    { materialId: s.r5, quantity: 4 },
    { materialId: s.r2, quantity: 1 },
  ]);
  const cancel = (usages) =>
    correction(ledger, job, 'sale.cancelled', {
      returnQuantity: 0,
      choiceUsages: usages,
      stockIds: Object.fromEntries(ledger.materials.map((m) => [m.id, id()])),
      materialVersions: Object.fromEntries(ledger.materials.map((m) => [m.id, m.version])),
    });
  assert.throws(() => applyEvent(ledger, cancel([{ materialId: s.r5, quantity: 5 }])), /cannot exceed/);
  const next = applyEvent(ledger, cancel([{ materialId: s.r5, quantity: 1 }]));
  assert.deepEqual(
    next.materials.map((m) => m.available),
    [99, 249, 500],
  );
  assert.equal(next.jobs.find((j) => j.id === job.id).productionStatus, 'Cancelled');
  const returned = next.materialHistory.filter(
    (h) => h.jobId === job.id && h.action === 'material.sale_returned',
  );
  assert.equal(returned.length, 1);
});

test('a choice-of-materials job keeps its service in corrections', () => {
  const s = shop();
  const other = s.apply('service.created', { id: id(), description: 'Design', materialId: null, price: 100 });
  const { ledger, jobId } = sell({ ...s, ledger: s.get() });
  const job = ledger.jobs.find((j) => j.id === jobId);
  assert.throws(
    () => applyEvent(ledger, details(ledger, job, { serviceId: other, serviceVersion: 1 })),
    /keeps its service/,
  );
});
