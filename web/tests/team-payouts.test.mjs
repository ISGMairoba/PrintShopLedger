import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionBalance, payoutEvents } from '../src/team-payouts.mjs';
import { applyTeamEvent } from '../src/team.mjs';

const actor = { id: 'boss', label: 'Boss', level: 4 };
const ledger = () => ({
  jobs: [
    { id: 'j1', amount: 1000000, productionStatus: 'Completed', createdAt: '2026-11-20T08:00:00Z', service: 'Flyers' },
  ],
  teamPeople: [{ id: 'ada', name: 'Ada' }],
  teamTerms: [{ id: 'ada', commission: { kind: 'percent', rate: 10 }, version: 1 }],
  workRecords: [
    {
      id: 'w1',
      jobId: 'j1',
      stage: 'Printing',
      status: 'confirmed',
      unit: 'percent',
      shares: [{ personId: 'ada', share: 100 }],
      doneAt: '2026-11-21T08:00:00Z',
      recordedAt: '2026-11-21T08:00:00Z',
    },
  ],
  teamPayouts: [],
  moneyAccounts: [],
});

test('Commission balance: earned on confirmed work, less paid and deducted; overpaying is an advance', () => {
  let l = ledger();
  assert.deepEqual(commissionBalance(l, 'ada'), { earned: 100000, paid: 0, deducted: 0, balance: 100000 });
  const paidFrom = { kind: 'Cash', label: 'Cash', source: 'Business cash' };
  const events = payoutEvents(l, 'ada', { kind: 'payout', amount: 150000, paidFrom }, actor, '2026-11-26T10:00:00Z');
  assert.equal(events[0].kind, 'expense.created');
  assert.equal(events[0].data.category, 'Commission');
  assert.match(events[0].data.description, /advance/);
  assert.equal(events[1].data.expenseId, events[0].data.id);
  assert.equal(events[1].data.balanceBefore, 100000);
  l = applyTeamEvent(l, events[1]);
  assert.equal(commissionBalance(l, 'ada').balance, -50000);
  const d = payoutEvents(l, 'ada', { kind: 'deduction', amount: 10000, note: 'Spoilt print' }, actor);
  assert.equal(d.length, 1);
  l = applyTeamEvent(l, d[0]);
  assert.deepEqual(commissionBalance(l, 'ada'), { earned: 100000, paid: 150000, deducted: 10000, balance: -60000 });
  assert.throws(() => payoutEvents(l, 'ada', { kind: 'payout', amount: 100 }, actor), /paid from/);
  assert.throws(() => payoutEvents(l, 'ada', { kind: 'payout', amount: 0, paidFrom }, actor), /greater than zero/);
});
