// Reports → Profit: what each job sold for and its estimated cost, from the costs the business set:
// * a pricing-template job: the template's estimated expenses at the sale (its snapshot);
// * a service with a cost (Pricing Templates → Costs): that cost per unit × the amount used;
// * otherwise the cost linked to its material (fixed, or the materials confirmed in production);
// * plus materials added in production, unless their cost is already in the price.
// Jobs with no cost to go on are counted separately, so the profit is never guessed.
import { moneyMoveTotals } from './money-moves.mjs';
import { businessDay } from './dashboard.mjs';
import { extraMaterialsCost, extraUsages } from './production-materials.mjs';

/** Kobo per unit of a material, from an active cost linked to it; null when none is set. */
export function materialUnitCost(ledger, materialId) {
  const costed = ledger.services.find(
    (s) => s.materialId === materialId && !s.archived && s.costing?.amount != null,
  );
  return costed ? costed.costing.amount / (costed.costing.per || 1) : null;
}

/**
 * The estimated cost of one job (kobo), and whether every part of it had a cost to go on.
 * @returns {{ kobo: number, known: boolean, basis: string }}
 */
export function jobCost(ledger, job) {
  // Costs as they were when the job was sold (stamped by the business). Where none was set yet,
  // or for older jobs, today's cost is used, so costs added later still count.
  const rates = job.costRates;
  const unitCost = (materialId) => rates?.materials?.[materialId] ?? materialUnitCost(ledger, materialId);
  let kobo = 0,
    known = true,
    basis;
  if (job.templateSnapshot) {
    kobo = Math.round(Number(job.templateSnapshot.price?.cost ?? NaN) * 100);
    if (!Number.isFinite(kobo)) (kobo = 0), (known = false);
    basis = 'Template estimate';
  } else {
    const service = ledger.services.find((s) => s.id === job.serviceId);
    const used = job.materialNeeded > 0 ? job.materialNeeded : (job.quantity ?? 1);
    const serviceRate =
      rates?.service != null
        ? rates.service
        : service?.costing?.amount != null
          ? service.costing.amount / (service.costing.per || 1)
          : null;
    if (serviceRate != null) {
      kobo = used * serviceRate;
      basis = 'Service cost';
    } else if (job.materialId) {
      const rate = unitCost(job.materialId);
      if (rate === null) known = false;
      else kobo = used * rate;
      basis = 'Material cost';
    } else if (job.materialChoice) {
      const usages = job.materialUsed?.usages?.length
        ? job.materialUsed.usages
        : [
            {
              materialId: job.materialChoice.plannedMaterialId ?? job.materialChoice.options[0],
              quantity: job.materialChoice.work,
            },
          ];
      for (const u of usages) {
        const rate = unitCost(u.materialId);
        if (rate === null) known = false;
        else kobo += u.quantity * rate;
      }
      basis = job.materialUsed ? 'Materials confirmed' : 'Materials planned';
    } else {
      known = false;
      basis = 'No cost set';
    }
  }
  if (extraUsages(job).length && !job.extraMaterials?.costCovered) {
    const extra = extraMaterialsCost(ledger, extraUsages(job));
    kobo += extra.kobo;
    if (extra.unpriced.length) known = false;
  }
  return { kobo: Math.round(kobo), known, basis };
}

/** Profit for jobs sold from `from` to `to` (Lagos days); cancelled jobs are left out. */
export function profitReport(ledger, from, to) {
  const rows = [];
  for (const job of ledger.jobs) {
    if (job.productionStatus === 'Cancelled') continue;
    const day = businessDay(job.createdAt);
    if (day < from || day > to) continue;
    const cost = jobCost(ledger, job);
    rows.push({
      id: job.id,
      day,
      item: job.templateSnapshot?.template?.name ?? job.service ?? 'Job',
      description: job.description,
      revenue: job.amount,
      cost: cost.kobo,
      known: cost.known,
      basis: cost.basis,
      profit: job.amount - cost.kobo,
    });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.item.localeCompare(b.item));
  const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
  const knownRows = rows.filter((r) => r.known);
  const byItem = new Map();
  for (const r of rows) {
    const g = byItem.get(r.item) ?? { item: r.item, jobs: 0, revenue: 0, cost: 0, profit: 0, unknown: 0 };
    g.jobs += 1;
    if (r.known) {
      g.revenue += r.revenue;
      g.cost += r.cost;
      g.profit += r.profit;
    } else g.unknown += 1;
    byItem.set(r.item, g);
  }
  const revenue = sum(knownRows, 'revenue'),
    profit = sum(knownRows, 'profit');
  return {
    from,
    to,
    totals: {
      jobs: rows.length,
      revenue,
      cost: sum(knownRows, 'cost'),
      profit,
      margin: revenue ? Math.round((profit / revenue) * 1000) / 10 : null,
      unknownJobs: rows.length - knownRows.length,
      unknownRevenue: sum(rows, 'revenue') - revenue,
      // The part of those jobs' cost that is known (a job can be partly costed).
      partialCost: sum(rows, 'cost') - sum(knownRows, 'cost'),
      // Gifts, grants and other money that is not a sale (Accounts → Money in / out).
      otherIncome: moneyMoveTotals(ledger, from, to).other_income,
    },
    byItem: [...byItem.values()].sort((a, b) => b.profit - a.profit || a.item.localeCompare(b.item)),
    jobs: rows,
  };
}

/** The profit report as sections for CSV and PDF. */
export function profitSections(report, { money, unit = ' (NGN)' }) {
  const t = report.totals;
  return [
    {
      title: 'Summary',
      columns: ['Item', 'Value'],
      widths: [3, 2],
      numeric: [1],
      rows: [
        ['Period', `${report.from} to ${report.to}`],
        ['Jobs sold', t.jobs],
        [`Sales with a known cost${unit}`, money(t.revenue)],
        [`Estimated cost${unit}`, money(t.cost)],
        [`Estimated profit${unit}`, money(t.profit)],
        ['Margin', t.margin === null ? '—' : `${t.margin}%`],
        ['Jobs with no cost set', t.unknownJobs],
        [`Their sales (not in the profit)${unit}`, money(t.unknownRevenue)],
        [`Other income: gifts, grants (not in the profit)${unit}`, money(t.otherIncome ?? 0)],
      ],
    },
    {
      title: 'By service or template',
      columns: ['Service / template', 'Jobs', `Sales${unit}`, `Cost${unit}`, `Profit${unit}`, 'No cost set'],
      widths: [30, 8, 14, 14, 14, 10],
      numeric: [1, 2, 3, 4, 5],
      rows: report.byItem.map((g) => [
        g.item,
        g.jobs,
        money(g.revenue),
        money(g.cost),
        money(g.profit),
        g.unknown,
      ]),
    },
    {
      title: 'Jobs',
      columns: [
        'Date',
        'Service / template',
        'Description',
        `Sale${unit}`,
        `Cost${unit}`,
        `Profit${unit}`,
        'Cost from',
      ],
      widths: [10, 18, 26, 11, 11, 11, 13],
      numeric: [3, 4, 5],
      rows: report.jobs.map((r) => [
        r.day,
        r.item,
        r.description,
        money(r.revenue),
        r.known ? money(r.cost) : '—',
        r.known ? money(r.profit) : '—',
        r.basis,
      ]),
    },
  ];
}
