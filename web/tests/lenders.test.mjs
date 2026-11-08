import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { applyOperation, operationEvent } from '../src/operations.mjs';
import { lenderIds, lenderSummary, repaymentsDue } from '../src/lenders.mjs';
import { payeeStatement, payeeStatementSections } from '../src/reports.mjs';

const actor = { id: 'u', label: 'Owner' };
const ev = (kind, data) => operationEvent(kind, data, actor, '2026-11-08T10:00:00Z');

test('lenders: loans owed, statement and repayment reminders', () => {
  let l = emptyLedger();
  l = applyOperation(
    l,
    ev('account.created', {
      id: 'bank',
      name: 'Bank',
      accountType: 'bank',
      openingBalance: 0,
      openingDate: '2026-10-01',
      methods: [],
    }),
  );
  l = applyOperation(
    l,
    ev('payee.created', { id: 'mp', name: 'Moniepoint', phone: '', address: '', note: '' }),
  );
  l = applyOperation(
    l,
    ev('payee.created', { id: 'sup', name: 'Paper supplier', phone: '', address: '', note: '' }),
  );
  const move = (id, moneyType, amount, paidOn) =>
    (l = applyOperation(
      l,
      ev('account.money_moved', {
        id,
        accountId: 'bank',
        paidOn,
        reason: 'Loan',
        moneyType,
        amount,
        lenderId: 'mp',
      }),
    ));
  move('a', 'loan_in', 1000000, '2026-10-05');
  move('b', 'loan_repayment', 200000, '2026-11-02');
  assert.deepEqual([...lenderIds(l)], ['mp']);
  const s = lenderSummary(l, 'mp', '2026-11-01', '2026-11-30');
  assert.equal(s.owed, 800000);
  assert.equal(s.repaidInPeriod, 200000);
  assert.equal(s.borrowedInPeriod, 0);
  l = applyOperation(
    l,
    ev('payee.updated', {
      id: 'mp',
      baseVersion: 1,
      name: 'Moniepoint',
      phone: '',
      address: '',
      note: '',
      repaymentDue: '2026-11-10',
    }),
  );
  assert.equal(repaymentsDue(l, '2026-11-08')[0].name, 'Moniepoint');
  assert.equal(repaymentsDue(l, '2026-11-01').length, 0);
  // Editing without the date keeps it.
  l = applyOperation(
    l,
    ev('payee.updated', {
      id: 'mp',
      baseVersion: 2,
      name: 'Moniepoint',
      phone: '0803',
      address: '',
      note: '',
    }),
  );
  assert.equal(l.payees.find((p) => p.id === 'mp').repaymentDue, '2026-11-10');
  assert.throws(
    () =>
      applyOperation(
        l,
        ev('payee.updated', {
          id: 'mp',
          baseVersion: 3,
          name: 'Moniepoint',
          phone: '',
          address: '',
          note: '',
          repaymentDue: 'soon',
        }),
      ),
    /date/,
  );
  const st = payeeStatement(l, 'mp', '2026-11-01', '2026-11-30');
  assert.equal(st.loans.owed, 800000);
  assert.ok(payeeStatementSections(st).some((x) => x.title === 'Loans in this period'));
  assert.equal(payeeStatement(l, 'sup', '2026-11-01', '2026-11-30').loans, undefined);
});
