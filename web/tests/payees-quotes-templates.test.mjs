import test from 'node:test';
import assert from 'node:assert/strict';
import { payeeStatement, payeeListSections } from '../src/reports.mjs';
import { suggestQuantities } from '../src/pricing-templates.mjs';
import { applyQuotationEvent } from '../src/quotations.mjs';
import { normalizeLedger } from '../src/materials.mjs';
import { emptyLedger } from '../src/domain.mjs';

const pay = (amount, paidOn) => ({
  id: `p${amount}${paidOn}`,
  amount,
  paidOn,
  method: 'Cash',
  source: 'Business cash',
  reference: '',
});
const expense = (id, incurredOn, amount, payments, extra = {}) => ({
  id,
  payeeId: 'pay1',
  description: id,
  category: 'Materials',
  incurredOn,
  amount,
  payments,
  voided: false,
  ...extra,
});
const ledger = {
  ...emptyLedger(),
  payees: [{ id: 'pay1', name: 'Paper House', phone: '080', address: 'Kano', archived: false }],
  expenses: [
    expense('a', '2026-10-01', 10000, [pay(4000, '2026-10-01')]),
    expense('b', '2026-11-02', 5000, [pay(5000, '2026-11-03')]),
    expense('c', '2026-11-03', 3000, [pay(1000, '2026-11-03')], { voided: true }),
  ],
};

test('payee statement: period spending and payments, and everything still owed', () => {
  const s = payeeStatement(ledger, 'pay1', '2026-11-01', '2026-11-30');
  assert.equal(s.expenses.length, 2);
  assert.equal(s.totals.incurred, 5000, 'Voided expenses count as zero');
  assert.equal(s.totals.paid, 6000, 'Payments of a voided expense still show');
  assert.equal(s.totals.owedNow, 6000, 'The October expense is still owed');
  assert.equal(s.earlierOwing.length, 1);
  const [list] = payeeListSections(ledger);
  assert.deepEqual(list.rows[0].slice(0, 7), ['Paper House', '080', 'Kano', 2, '150.00', '100.00', '60.00']);
});

test('compare suggests the quantity being priced, price tiers, then print-run steps', () => {
  assert.deepEqual(suggestQuantities(1), [1, 2, 5, 10, 20]);
  assert.deepEqual(
    suggestQuantities(50, {}, [{ priceTiers: [{ from: 100 }, { from: 500 }] }]),
    [50, 100, 200, 500, 1000],
  );
  assert.deepEqual(suggestQuantities(30, { max: 100 }), [30, 50, 100]);
});

test('a deleted quotation disappears, and one that became an order cannot be deleted', () => {
  const quote = { id: 'q1', status: 'open', version: 1, lines: [], createdBy: 'u1' };
  const base = { ...emptyLedger(), quotations: [quote, { ...quote, id: 'q2', status: 'converted' }] };
  const event = (id) => ({
    id: `e-${id}`,
    kind: 'quotation.deleted',
    data: { id, modifiedBy: 'u1', modifiedByLabel: 'U', modifiedAt: '2026-11-05T10:00:00Z' },
  });
  const after = applyQuotationEvent(base, event('q1'));
  assert.deepEqual(
    after.quotations.map((q) => q.id),
    ['q2'],
  );
  assert.throws(() => applyQuotationEvent(base, event('q2')), /cannot be deleted/);
  assert.equal(normalizeLedger({ quotations: [{ ...quote, status: 'deleted' }] }).quotations.length, 0);
});
