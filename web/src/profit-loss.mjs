// Reports → Profit & loss: did the business make money in a period, after its running costs?
//   Sales (after discounts) − estimated cost of jobs = gross profit
//   − operating expenses (by category) + other income (gifts, grants) = net profit
// Expenses that bought materials into stock are left out: their cost reaches the jobs that use the
// materials (job costs), so counting the purchase as well would count it twice. They are listed
// for reference. Loans and owner money are neither income nor expenses (Accounts → Money in / out);
// loan interest is an ordinary expense. Compared with the period just before, of the same length.
import { profitReport } from './profit.mjs';
import { moneyMoveTotals } from './money-moves.mjs';

const DAY = 86400000;
const shift = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** The period of the same length just before [from, to]. */
export function previousPeriod(from, to) {
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) + 1;
  return { from: shift(from, -days), to: shift(from, -1) };
}

function period(ledger, from, to) {
  const jobs = profitReport(ledger, from, to);
  const sales = jobs.jobs.reduce((n, r) => n + r.revenue, 0);
  const jobCost = jobs.totals.cost;
  const categories = new Map();
  let stockPurchases = 0;
  for (const e of ledger.expenses) {
    if (e.voided) continue;
    const day = e.incurredOn;
    if (day < from || day > to) continue;
    if (e.materials?.length) {
      stockPurchases += e.amount;
      continue;
    }
    categories.set(e.category, (categories.get(e.category) ?? 0) + e.amount);
  }
  const expenses = [...categories].map(([category, amount]) => ({ category, amount }));
  expenses.sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  const operating = expenses.reduce((n, x) => n + x.amount, 0);
  const otherIncome = moneyMoveTotals(ledger, from, to).other_income;
  return {
    from,
    to,
    sales,
    jobCost,
    grossProfit: sales - jobCost,
    expenses,
    operating,
    otherIncome,
    net: sales - jobCost - operating + otherIncome,
    stockPurchases,
    unknownJobs: jobs.totals.unknownJobs,
    unknownSales: jobs.totals.unknownRevenue,
  };
}

/** Profit & loss for [from, to] and the period before it. */
export function profitLoss(ledger, from, to) {
  const prev = previousPeriod(from, to);
  return { ...period(ledger, from, to), previous: period(ledger, prev.from, prev.to) };
}

/** As sections for the spreadsheet and PDF. */
export function profitLossSections(r, { money, unit = ' (NGN)' }) {
  const p = r.previous;
  const prevOf = (key) => money(p[key]);
  const categories = [...new Set([...r.expenses, ...p.expenses].map((x) => x.category))];
  const amountIn = (list, c) => list.find((x) => x.category === c)?.amount ?? 0;
  return [
    {
      title: 'Profit and loss',
      columns: ['', `${r.from} to ${r.to}${unit}`, `${p.from} to ${p.to}${unit}`],
      widths: [3, 2, 2],
      numeric: [1, 2],
      rows: [
        ['Sales (after discounts)', money(r.sales), prevOf('sales')],
        ['Estimated cost of jobs', money(-r.jobCost), money(-p.jobCost)],
        ['Gross profit', money(r.grossProfit), prevOf('grossProfit')],
        ...categories.map((c) => [`Expenses: ${c}`, money(-amountIn(r.expenses, c)), money(-amountIn(p.expenses, c))]),
        ['Total expenses', money(-r.operating), money(-p.operating)],
        ['Other income (gifts, grants)', money(r.otherIncome), prevOf('otherIncome')],
        ['Net profit', money(r.net), prevOf('net')],
        ['For reference: materials bought into stock (not counted above)', money(r.stockPurchases), prevOf('stockPurchases')],
        ['Jobs with no cost set (their sales are counted with no cost)', r.unknownJobs, p.unknownJobs],
      ],
    },
  ];
}
