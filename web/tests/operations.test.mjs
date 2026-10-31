import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import {
  applyOperation,
  operationEvent,
  accountBalance,
  moneyTransactions,
  defaultMoneyAccount,
} from '../src/operations.mjs';
import { deadlineProgress } from '../src/job-deadlines.mjs';
import { dashboardSummary } from '../src/dashboard.mjs';
import { projectPending, acknowledgeReviews } from '../src/sync-dependencies.mjs';
import { upgradePageAccess } from '../src/page-access.mjs';
const actor = { id: 'staff', label: 'Admin' },
  now = '2026-10-31T10:00:00Z';
const event = (kind, data) => operationEvent(kind, data, actor, now);
const account = (id, methods = []) =>
  event('account.created', {
    id,
    name: id,
    accountType: 'bank',
    openingBalance: 10000,
    openingDate: '2026-10-01',
    methods,
  });
test('deadlines count down, clamp elapsed progress, and stop once finished', () => {
  const j = { createdAt: '2026-10-29T10:00:00Z', dueAt: '2026-11-02T10:00:00Z', productionStatus: 'Added' };
  assert.deepEqual(deadlineProgress(j, Date.parse(now)), {
    state: 'later',
    progress: 0.5,
    label: '2 days left',
  });
  assert.match(deadlineProgress(j, Date.parse('2026-11-03')).label, /Overdue/);
  assert.equal(deadlineProgress(j, Date.parse('2026-11-03')).progress, 1);
  assert.equal(deadlineProgress({ ...j, productionStatus: 'Collected' }).state, 'done');
  assert.equal(deadlineProgress({}).label, 'No due date');
});
test('bulk due changes are atomic, audited, and reject stale or finished jobs', () => {
  let l = {
    ...emptyLedger(),
    jobs: ['a', 'b'].map((id) => ({ id, dueAt: '', productionStatus: 'Added', version: 1 })),
  };
  const e = event('job.due_changed', {
    id: 'a',
    jobIds: ['a', 'b'],
    expectedDueDates: { a: '', b: '' },
    dueAt: '2026-11-02T10:00:00Z',
    reason: 'Customer requested later pickup',
  });
  l = applyEvent(l, e);
  assert.ok(l.jobs.every((j) => j.dueHistory.length === 1 && j.version === 2));
  assert.equal(applyOperation(l, JSON.parse(JSON.stringify(e))), l); // same retry
  assert.throws(() => applyOperation(l, { ...e, id: 'retry' }), /changed elsewhere/);
  const before = l;
  assert.throws(
    () =>
      applyOperation(
        { ...l, jobs: l.jobs.map((j) => ({ ...j, productionStatus: 'Completed' })) },
        { ...e, id: 'again' },
      ),
    /active jobs/,
  );
  assert.equal(before.jobs[0].dueHistory.length, 1);
});
test('operation retries compare JSON objects independent of key order', () => {
  const e = account('a'),
    l = applyOperation(emptyLedger(), e);
  const reordered = { kind: e.kind, data: Object.fromEntries(Object.entries(e.data).reverse()), id: e.id };
  assert.equal(applyOperation(l, reordered), l);
  assert.throws(() => applyOperation(l, { ...e, data: { ...e.data, name: 'Changed' } }), /reused/);
});
test('payees archive without losing history and stale edits or duplicate names fail', () => {
  let l = applyOperation(
    emptyLedger(),
    event('payee.created', { id: 'p', name: 'Supplier', phone: '123', address: 'Market', note: '' }),
  );
  l = applyOperation(l, event('payee.archived', { id: 'p', baseVersion: 1 }));
  assert.equal(l.payees[0].archived, true);
  assert.equal(l.operationHistory.length, 2);
  assert.throws(
    () => applyOperation(l, event('payee.updated', { id: 'p', baseVersion: 1, name: 'New' })),
    /changed/,
  );
  l = applyOperation(
    l,
    event('payee.created', { id: 'p2', name: 'supplier', phone: '', address: '', note: '' }),
  );
  assert.throws(() => applyOperation(l, event('payee.restored', { id: 'p', baseVersion: 2 })), /already/);
});
test('account balances use actual cash, exclude wallet reuse and old or future movements, count voided expense payments and refunds once', () => {
  let l = applyOperation(emptyLedger(), account('bank', ['Transfer']));
  l.checkouts = [{ id: 'receipt', accountId: 'bank' }];
  l.payments = [
    { id: 'receipt', checkoutId: 'receipt', paidOn: '2026-10-31', amount: 5000, walletUsed: 3000 },
    { id: 'wallet', paidOn: '2026-10-31', amount: 0, walletUsed: 3000, accountId: 'bank' },
    { id: 'refund', amount: 0, refundId: 'r', paidOn: '2026-10-31' },
    { id: 'old', amount: 9000, paidOn: '2026-09-30', accountId: 'bank' },
    { id: 'future', amount: 9999, paidOn: '2099-01-01', accountId: 'bank' },
  ];
  l.expenses = [
    {
      description: 'Paper',
      voided: true,
      payments: [{ id: 'out', amount: 1200, paidOn: '2026-10-31', accountId: 'bank' }],
    },
  ];
  l.saleAdjustments = [
    { id: 'r', action: 'sale.refunded', refundAmount: 500, paidOn: '2026-10-31', accountId: 'bank' },
  ];
  const t = accountBalance(l, 'bank', '2026-10-31');
  assert.equal(t.balance, 13300);
  assert.equal(t.received, 5000);
  assert.equal(t.paid, 1700);
  assert.equal(defaultMoneyAccount(l, 'Transfer'), 'bank');
  assert.equal(moneyTransactions(l).filter((t) => t.id === 'refund:r').length, 1);
});
test('transfers conserve money and reconciliation rejects stale expected balance', () => {
  let l = applyOperation(applyOperation(emptyLedger(), account('a')), account('b'));
  l = applyOperation(
    l,
    event('account.transferred', {
      id: 't',
      accountId: 'a',
      toAccountId: 'b',
      amount: 3000,
      paidOn: '2026-10-31',
      reason: 'Bank deposit',
    }),
  );
  assert.equal(accountBalance(l, 'a').balance, 7000);
  assert.equal(accountBalance(l, 'b').balance, 13000);
  assert.equal(dashboardSummary(l, '2026-10-31', '2026-10-31').collected, 0);
  assert.throws(
    () =>
      applyOperation(
        l,
        event('account.reconciled', {
          id: 'bad',
          accountId: 'a',
          actualBalance: 6800,
          expectedBalance: 10000,
          paidOn: '2026-10-31',
          reason: 'Count',
        }),
      ),
    /balance changed/,
  );
  l = applyOperation(
    l,
    event('account.reconciled', {
      id: 'r',
      accountId: 'a',
      actualBalance: 6800,
      expectedBalance: 7000,
      paidOn: '2026-10-31',
      reason: 'Count',
    }),
  );
  assert.equal(accountBalance(l, 'a').balance, 6800);
});
test('historical payments require explicit assignment and cannot be counted twice', () => {
  let l = applyOperation(emptyLedger(), account('a'));
  l.payments = [{ id: 'past', amount: 2000, paidOn: '2026-10-31' }];
  assert.equal(accountBalance(l, 'a').balance, 10000);
  const e = event('account.assigned', {
    id: 'assignment',
    accountId: 'a',
    transactionId: 'payment:past',
    paidOn: '2026-10-31',
    reason: 'Verified bank statement',
  });
  l = applyOperation(l, e);
  assert.equal(accountBalance(l, 'a').balance, 12000);
  assert.equal(applyOperation(l, e), l);
  assert.throws(
    () => applyOperation(l, { ...e, id: 'other', data: { ...e.data, id: 'other' } }),
    /unassigned/,
  );
});
test('restoring archived accounts cannot claim another account’s payment default', () => {
  let l = applyOperation(emptyLedger(), account('a', ['Cash']));
  l = applyOperation(l, event('account.archived', { id: 'a', baseVersion: 1 }));
  l = applyOperation(l, account('b', ['Cash']));
  assert.throws(
    () => applyOperation(l, event('account.restored', { id: 'a', baseVersion: 2 })),
    /default account/,
  );
});
test('held payee work remains visible while independent cloud data updates', () => {
  const e = event('payee.created', { id: 'p', name: 'Local', phone: '', address: '', note: '' }),
    local = applyOperation(emptyLedger(), e);
  const projected = projectPending(emptyLedger(), {
    ledger: local,
    pending: [e],
    syncConflicts: { [e.id]: 'changed' },
  });
  assert.equal(projected.payees[0].name, 'Local');
  assert.equal(projected.operationHistory[0].id, e.id);
});
test('upgrading page access adds finance pages without re-enabling previously disabled pages', () => {
  assert.deepEqual(
    upgradePageAccess({ 1: ['Expenses', 'My Account'], 2: ['Expenses', 'Dashboard', 'My Account'] }, 2),
    { 1: ['Expenses', 'My Account'], 2: ['Expenses', 'Dashboard', 'My Account', 'Payees', 'Accounts'] },
  );
});
test('daily trends stay daily for longer periods and separate incurred and paid dates', () => {
  const l = emptyLedger();
  l.jobs = [{ createdAt: '2026-10-01', amount: 1000 }];
  l.expenses = [{ incurredOn: '2026-10-01', amount: 700, payments: [{ paidOn: '2026-10-02', amount: 200 }] }];
  const s = dashboardSummary(l, '2026-08-01', '2026-10-31', 'daily');
  assert.equal(s.trend.length, 92);
  assert.equal(s.trend.find((t) => t.date === '2026-10-01').netIncome, 300);
  assert.equal(s.trend.find((t) => t.date === '2026-10-02').expenses, 200);
});

test('keeping the business version clears rejected finance records and restores due dates', () => {
  const cloud = { ...emptyLedger(), jobs: [{ id: 'j', dueAt: '', productionStatus: 'Added', version: 1 }] };
  const e = event('job.due_changed', {
    id: 'j',
    jobIds: ['j'],
    expectedDueDates: { j: '' },
    dueAt: '2026-11-02T10:00:00Z',
    reason: 'Later',
  });
  const state = { ledger: applyOperation(cloud, e), pending: [e], syncConflicts: { [e.id]: 'stale' } };
  const next = acknowledgeReviews(state, cloud, [{ event_id: e.id, source: e, replacements: [] }]);
  assert.equal(next.ledger.jobs[0].dueAt, '');
  assert.equal(next.pending.length, 0);
  const create = event('payee.created', { id: 'p', name: 'Rejected', phone: '', address: '', note: '' });
  const rejected = {
    ledger: applyOperation(emptyLedger(), create),
    pending: [create],
    syncConflicts: { [create.id]: 'duplicate' },
  };
  const clean = acknowledgeReviews(rejected, emptyLedger(), [
    { event_id: create.id, source: create, replacements: [] },
  ]);
  assert.equal(clean.ledger.payees.length, 0);
  assert.equal(clean.ledger.operationHistory.length, 0);
});

test('historical movements before opening remain visible without being counted twice', () => {
  let l = applyOperation(emptyLedger(), account('bank'));
  l.payments = [
    { id: 'old', amount: 5000, paidOn: '2026-09-01' },
    { id: 'new', amount: 2000, paidOn: '2026-10-31', accountId: 'bank' },
  ];
  l.accountEntries = [
    {
      id: 'import',
      action: 'assignment',
      transactionId: 'payment:old',
      accountId: 'bank',
      paidOn: '2026-09-01',
    },
  ];
  const result = accountBalance(l, 'bank', '2026-10-31');
  assert.equal(result.balance, 12000);
  assert.equal(result.received, 2000);
  assert.equal(result.transactions.length, 2);
});
test('personal expense payments are identified separately from unassigned business movements', () => {
  const l = emptyLedger();
  l.expenses = [
    {
      description: 'Personal purchase',
      payments: [{ id: 'p', amount: 100, paidOn: '2026-10-31', source: 'Personal funds' }],
    },
  ];
  assert.equal(moneyTransactions(l)[0].personal, true);
});
