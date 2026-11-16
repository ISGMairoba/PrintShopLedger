// Reports → Profit & loss: did the business make money in a period, after its running costs?
//   Sales (after discounts) − actual cost of goods used − waste − late cost adjustments = gross profit
//   − operating expenses (by category) + other income (gifts, grants) = net profit
// Expenses that bought materials into stock are left out: their cost reaches the jobs that use the
// materials (job costs), so counting the purchase as well would count it twice. They are listed
// for reference. Loans and owner money are neither income nor expenses (Accounts → Money in / out);
// loan interest is an ordinary expense. Compared with the period just before, of the same length.
import { profitReport } from './profit.mjs';
import { lateCostsIn, wasteCost } from './actual-cost.mjs';
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
  // Actual cost of goods used: the stock jobs really took at actual cost (the estimate for jobs that
  // took no stock), plus expenses linked to them. Every known part counts.
  const jobCost = jobs.totals.actualCostAll;
  const estimatedJobCost = jobs.totals.cost + jobs.totals.partialCost;
  const waste = wasteCost(ledger, from, to);
  const lateCost = Math.round(lateCostsIn(ledger, from, to).reduce((n, c) => n + c.amount, 0));
  const categories = new Map();
  let stockPurchases = 0,
    linkedToOrders = 0,
    linkedToRestocks = 0;
  for (const e of ledger.expenses) {
    if (e.voided) continue;
    const day = e.incurredOn;
    if (day < from || day > to) continue;
    if (e.materials?.length) {
      stockPurchases += e.amount;
      continue;
    }
    // For restocks (delivery, clearance…): part of the stock's cost, reaching jobs as stock is used.
    if (e.restockIds?.length) {
      linkedToRestocks += e.amount;
      continue;
    }
    // Linked to orders: counted in those orders' cost (job costs) instead.
    if (e.jobIds?.some((id) => ledger.jobs.some((j) => j.id === id && j.productionStatus !== 'Cancelled'))) {
      linkedToOrders += e.amount;
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
    grossProfit: sales - jobCost - waste.kobo - lateCost,
    expenses,
    operating,
    otherIncome,
    net: sales - jobCost - waste.kobo - lateCost - operating + otherIncome,
    estimatedJobCost,
    waste: waste.kobo,
    lateCost,
    linkedToRestocks,
    provisionalJobs: jobs.totals.provisionalJobs,
    stockPurchases,
    linkedToOrders,
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
        ['Cost of goods used (actual)', money(-r.jobCost), money(-p.jobCost)],
        ['Waste and damage (not on a job)', money(-r.waste), money(-p.waste)],
        ['Late cost adjustments', money(-r.lateCost), money(-p.lateCost)],
        ['Gross profit', money(r.grossProfit), prevOf('grossProfit')],
        ...categories.map((c) => [
          `Expenses: ${c}`,
          money(-amountIn(r.expenses, c)),
          money(-amountIn(p.expenses, c)),
        ]),
        ['Total expenses', money(-r.operating), money(-p.operating)],
        ['Other income (gifts, grants)', money(r.otherIncome), prevOf('otherIncome')],
        ['Net profit', money(r.net), prevOf('net')],
        [
          'For reference: materials bought into stock (not counted above)',
          money(r.stockPurchases),
          prevOf('stockPurchases'),
        ],
        [
          'For reference: expenses linked to orders (counted in their job costs)',
          money(r.linkedToOrders),
          prevOf('linkedToOrders'),
        ],
        [
          'For reference: expenses for restocks (in the stock cost above)',
          money(r.linkedToRestocks),
          prevOf('linkedToRestocks'),
        ],
        [
          'For reference: estimated cost of the same jobs',
          money(r.estimatedJobCost),
          prevOf('estimatedJobCost'),
        ],
        ['Jobs not fully costed (only their known costs are counted)', r.unknownJobs, p.unknownJobs],
        ['Jobs with materials not yet confirmed (provisional)', r.provisionalJobs, p.provisionalJobs],
      ],
    },
  ];
}
