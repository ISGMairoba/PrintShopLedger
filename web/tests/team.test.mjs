import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTeamEvent,
  assignEvent,
  assignedTo,
  assignmentId,
  autoWorkEvents,
  canConfirm,
  confirmEvent,
  equalShares,
  myWork,
  sharesProblem,
  stagesFinished,
  teamOn,
  validateTeamSettings,
  workEvents,
} from '../src/team.mjs';
import { applyEvent, emptyLedger } from '../src/domain.mjs';

const admin = { id: 'u-admin', label: 'Admin', level: 2 };
const people = [
  { id: 'u-admin', name: 'Admin', member: true, rank: 2 },
  { id: 'u-cash', name: 'Cashier', member: true, rank: 1 },
  { id: 'p-ada', name: 'Ada' },
];
const job = {
  id: 'j1',
  customerId: 'c1',
  service: 'Flyers',
  description: '1,000 flyers',
  amount: 500000,
  createdAt: '2026-11-20T09:00:00.000Z',
  productionStatus: 'Printing',
  quantity: 1000,
  version: 3,
};
const ledger = () => ({
  ...emptyLedger(),
  jobs: [job],
  teamPeople: people,
  jobAssignments: [],
  workRecords: [],
});

test('Team work is on only when the server keeps it and the business switched it on', () => {
  assert.equal(teamOn({ teamPeople: [] }, { teamWork: { enabled: true } }), false);
  assert.equal(teamOn(ledger(), {}), false);
  assert.equal(teamOn(ledger(), { teamWork: { enabled: true } }), true);
  assert.deepEqual(validateTeamSettings({ enabled: true, doneAtDays: 7, confirmRank: 3 }), {
    enabled: true,
    confirmRank: 3,
  });
  assert.equal(validateTeamSettings({ enabled: false }), undefined);
  assert.throws(() => validateTeamSettings({ doneAtDays: 400 }), /0 to 90/);
  assert.throws(() => validateTeamSettings({ surprise: 1 }), /Unknown/);
});

test('Assigning a stage, or the whole job; the same id on every device', () => {
  assert.equal(assignmentId('j1', 'Printing'), assignmentId('j1', 'Printing'));
  assert.notEqual(assignmentId('j1', 'Printing'), assignmentId('j1', ''));
  assert.match(assignmentId('j1'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  let l = applyEvent(ledger(), assignEvent(ledger(), job, '', ['u-cash'], admin));
  assert.deepEqual(assignedTo(l, job), ['u-cash']);
  l = applyEvent(l, assignEvent(l, job, 'Printing', ['p-ada', 'u-cash'], admin));
  assert.deepEqual(assignedTo(l, job), ['p-ada', 'u-cash']);
  assert.deepEqual(assignedTo(l, job, 'In Queue'), ['u-cash']);
  assert.deepEqual(
    myWork(l, 'p-ada').map((j) => j.id),
    ['j1'],
  );
  // A stale change is refused.
  assert.throws(
    () => applyEvent(l, { ...assignEvent(ledger(), job, 'Printing', [], admin) }),
    /Someone else changed/,
  );
});

test('Shares: percent adds up to 100, quantities to at most the job', () => {
  assert.deepEqual(equalShares(['a', 'b', 'c']), [
    { personId: 'a', share: 33.34 },
    { personId: 'b', share: 33.33 },
    { personId: 'c', share: 33.33 },
  ]);
  assert.equal(sharesProblem(equalShares(['a', 'b', 'c']), 'percent', 0), '');
  assert.match(sharesProblem([{ personId: 'a', share: 90 }], 'percent', 0), /100%/);
  assert.equal(sharesProblem([{ personId: 'a', share: 600 }], 'quantity', 1000), '');
  assert.match(sharesProblem([{ personId: 'a', share: 1200 }], 'quantity', 1000), /more than/);
  assert.match(sharesProblem([], 'percent', 0), /who did/);
});

test('A stage move records the stages it finishes; confirming another’s work', () => {
  assert.deepEqual(stagesFinished(job, 'Collected'), ['Printing', 'Completed']);
  const events = workEvents(
    job,
    'Completed',
    { unit: 'quantity', shares: [{ personId: 'p-ada', share: '600' }], doneAt: '2026-11-22T10:00:00.000Z' },
    admin,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].data.stage, 'Printing');
  assert.equal(events[0].data.shares[0].share, 600);
  let l = applyEvent(ledger(), events[0]);
  const record = l.workRecords[0];
  assert.equal(record.status, 'recorded');
  assert.equal(record.doneAt, '2026-11-22T10:00:00.000Z');
  assert.ok(record.recordedAt > record.doneAt);
  assert.equal(canConfirm(l, record, admin, { teamWork: {} }), true);
  // Work credited to the Admin waits for someone else (the cashier cannot confirm).
  const own = { ...record, shares: [{ personId: 'u-admin', share: 100 }] };
  assert.equal(canConfirm(l, own, { ...admin }, {}), true, 'no one else can confirm: the Admin may');
  assert.equal(
    canConfirm(
      { ...l, teamPeople: [...people, { id: 'u-man', name: 'Manager', member: true, rank: 3 }] },
      own,
      admin,
      {},
    ),
    false,
  );
  assert.equal(canConfirm(l, record, { id: 'u-cash', label: 'Cashier', level: 1 }, {}), false);
  l = applyEvent(l, confirmEvent([record.id], admin));
  assert.equal(l.workRecords[0].status, 'confirmed');
  assert.equal(l.workRecords[0].confirmedByLabel, 'Admin');
});

test('Without "Done by", the people assigned to each finished stage are credited equally', () => {
  let l = applyEvent(ledger(), assignEvent(ledger(), job, 'Printing', ['p-ada', 'u-cash'], admin));
  const events = autoWorkEvents(l, job, 'Collected', admin);
  assert.deepEqual(
    events.map((e) => [e.data.stage, e.data.shares.map((s) => s.share), e.data.auto]),
    [['Printing', [50, 50], true]],
  );
  l = applyEvent(l, assignEvent(l, job, '', ['u-cash'], admin));
  assert.equal(autoWorkEvents(l, job, 'Collected', admin).length, 2);
  assert.throws(() => applyTeamEvent(l, { id: 'x', kind: 'team.unknown', data: { id: 'x' } }), /Unknown/);
});

test('Team report: stages, time against target, rework, late recording, value split equally', async () => {
  const { teamReport, shareOf } = await import('../src/team-report.mjs');
  const done = { ...job, productionStatus: 'Completed', stageHours: { Printing: 4 } };
  const l = {
    ...ledger(),
    jobs: [done],
    workRecords: [
      {
        id: 'w1',
        jobId: 'j1',
        stage: 'Printing',
        unit: 'quantity',
        shares: [
          { personId: 'p-ada', share: 600 },
          { personId: 'u-cash', share: 400 },
        ],
        doneAt: '2026-11-20T12:00:00.000Z',
        recordedAt: '2026-11-22T12:00:00.000Z',
        status: 'confirmed',
        redo: { responsibleId: 'u-cash' },
        version: 1,
      },
      {
        id: 'w2',
        jobId: 'j1',
        stage: 'Finishing',
        unit: 'percent',
        shares: [{ personId: 'p-ada', share: 100 }],
        doneAt: '2026-11-20T13:00:00.000Z',
        recordedAt: '2026-11-20T13:00:00.000Z',
        status: 'recorded',
        version: 1,
      },
    ],
  };
  assert.equal(shareOf(l.workRecords[0], done, 'p-ada'), 0.6);
  let r = teamReport(l, '2026-11-20', '2026-11-20');
  const ada = r.rows.find((x) => x.personId === 'p-ada');
  const cash = r.rows.find((x) => x.personId === 'u-cash');
  // Added 09:00, printed by 12:00: 3 hours against a 4-hour target.
  assert.deepEqual(
    [ada.stages, ada.averageHours, ada.onTimeRate, ada.late, ada.value],
    [1, 3, 100, 1, 250000],
  );
  assert.deepEqual([cash.rework, cash.value], [1, 250000]);
  assert.equal(r.waiting, 1);
  r = teamReport(l, '2026-11-20', '2026-11-20', { includeRecorded: true });
  assert.equal(r.rows.find((x) => x.personId === 'p-ada').stages, 2);
});

test('Commission due: per unit for the work and a percent of sales', async () => {
  const { teamReport } = await import('../src/team-report.mjs');
  const done = { ...job, productionStatus: 'Collected', createdBy: 'u-cash', createdAt: '2026-11-20T09:00:00.000Z' };
  const l = {
    ...ledger(),
    jobs: [done],
    teamTerms: [
      { id: 'p-ada', commission: { kind: 'perUnit', rate: 50 }, version: 1 },
      { id: 'u-cash', commission: { kind: 'percent', rate: 10, salesRate: 2 }, version: 1 },
    ],
    workRecords: [
      {
        id: 'w1',
        jobId: 'j1',
        stage: 'Printing',
        unit: 'quantity',
        shares: [
          { personId: 'p-ada', share: 600 },
          { personId: 'u-cash', share: 400 },
        ],
        doneAt: '2026-11-20T12:00:00.000Z',
        recordedAt: '2026-11-20T12:00:00.000Z',
        status: 'confirmed',
        version: 1,
      },
    ],
  };
  const rows = teamReport(l, '2026-11-20', '2026-11-20').rows;
  // Ada: 600 pieces × ₦0.50. Cashier: 10% of ₦2,500 credited + 2% of the ₦5,000 sold.
  assert.equal(rows.find((r) => r.personId === 'p-ada').commission, 30000);
  assert.equal(rows.find((r) => r.personId === 'u-cash').commission, 25000 + 10000);
});

test('The usual people per stage are assigned at checkout', async () => {
  const { usualAssignEvents } = await import('../src/team.mjs');
  const fresh = { ...job, productionStatus: 'Added' };
  const events = usualAssignEvents(ledger(), [fresh], { teamWork: { usual: { Printing: ['p-ada'] } } }, admin);
  assert.deepEqual(
    events.map((e) => [e.data.stage, e.data.personIds, e.data.usual]),
    [['Printing', ['p-ada'], true]],
  );
  assert.deepEqual(validateTeamSettings({ usual: { Printing: ['p-ada'], Finishing: [] } }), {
    usual: { Printing: ['p-ada'] },
  });
});
