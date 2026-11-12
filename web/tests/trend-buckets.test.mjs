import test from 'node:test';
import assert from 'node:assert/strict';
import { autoGrouping, groupTrend } from '../src/trend-buckets.mjs';

const days = (n, start = '2026-10-01') =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), sales: 100, collected: 50 };
  });

test('trend: days when they fit, else weeks, else months; groups add up', () => {
  assert.equal(autoGrouping(days(7), 10), 'day');
  assert.equal(autoGrouping(days(30), 10), 'week');
  assert.equal(autoGrouping(days(200), 10), 'month');
  const weeks = groupTrend(days(14), 'week');
  assert.equal(
    weeks.reduce((t, w) => t + w.sales, 0),
    1400,
  );
  assert.equal(weeks[0].date, '2026-09-28'); // Monday of the week 1 Oct falls in
  const months = groupTrend(days(61), 'month');
  assert.deepEqual(
    months.map((m) => [m.label, m.sales]),
    [
      ['Oct 26', 3100],
      ['Nov 26', 3000],
    ],
  );
});
