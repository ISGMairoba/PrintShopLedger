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
  assert.equal(canTellCustomer(jotters({ progress: { done: 0, handovers: [] } })), false);
  const msg = readyMessage(ledger(job), job, { business: 'Mairoba Studio' });
  assert.equal(msg.mode, 'whatsapp');
  assert.match(msg.text, /Hello Sara, 60 of your 200 Jotter soft cover \(order #3222F0C8\) are ready/);
  // 60 of 200 for ₦200,000: ₦60,000 to pay for this part, ₦200,000 on the order.
  assert.match(msg.text, /Amount to pay for this part: ₦60,000\.00\. Balance on the order: ₦200,000\.00\./);
});

test('After a handover, only what is waiting counts; a paid part says so; the business wording is used', () => {
  const job = jotters({ progress: { done: 100, handovers: [{ id: 'h', quantity: 60 }] } });
  const paid = [{ id: 'p', amount: 10000000, allocations: [{ jobId: job.id, amount: 10000000 }] }];
  const msg = readyMessage(ledger(job, paid), job, {
    business: 'Mairoba',
    messages: { send: 'share', items: { part_ready: { text: '{ready}/{total} ready, {collected} taken. {to_pay}' } } },
  });
  assert.equal(msg.text, '40/200 ready, 60 taken. This part is paid.');
  assert.equal(msg.mode, 'share');
});

test('A finished order still gets the usual "ready" message', () => {
  const job = jotters({ productionStatus: 'Completed' });
  const msg = readyMessage(ledger(job), job, { business: 'Mairoba' });
  assert.match(msg.text, /your job #3222F0C8 \(Jotter soft cover × 200\) is ready for collection/);
});
