// Reports → Profit & loss: did the business make money in a period, after its running costs?
//   Sales (after discounts) − cost of goods used − waste − cancelled order losses − late cost
//   adjustments (Actual only) = gross profit. The cost of goods is estimated (cost prices) or actual,
//   by the business's cost method.
//   − operating expenses (by category) + other income (gifts, grants) = net profit
// Expenses that bought materials into stock are left out: their cost reaches the jobs that use the
// materials (job costs), so counting the purchase as well would count it twice. They are listed
// for reference. Loans and owner money are neither income nor expenses (Accounts → Money in / out);
// loan interest is an ordinary expense. Compared with the period just before, of the same length.
import { materialUnitCost, profitReport } from './profit.mjs';
import { lateCostsIn, stockValuation, wasteCost } from './actual-cost.mjs';
import { businessDay } from './dashboard.mjs';
import { expenseShare, paidInAdvance } from './expense-periods.mjs';
import { moneyMoveTotals } from './money-moves.mjs';

const DAY = 86400000;
const shift = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** The period of the same length just before [from, to]. */
export function previousPeriod(from, to) {
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) + 1;
  return { from: shift(from, -days), to: shift(from, -1) };
}

/**
 * Stock taken from `from` to `to` (Lagos days) by the history lines `pick` chooses, at each line's cost:
 * the material's cost price (Estimated) or what it really cost at that moment (Actual).
 */
function takenCost(ledger, from, to, method, pick) {
  const valuation = method === 'actual' ? stockValuation(ledger) : null;
  let kobo = 0,
    unknown = 0;
  for (const h of ledger.materialHistory ?? []) {
    if (!pick(h)) continue;
    const day = businessDay(h.changedAt);
    if (day < from || day > to) continue;
    const rate = valuation
      ? (valuation.get(h.materialId)?.unitCost.get(h.id) ?? null)
      : materialUnitCost(ledger, h.materialId);
    const taken = (h.beforeAvailable ?? 0) - (h.afterAvailable ?? 0);
    if (rate === null) unknown += taken ? 1 : 0;
    else kobo += taken * rate;
  }
  return { kobo: Math.round(kobo), unknown };
}

function period(ledger, from, to, method) {
  const jobs = profitReport(ledger, from, to);
  const sales = jobs.jobs.reduce((n, r) => n + r.revenue, 0);
  // Cost of goods used. Actual: the stock jobs really took at actual cost (the estimate for jobs that
  // took no stock), plus expenses linked to them. Estimated: each job's estimate (cost prices). Every
  // known part counts.
  const estimatedJobCost = jobs.totals.cost + jobs.totals.partialCost;
  const jobCost = method === 'actual' ? jobs.totals.actualCostAll : estimatedJobCost;
  const waste =
    method === 'actual'
      ? wasteCost(ledger, from, to)
      : takenCost(ledger, from, to, method, (h) => h.action === 'material.wasted' && !h.jobId);
  // Late delivery bills only exist where stock is costed from what it really cost.
  const lateCost =
    method === 'actual' ? Math.round(lateCostsIn(ledger, from, to).reduce((n, c) => n + c.amount, 0)) : 0;
  // Cancelled orders: material they used and didn't give back (decision 6, plans/actual-cost-v2.md).
  const cancelled = new Set(
    (ledger.jobs ?? []).filter((j) => j.productionStatus === 'Cancelled').map((j) => j.id),
  );
  const cancelledLoss = Math.max(
    0,
    takenCost(ledger, from, to, method, (h) => !!h.jobId && cancelled.has(h.jobId)).kobo,
  );
  const categories = new Map();
  let stockPurchases = 0,
    linkedToOrders = 0,
    linkedToRestocks = 0;
  for (const e of ledger.expenses) {
    if (e.voided) continue;
    // Spread over the period it covers (rent for a year…), else on its day; linked costs on their day.
    const share = expenseShare(e, from, to);
    const day = e.incurredOn;
    const onDay = day >= from && day <= to;
    if (!share && !onDay) continue;
    if (e.materials?.length) {
      if (!onDay) continue;
      stockPurchases += e.amount;
      continue;
    }
    // For restocks (delivery, clearance…): part of the stock's cost, reaching jobs as stock is used.
    if (e.restockIds?.length) {
      if (!onDay) continue;
      linkedToRestocks += e.amount;
      continue;
    }
    // Linked to orders: counted in those orders' cost (job costs) instead.
    if (e.jobIds?.some((id) => ledger.jobs.some((j) => j.id === id && j.productionStatus !== 'Cancelled'))) {
      if (!onDay) continue;
      linkedToOrders += e.amount;
      continue;
    }
    if (share) categories.set(e.category, (categories.get(e.category) ?? 0) + share);
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
    method,
    grossProfit: sales - jobCost - waste.kobo - lateCost - cancelledLoss,
    cancelledLoss,
    expenses,
    operating,
    otherIncome,
    net: sales - jobCost - waste.kobo - lateCost - cancelledLoss - operating + otherIncome,
    estimatedJobCost,
    waste: waste.kobo,
    lateCost,
    linkedToRestocks,
    // Paid by the end of the period for later periods (the rest of a year's rent…).
    paidInAdvance: paidInAdvance(
      ledger.expenses.filter((e) => !e.materials?.length && !e.restockIds?.length && !e.jobIds?.length),
      to,
    ),
    spreadExpenses: ledger.expenses.filter((e) => !e.voided && e.covers && expenseShare(e, from, to)).length,
    provisionalJobs: jobs.totals.provisionalJobs,
    stockPurchases,
    linkedToOrders,
    unknownJobs: jobs.totals.unknownJobs,
    unknownSales: jobs.totals.unknownRevenue,
  };
}

/**
 * Profit & loss for [from, to] and the period before it, by the business's cost method
 * ('estimated', the default, or 'actual').
 */
export function profitLoss(ledger, from, to, method = 'estimated') {
  const prev = previousPeriod(from, to);
  return { ...period(ledger, from, to, method), previous: period(ledger, prev.from, prev.to, method) };
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
        [
          r.method === 'actual' ? 'Cost of goods used (actual)' : 'Cost of goods used (estimated)',
          money(-r.jobCost),
          money(-p.jobCost),
        ],
        ['Waste and damage (not on a job)', money(-r.waste), money(-p.waste)],
        ['Cancelled order losses', money(-r.cancelledLoss), money(-p.cancelledLoss)],
        ...(r.method === 'actual'
          ? [['Late cost adjustments', money(-r.lateCost), money(-p.lateCost)]]
          : []),
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
        ['For reference: paid in advance for later periods', money(r.paidInAdvance), prevOf('paidInAdvance')],
        ...(r.method === 'actual'
          ? [
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
            ]
          : []),
        ['Jobs not fully costed (only their known costs are counted)', r.unknownJobs, p.unknownJobs],
        ['Jobs with materials not yet confirmed (provisional)', r.provisionalJobs, p.provisionalJobs],
      ],
    },
  ];
}
