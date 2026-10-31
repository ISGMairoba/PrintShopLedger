import PeriodFilter, { usePeriod } from './PeriodFilter';
import { stockLevel } from './material-display.mjs';
import { useMemo, useState } from 'react';
import DashboardBreakdowns from './DashboardBreakdowns';
import { InteractiveTrend } from './InteractiveCharts';
import { dashboardSummary, validRange } from './dashboard.mjs';
import type { Ledger, Material } from './types';
import './dashboard.css';
import { useWords } from './Words';
const money = (value: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value / 100);
const change = (value: number, previous: number) =>
  previous === 0
    ? value === 0
      ? 'No change'
      : 'No previous value to compare'
    : `${value >= previous ? '+' : ''}${(((value - previous) / Math.abs(previous)) * 100).toFixed(1)}% vs previous period`;
type Access = {
  sales: boolean;
  payments: boolean;
  expenses: boolean;
  materials: boolean;
  customers: boolean;
};
export default function DashboardPage({
  ledger,
  ready,
  online,
  pending,
  lastSynced,
  access,
}: {
  ledger: Ledger;
  ready: boolean;
  online: boolean;
  pending: number;
  lastSynced?: string;
  access: Access;
}) {
  const { w, stage } = useWords();
  const [period, setPeriod] = usePeriod('dashboard');
  const [trendInterval, setTrendInterval] = useState('daily');
  const range = { from: period.from, to: period.to };
  const valid = validRange(range.from, range.to);
  const summary = useMemo(
    () => (valid ? dashboardSummary(ledger, range.from, range.to, trendInterval) : null),
    [ledger, range.from, range.to, valid, trendInterval],
  );
  if (!ready)
    return (
      <section className="panel empty" role="status">
        Loading dashboard records…
      </section>
    );
  const card = (label: string, value: number, note: string, comparison?: string) => (
    <article key={label}>
      <span>{w(label)}</span>
      <strong>{money(value)}</strong>
      <small>{w(note)}</small>
      {comparison && <small>{comparison}</small>}
    </article>
  );
  return (
    <div className="dashboard">
      <section className="panel dashboard-filters">
        <PeriodFilter value={period} onChange={setPeriod} />
        <small>Dates use Africa/Lagos.</small>
      </section>
      {!online || pending > 0 ? (
        <div className="dashboard-warning" role="status">
          {!online ? 'Offline — showing saved device records. ' : ''}
          {pending > 0
            ? `${pending} pending changes are included; totals may change after synchronization. `
            : ''}
          Other devices’ unsynced work is not included.
        </div>
      ) : (
        <p className="dashboard-freshness">
          Showing the records available on this device.
          {lastSynced &&
            ` Last synced: ${new Date(lastSynced).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.`}
        </p>
      )}
      {!valid || !summary ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : (
        <>
          <h2>Selected period</h2>
          <p>
            {w(
              'Sales use job creation dates and current corrected values. Collections use payment dates, not job dates.',
            )}
          </p>
          <section className="stats dashboard-stats" aria-label="Period summary">
            {access.sales &&
              card(
                'Sales value',
                summary.sales,
                w(`${summary.jobs} jobs · ${summary.cancelled} cancelled`) +
                  (summary.discounts > 0 ? ` · after ${money(summary.discounts)} discounts` : ''),
                change(summary.sales, summary.previous.sales),
              )}
            {access.payments &&
              card(
                'Net collected',
                summary.netCollected,
                `${money(summary.collected)} received − ${money(summary.refunded)} refunded`,
                change(summary.netCollected, summary.previous.netCollected),
              )}
            {access.expenses &&
              card(
                'Expenses incurred',
                summary.expenseIncurred,
                'Expenses dated in this period; voided records excluded',
              )}
            {access.sales &&
              access.expenses &&
              card(
                'Income − expenses',
                summary.netIncome,
                'Sales value minus expenses incurred; includes unpaid sales and expenses.',
              )}
            {access.expenses &&
              card(
                'Expenses paid',
                summary.expensePaid,
                'Recorded payments, including older or voided expenses',
              )}
            {access.payments &&
              access.expenses &&
              card(
                'Money In − Money Out',
                summary.netCashFlow,
                'Payments received minus expenses paid. Not your bank balance.',
              )}
          </section>
          {(access.sales || access.payments || access.expenses) && (
            <section className="panel dashboard-panel">
              <div className="toolbar">
                <h2>{summary.monthly ? 'Monthly' : 'Daily'} trend</h2>
                <label>
                  Group trend by
                  <select
                    aria-label="Trend interval"
                    value={trendInterval}
                    onChange={(e) => setTrendInterval(e.target.value)}
                  >
                    <option value="daily">Day</option>
                    <option value="monthly">Month</option>
                  </select>
                </label>
              </div>
              <InteractiveTrend
                rows={summary.trend}
                sales={access.sales}
                payments={access.payments}
                expenses={access.expenses}
                formatValue={money}
              />
              <p className="muted">
                Collections include customer wallet deposits and subtract customer refunds. Incurred expenses
                use their expense date; paid expenses use their payment date. Account transfers and
                reconciliations are excluded.
              </p>
              <small>
                Comparison period: {summary.previous.from} to {summary.previous.to}. Corrections revise the
                original sale/payment figures.
              </small>
            </section>
          )}
          <h2>Current position</h2>
          <p>These balances and stock figures cover all dates, not only the selected period.</p>
          <section className="stats dashboard-stats" aria-label="Current balances">
            {access.sales &&
              access.payments &&
              card(
                'Outstanding from customers',
                summary.outstanding,
                w(`${summary.outstandingJobs} jobs awaiting payment`),
              )}
            {access.expenses &&
              card('Unpaid expenses', summary.expenseOutstanding, 'Current remaining expense balances')}
          </section>
          <div className="dashboard-grid">
            <DashboardBreakdowns
              services={summary.services}
              sources={summary.sources}
              customers={summary.customers}
              methods={summary.methods}
              missingQuantity={summary.missingQuantity}
              access={access}
            />
            {access.sales && (
              <section className="panel dashboard-panel">
                <h2>{w('Job stages')}</h2>
                <small>{w('All current jobs')}</small>
                {summary.stages.length ? (
                  summary.stages.map((s) => (
                    <div className="dashboard-row" key={s.name}>
                      <span>{stage(s.name)}</span>
                      <strong>{s.count}</strong>
                    </div>
                  ))
                ) : (
                  <p>{w('No jobs yet.')}</p>
                )}
              </section>
            )}
            {access.materials && (
              <section className="panel dashboard-panel">
                <h2>Critical stock</h2>
                <small>At/below minimum, or near minimum (up to 20% above).</small>
                {summary.stockAlerts.length ? (
                  <div className="dashboard-warning" role="status">
                    {summary.stockAlerts.map((m: Material) => (
                      <div
                        className={`dashboard-row ${stockLevel(m) === 'Critical' ? 'stock-critical' : 'stock-near'}`}
                        key={m.id}
                      >
                        <span>
                          {m.name}
                          <small>
                            {stockLevel(m)} · Minimum: {m.minimumStock ?? 0} {m.measurementUnit} · ID{' '}
                            {m.id.slice(0, 8).toUpperCase()}
                          </small>
                        </span>
                        <strong>
                          {m.available} {m.measurementUnit}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>{w('All active materials are above their stock warning levels.')}</p>
                )}
              </section>
            )}
          </div>
          {![access.sales, access.payments, access.expenses, access.materials].some(Boolean) && (
            <section className="panel empty">
              No summary sections are available under your current page permissions.
            </section>
          )}
        </>
      )}
    </div>
  );
}
