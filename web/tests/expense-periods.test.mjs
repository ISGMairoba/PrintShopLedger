import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coversFor,
  expenseShare,
  paidInAdvance,
  periodEnd,
  validCategoryPeriods,
  validCovers,
} from '../src/expense-periods.mjs';
import { validateOptions } from '../src/business-options.mjs';

test('Periods: a year from 1 Jan ends 31 Dec; a month from 31 Jan ends 28 Feb', () => {
  assert.equal(periodEnd('2026-01-01', 12), '2026-12-31');
  assert.equal(periodEnd('2026-01-31', 1), '2026-02-27');
  assert.equal(periodEnd('2026-03-15', 1), '2026-04-14');
  assert.deepEqual(coversFor('2026-01-01', 0), null);
  assert.throws(() => validCovers({ from: '2026-02-01', to: '2026-01-01' }, '2026-01-01'), /end on or after/);
  assert.throws(() => validCovers({ from: '2026-01-01', to: '2030-01-01' }, '2026-01-01'), /3 years/);
  assert.equal(validCovers({ from: '2026-01-05', to: '2026-01-05' }, '2026-01-05'), null);
});

test('Profit spreads an expense by day over what it covers; the parts add up exactly', () => {
  // ₦365,000 rent for 2026: ₦1,000 a day.
  const rent = {
    amount: 36500000,
    incurredOn: '2026-01-01',
    covers: { from: '2026-01-01', to: '2026-12-31' },
  };
  assert.equal(expenseShare(rent, '2026-01-01', '2026-01-31'), 3100000);
  assert.equal(expenseShare(rent, '2026-02-01', '2026-02-28'), 2800000);
  assert.equal(expenseShare(rent, '2025-12-01', '2025-12-31'), 0);
  let sum = 0;
  for (let m = 1; m <= 12; m++) {
    const from = `2026-${String(m).padStart(2, '0')}-01`;
    sum += expenseShare(rent, from, periodEnd(from, 1));
  }
  assert.equal(sum, rent.amount, 'every kobo counted once over the year');
  // Odd amounts: parts still add up.
  const odd = { amount: 1000001, incurredOn: '2026-01-01', covers: { from: '2026-01-01', to: '2026-01-03' } };
  assert.equal(
    expenseShare(odd, '2026-01-01', '2026-01-01') +
      expenseShare(odd, '2026-01-02', '2026-01-02') +
      expenseShare(odd, '2026-01-03', '2026-01-03'),
    1000001,
  );
  // An ordinary expense: all on its day.
  assert.equal(expenseShare({ amount: 500, incurredOn: '2026-03-02' }, '2026-03-01', '2026-03-31'), 500);
  // Paid in advance at the end of January: the other 11 months.
  assert.equal(paidInAdvance([rent], '2026-01-31'), 36500000 - 3100000);
  assert.equal(paidInAdvance([rent], '2026-12-31'), 0);
});

test('Usual period per category: starter defaults, only allowed choices', () => {
  const o = validateOptions({});
  assert.equal(o.categoryPeriods.Rent, 12);
  assert.equal(o.categoryPeriods.Wages, 1);
  assert.deepEqual(validCategoryPeriods({ Rent: 12, Fuel: 0, Odd: 5, Salaries: 1 }), {
    Rent: 12,
    Salaries: 1,
  });
});
