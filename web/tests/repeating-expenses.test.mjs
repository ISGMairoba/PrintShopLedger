import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { applyOperation, operationEvent } from '../src/operations.mjs';
import { dueRepeats, nextDate } from '../src/repeating-expenses.mjs';

const actor = { id: 'u', label: 'Owner' };
const ev = (kind, data) => operationEvent(kind, data, actor, '2026-11-08T10:00:00Z');

test('next dates keep the day of the month', () => {
  assert.equal(nextDate('2026-01-31', 'month'), '2026-02-28');
  assert.equal(nextDate('2026-02-28', 'month', 31), '2026-03-31');
  assert.equal(nextDate('2026-11-08', 'week'), '2026-11-15');
  assert.equal(nextDate('2028-02-29', 'year'), '2029-02-28');
});

test('repeating expenses wait to be recorded or skipped, then move to the next date', () => {
  let l = emptyLedger();
  l = applyOperation(
    l,
    ev('repeat.created', {
      id: 'rent',
      description: 'Shop rent',
      category: 'Rent',
      amount: 15000000,
      every: 'month',
      nextDue: '2026-10-31',
    }),
  );
  assert.equal(dueRepeats(l, '2026-11-08').length, 1);
  l = applyOperation(
    l,
    ev('repeat.done', { id: 'rent', baseVersion: 1, dueOn: '2026-10-31', action: 'skipped' }),
  );
  let r = l.repeatingExpenses[0];
  assert.equal(r.nextDue, '2026-11-30');
  assert.equal(r.history[0].action, 'skipped');
  assert.equal(dueRepeats(l, '2026-11-08').length, 0);
  assert.throws(
    () =>
      applyOperation(
        l,
        ev('repeat.done', { id: 'rent', baseVersion: 2, dueOn: '2026-10-31', action: 'skipped' }),
      ),
    /already/,
  );
  assert.throws(
    () =>
      applyOperation(
        l,
        ev('repeat.done', {
          id: 'rent',
          baseVersion: 2,
          dueOn: '2026-11-30',
          action: 'recorded',
          expenseId: 'nope',
        }),
      ),
    /Save the expense/,
  );
  l = { ...l, expenses: [{ id: 'e1', amount: 16000000 }] };
  l = applyOperation(
    l,
    ev('repeat.done', {
      id: 'rent',
      baseVersion: 2,
      dueOn: '2026-11-30',
      action: 'recorded',
      expenseId: 'e1',
    }),
  );
  r = l.repeatingExpenses[0];
  assert.equal(r.nextDue, '2026-12-31'); // keeps the 31st
  assert.equal(r.amount, 16000000); // remembers the last amount
  l = applyOperation(l, ev('repeat.updated', { id: 'rent', baseVersion: 3, status: 'paused' }));
  assert.equal(dueRepeats(l, '2027-06-01').length, 0);
  assert.throws(
    () =>
      applyOperation(
        l,
        ev('repeat.created', {
          id: 'x',
          description: '',
          category: 'Rent',
          every: 'month',
          nextDue: '2026-11-01',
        }),
      ),
    /Description/,
  );
});

test('repeating expenses: the expense for a due date gets the same id on every device', async () => {
  const { repeatExpenseId } = await import('../src/repeating-expenses.mjs');
  const a = await repeatExpenseId('r1', '2026-12-01');
  assert.equal(a, await repeatExpenseId('r1', '2026-12-01'));
  assert.notEqual(a, await repeatExpenseId('r1', '2027-01-01'));
  assert.notEqual(a, await repeatExpenseId('r2', '2026-12-01'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
