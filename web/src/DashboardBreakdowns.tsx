import { useState } from 'react';
import { rankDashboardRows } from './dashboard.mjs';
import { InteractivePie, InteractiveRanking } from './InteractiveCharts';
import { useWords } from './Words';
type Row = { id: string; name: string; sales: number; quantity: number; jobs: number };
type Metric = 'sales' | 'quantity' | 'jobs';
const money = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(n / 100);
const count = (n: number) => new Intl.NumberFormat('en-NG', { maximumFractionDigits: 3 }).format(n);
const format = (metric: Metric) => (n: number) => (metric === 'sales' ? money(n) : count(n));
function MetricSelect({
  label,
  value,
  onChange,
  includeJobs = false,
}: {
  label: string;
  value: Metric;
  onChange: (value: Metric) => void;
  includeJobs?: boolean;
}) {
  const { w } = useWords();
  return (
    <label className="dashboard-metric">
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as Metric)}>
        <option value="sales">Net amount</option>
        <option value="quantity">Net quantity</option>
        {includeJobs && <option value="jobs">{w('Number of jobs')}</option>}
      </select>
    </label>
  );
}
export default function DashboardBreakdowns({
  services,
  sources,
  customers,
  methods,
  missingQuantity,
  access,
}: {
  services: Row[];
  sources: Row[];
  customers: Row[];
  methods: { name: string; amount: number }[];
  missingQuantity: number;
  access: { sales: boolean; payments: boolean; customers: boolean };
}) {
  const { w } = useWords();
  const [serviceMetric, setServiceMetric] = useState<Metric>('sales'),
    [sourceMetric, setSourceMetric] = useState<Metric>('jobs'),
    [customerMetric, setCustomerMetric] = useState<Metric>('sales');
  const topServices: Row[] = rankDashboardRows(services, serviceMetric),
    topCustomers: Row[] = rankDashboardRows(customers, customerMetric),
    sourceRows: Row[] = rankDashboardRows(sources, sourceMetric, sources.length);
  const quantityNote = (metric: Metric) =>
    metric === 'quantity' ? (
      <small>
        {w('Corrected quantities of active jobs; cancelled jobs excluded.')}
        {missingQuantity > 0 &&
          w(` ${missingQuantity} jobs have no recorded quantity and are excluded from quantity totals.`)}
      </small>
    ) : (
      <small>{w('Corrected sales value; cancelled jobs excluded.')}</small>
    );
  return (
    <>
      {access.sales && (
        <section className="panel dashboard-panel" aria-label="Top 5 services">
          <h2>{w('Top 5 services')}</h2>
          <MetricSelect label={w('Rank services by')} value={serviceMetric} onChange={setServiceMetric} />
          {quantityNote(serviceMetric)}
          <InteractivePie
            key={serviceMetric}
            title={`Top five services by ${serviceMetric === 'sales' ? 'net amount' : 'net quantity'}`}
            rows={topServices.map((r) => ({ id: r.id, name: r.name, value: r[serviceMetric] }))}
            formatValue={format(serviceMetric)}
          />
          <small>{w('Pie shares are among the displayed top five services.')}</small>
        </section>
      )}
      {access.payments && (
        <section className="panel dashboard-panel" aria-label="Payment methods">
          <h2>Payment methods</h2>
          <small>
            Money collected less refunds, grouped by payment method. Wallet use is not new income.
          </small>
          <InteractivePie
            title="Payment method share of positive net collections"
            rows={methods.map((m) => ({ id: m.name, name: m.name, value: m.amount }))}
            formatValue={money}
          />
        </section>
      )}
      {access.sales && (
        <section className="panel dashboard-panel" aria-label={w('Job sources')}>
          <h2>{w('Job sources')}</h2>
          <MetricSelect
            label={w('Compare job sources by')}
            value={sourceMetric}
            onChange={setSourceMetric}
            includeJobs
          />
          {sourceMetric === 'jobs' ? (
            <small>{w('Active jobs created in the selected period.')}</small>
          ) : (
            quantityNote(sourceMetric)
          )}
          <InteractiveRanking
            currency={sourceMetric === 'sales'}
            key={sourceMetric}
            title={w(`Job sources by ${sourceMetric}`)}
            rows={sourceRows.map((row) => ({ id: row.id, name: row.name, value: row[sourceMetric] }))}
            formatValue={format(sourceMetric)}
          />
        </section>
      )}
      {access.sales && access.customers && (
        <section className="panel dashboard-panel" aria-label="Top 5 customers">
          <h2>Top 5 customers</h2>
          <MetricSelect label="Rank customers by" value={customerMetric} onChange={setCustomerMetric} />
          {quantityNote(customerMetric)}
          <InteractiveRanking
            currency={customerMetric === 'sales'}
            key={customerMetric}
            title={`Top five customers by ${customerMetric}`}
            rows={topCustomers.map((row) => ({ id: row.id, name: row.name, value: row[customerMetric] }))}
            formatValue={format(customerMetric)}
          />
        </section>
      )}
    </>
  );
}
