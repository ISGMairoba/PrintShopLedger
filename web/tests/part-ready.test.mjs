import test from 'node:test';
import assert from 'node:assert/strict';
import { canTellCustomer, partReady, readyMessage } from '../src/ready-message.mjs';

const ledger = (job, payments = []) => ({
  customers: [{ id: 'c', name: 'Sara Aminu', phone: '08031234567' }],
  jobs: [job],
  payments,
});
const jotters = (extra) => ({
  id: '3222f0c8-0000-4000-8000-000000000000',
  customerId: 'c',
  description: 'Jotter soft cover',
  quantity: 200,
  amount: 20000000,
  productionStatus: 'Processing',
  progress: { done: 60, handovers: [] },
  ...extra,
});

test('Tell customer works when part of a part order is ready', () => {
  const job = jotters();
  assert.equal(partReady(job), 60);
  assert.equal(canTellCustomer(job), true);
  // Nothing ready yet: Tell customer still works, with an order update (26 Nov).
  assert.equal(canTellCustomer(jotters({ progress: { done: 0, handovers: [] } })), true);
  assert.equal(canTellCustomer(jotters({ productionStatus: 'Cancelled' })), false);
  const msg = readyMessage(ledger(job), job, { business: 'Mairoba Studio' });
  assert.equal(msg.mode, 'ask');
  assert.match(msg.text, /Hello Sara, 60 of your 200 Jotter soft cover \(order #3222F0C8\) are ready/);
  // 60 of 200 for ₦200,000: ₦60,000 to pay for this part, ₦200,000 on the order.
  assert.match(msg.text, /Amount to pay for this part: ₦60,000\.00\. Balance on the order: ₦200,000\.00\./);
});

test('After a handover, only what is waiting counts; a paid part says so; the business wording is used', () => {
  const job = jotters({ progress: { done: 100, handovers: [{ id: 'h', quantity: 60 }] } });
  const paid = [{ id: 'p', amount: 10000000, allocations: [{ jobId: job.id, amount: 10000000 }] }];
  const msg = readyMessage(ledger(job, paid), job, {
    business: 'Mairoba',
    messages: {
      send: 'share',
      items: { part_ready: { text: '{ready}/{total} ready, {collected} taken. {to_pay}' } },
    },
  });
  assert.equal(msg.text, '40/200 ready, 60 taken. This part is paid.');
  assert.equal(msg.mode, 'ask');
});

test('A finished order still gets the usual "ready" message', () => {
  const job = jotters({ productionStatus: 'Completed' });
  const msg = readyMessage(ledger(job), job, { business: 'Mairoba' });
  assert.match(msg.text, /your job #3222F0C8 \(Jotter soft cover × 200\) is ready for collection/);
});

test('Order update any time: each item with its stage and progress, when it should be ready', async () => {
  const { messageFor } = await import('../src/ready-message.mjs');
  const job = jotters({
    quantity: 40,
    productionStatus: 'Binding',
    progress: { done: 20, handovers: [] },
    dueAt: '2026-12-02T16:00:00Z',
  });
  // Nothing done yet: an order update.
  const at = jotters({ quantity: 40, productionStatus: 'Binding', progress: { done: 0, handovers: [] } });
  assert.equal(messageFor(at), 'update');
  const msg = readyMessage(ledger(at), at, { business: 'Mairoba Studio', stage: (s) => s.toUpperCase() });
  assert.match(msg.text, /^Hello Sara, an update on your order #3222F0C8 at Mairoba Studio: Jotter soft cover × 40 at BINDING\. /);
  assert.match(msg.text, /Balance to pay: ₦200,000\.00\.$/);
  // Done so far shows as "20 done, 20 left" in the update (part ready has its own message).
  assert.equal(messageFor(job), 'part_ready');
  const { progressMessage } = await import('../src/ready-message.mjs');
  const update = progressMessage(ledger(job), job, 'update', { business: 'Mairoba Studio' });
  assert.match(update.text, /Jotter soft cover × 40 at Binding, 20 done, 20 left\. Expected ready: /);
  // Late is there to use, but not in the default wording.
  assert.doesNotMatch(update.text, /running late/);
});

test('Work continues: just back from a hold and no stage moved since', async () => {
  const { messageFor } = await import('../src/ready-message.mjs');
  const now = Date.now();
  const resumedAt = new Date(now - 3600000).toISOString();
  const job = jotters({
    productionStatus: 'Printing',
    progress: { done: 0, handovers: [] },
    stageAt: new Date(now - 7200000).toISOString(),
    holdHistory: [{ reason: 'Waiting for materials', resumedAt }],
  });
  assert.equal(messageFor(job, now), 'resumed');
  const msg = readyMessage(ledger(job), job, { business: 'Mairoba Studio' });
  assert.match(msg.text, /good news: work on your order #3222F0C8 \(Jotter soft cover × 200\) has continued at Mairoba Studio\. It is now at Printing\./);
  // Moved on to the next stage since: an update instead.
  assert.equal(messageFor({ ...job, stageAt: new Date(now).toISOString() }, now), 'update');
  assert.equal(messageFor(job, now + 2 * 86400000), 'update');
});
