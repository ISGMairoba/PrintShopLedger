import { useMemo, useState, type ReactNode } from 'react';
import ResponsiveTable from './ResponsiveTable';
import { validRange } from './dashboard.mjs';
import PeriodFilter, { usePeriod } from './PeriodFilter';
import {
  customerStatement,
  filterStatement,
  statementSections,
  transactionRegister,
  filterTransactions,
  transactionSections,
  summaryReport,
  summarySections,
  reportFileName,
} from './reports.mjs';
import { currency } from './receipts.mjs';
import { downloadCsv, type ReportSection } from './export-csv';
import type { Branding } from './useBusinessBranding';
import type { Ledger } from './types';
import './dashboard.css';
import './reports.css';

export type ReportAccess = {
  customers: boolean;
  jobs: boolean;
  payments: boolean;
  expenses: boolean;
  stock: boolean;
};
type Props = {
  ledger: Ledger;
  ready: boolean;
  online: boolean;
  pending: number;
  lastSynced?: string;
  branding: Branding;
  businessName: string;
  customerId: string;
  onCustomerChange: (id: string) => void;
  access: ReportAccess;
};
type Tab = 'Customer statement' | 'Transactions' | 'Summary';
type StatementJob = {
  id: string;
  ref: string;
  date: string;
  service: string;
  description: string;
  stage: string;
  amount: number;
  paid: number;
  outstanding: number;
  status: string;
};
type StatementPayment = {
  id: string;
  ref: string;
  date: string;
  method: string;
  reference: string;
  refund: boolean;
  received: number;
  creditUsed: number;
  creditAdded: number;
  jobsPaid: { job: string; amount: number }[];
};
type StatementAdjustment = {
  id: string;
  ref: string;
  date: string;
  action: string;
  job: string;
  chargeBefore: number;
  chargeAfter: number;
  refund: number;
  reason: string;
  approvedBy: string;
};
type TransactionRow = {
  id: string;
  at: string;
  day: string;
  type: string;
  ref: string;
  party: string;
  details: string;
  charge: number;
  moneyIn: number;
  moneyOut: number;
  stock: string;
  method: string;
  staff: string;
  drawer: string;
};

const PAGE = 200;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const when = (at: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(at)
    ? at
    : new Date(at).toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
const blank = (kobo: number) => (kobo ? currency(kobo) : '');

function useRange() {
  const [period, setPeriod] = usePeriod('reports');
  const range = { from: period.from, to: period.to };
  const controls = <PeriodFilter value={period} onChange={setPeriod} />;
  return { range, valid: validRange(range.from, range.to), controls };
}

function Select({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  all: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Exports({ busy, onCsv, onPdf }: { busy: boolean; onCsv: () => void; onPdf: () => void }) {
  return (
    <div className="material-actions">
      <button disabled={busy} onClick={onCsv}>
        Download spreadsheet
      </button>
      <button className="secondary" disabled={busy} onClick={onPdf}>
        {busy ? 'Preparing PDF…' : 'Save as PDF'}
      </button>
    </div>
  );
}

function Shown({
  shown,
  total,
  filters,
  onClear,
}: {
  shown: number;
  total: number;
  filters: string[];
  onClear: () => void;
}) {
  if (!filters.length) return null;
  return (
    <p className="report-shown" role="status">
      Showing {shown} of {total} records ({filters.join(', ')}). Downloads include only these records.{' '}
      <button className="text-button" onClick={onClear}>
        Clear search and filters
      </button>
    </p>
  );
}

function JobTable({ jobs, label }: { jobs: StatementJob[]; label: string }) {
  if (!jobs.length) return <p className="muted report-none">No matching jobs.</p>;
  return (
    <div className="table-wrap">
      <ResponsiveTable
        columns={[
          { index: 1, label: 'Job' },
          { index: 4, label: 'Amount', details: [5] },
          { index: 6, label: 'Outstanding' },
        ]}
      >
        <table aria-label={label}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Job</th>
              <th>Service</th>
              <th>Stage</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.date}</td>
                <td>
                  {j.description}
                  <small>{j.ref}</small>
                </td>
                <td>{j.service}</td>
                <td>{j.stage}</td>
                <td>{currency(j.amount)}</td>
                <td>{currency(j.paid)}</td>
                <td>
                  {currency(j.outstanding)}
                  <small>{j.status}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  );
}

export default function ReportsPage({
  ledger,
  ready,
  online,
  pending,
  lastSynced,
  branding,
  businessName,
  customerId,
  onCustomerChange,
  access,
}: Props) {
  const tabs = (['Customer statement', 'Transactions', 'Summary'] as Tab[]).filter(
    (t) => t !== 'Customer statement' || (access.customers && access.jobs && access.payments),
  );
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const brand = branding.businessName ? branding : businessName;
  const company = branding.businessName || businessName;

  async function pdf(file: string, title: string, subtitle: string[], sections: ReportSection[]) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { downloadReportPdf } = await import('./report-pdf');
      downloadReportPdf(file, brand, { title, subtitle, sections, generatedAt: new Date().toISOString() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the PDF.');
    } finally {
      setBusy(false);
    }
  }
  function csv(file: string, title: string, subtitle: string[], sections: ReportSection[]) {
    setError('');
    try {
      downloadCsv(file, [company, title, ...subtitle], sections);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the spreadsheet.');
    }
  }
  if (!ready)
    return (
      <section className="panel empty" role="status">
        Loading report records…
      </section>
    );
  const freshness =
    !online || pending > 0 ? (
      <div className="dashboard-warning" role="status">
        {!online ? 'Offline — showing saved device records. ' : ''}
        {pending > 0 ? `${pending} pending changes are included; figures may change after syncing. ` : ''}
        Other devices’ unsynced work is not included.
      </div>
    ) : (
      <p className="dashboard-freshness">
        Showing the records available on this device.
        {lastSynced &&
          ` Last synced: ${new Date(lastSynced).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.`}
      </p>
    );
  const shared = { ledger, freshness, busy, error, pdf, csv };
  return (
    <div className="dashboard reports">
      <div className="settings-tabs" role="tablist" aria-label="Reports">
        {tabs.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? 'active' : 'secondary'}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === 'Customer statement' ? (
        <StatementTab {...shared} customerId={customerId} onCustomerChange={onCustomerChange} />
      ) : tab === 'Transactions' ? (
        <TransactionsTab {...shared} access={access} />
      ) : (
        <SummaryTab {...shared} access={access} />
      )}
    </div>
  );
}

type TabProps = {
  ledger: Ledger;
  freshness: ReactNode;
  busy: boolean;
  error: string;
  pdf: (file: string, title: string, subtitle: string[], sections: ReportSection[]) => Promise<void>;
  csv: (file: string, title: string, subtitle: string[], sections: ReportSection[]) => void;
};

function StatementTab({
  ledger,
  freshness,
  busy,
  error,
  pdf,
  csv,
  customerId,
  onCustomerChange,
}: TabProps & { customerId: string; onCustomerChange: (id: string) => void }) {
  const { range, valid, controls } = useRange();
  const [query, setQuery] = useState(''),
    [paymentStatus, setPaymentStatus] = useState(''),
    [stage, setStage] = useState(''),
    [method, setMethod] = useState(''),
    [show, setShow] = useState('all');
  const customers = useMemo(
    () => [...ledger.customers].sort((a, b) => a.name.localeCompare(b.name)),
    [ledger.customers],
  );
  const full = useMemo(
    () =>
      valid && customerId && ledger.customers.some((c) => c.id === customerId)
        ? customerStatement(ledger, customerId, range.from, range.to)
        : null,
    [ledger, customerId, range.from, range.to, valid],
  );
  const statement = useMemo(
    () => (full ? filterStatement(full, { query, paymentStatus, stage, method, show }, currency) : null),
    [full, query, paymentStatus, stage, method, show],
  );
  const clear = () => {
    setQuery('');
    setPaymentStatus('');
    setStage('');
    setMethod('');
    setShow('all');
  };
  const allJobs = full ? ([...full.jobs, ...full.earlierOwing, ...full.laterOwing] as StatementJob[]) : [];
  const title = 'Customer statement';
  const subtitle = statement
    ? [
        `${statement.customer.name} (${statement.customer.code})${statement.customer.phone ? ' - ' + statement.customer.phone : ''}`,
        `Period: ${statement.from} to ${statement.to}`,
        ...(statement.filters.length ? [`Filtered: ${statement.filters.join(', ')}`] : []),
        'Balances are current as of the generated time, including later payments and corrections.',
      ]
    : [];
  const file = statement
    ? reportFileName('Statement', statement.customer.name, `${statement.from} to ${statement.to}`)
    : '';
  const t = statement?.totals;
  const card = (label: string, value: number, note?: string) => (
    <article key={label}>
      <span>{label}</span>
      <strong>{currency(value)}</strong>
      {note && <small>{note}</small>}
    </article>
  );
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        <label className="wide">
          Customer
          <select
            value={customerId}
            onChange={(e) => {
              onCustomerChange(e.target.value);
              clear();
            }}
          >
            <option value="">Choose a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` · ${c.phone}` : ''}
                {c.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        {controls}
        <small>Dates use Africa/Lagos.</small>
      </section>
      {freshness}
      {!valid ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : !statement || !t ? (
        <section className="panel empty">Choose a customer to see their statement.</section>
      ) : (
        <>
          <section className="panel report-header">
            <div>
              <h2>{statement.customer.name}</h2>
              <p>
                {statement.customer.code}
                {statement.customer.phone && ` · ${statement.customer.phone}`}
                {statement.customer.address && ` · ${statement.customer.address}`}
                {statement.customer.archived && ' · Archived'}
              </p>
              <small>
                Credit limit: {currency(statement.customer.creditLimit)}. Balances are current, including
                payments and corrections made after the period.
              </small>
            </div>
            <Exports
              busy={busy}
              onCsv={() => csv(file, title, subtitle, statementSections(statement))}
              onPdf={() =>
                void pdf(file, title, subtitle, statementSections(statement, { money: currency, unit: '' }))
              }
            />
          </section>
          {error && (
            <p role="alert" className="dashboard-warning">
              {error}
            </p>
          )}
          <section className="stats dashboard-stats" aria-label="Statement summary">
            {card('Total owed now', t.owedNow, 'All unpaid jobs, any date')}
            {card('Credit balance now', t.creditNow, 'Customer money held for future jobs')}
            {card('Jobs charged', t.charged, 'Jobs created in this period')}
            {card(
              'Money received',
              t.received,
              t.refunded
                ? `${currency(t.refunded)} refunded in this period`
                : 'Payments dated in this period',
            )}
          </section>
          <section className="panel dashboard-filters report-filters" aria-label="Search and filter records">
            <label className="wide">
              Search records
              <input
                type="search"
                placeholder="Job, payment, reference, amount…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Show
              <select value={show} onChange={(e) => setShow(e.target.value)}>
                <option value="all">All records</option>
                <option value="jobs">Jobs only</option>
                <option value="payments">Payments only</option>
                <option value="adjustments">Corrections only</option>
              </select>
            </label>
            <Select
              label="Payment status"
              value={paymentStatus}
              onChange={setPaymentStatus}
              options={unique(allJobs.map((j) => j.status))}
              all="Any status"
            />
            <Select
              label="Stage"
              value={stage}
              onChange={setStage}
              options={unique(allJobs.map((j) => j.stage))}
              all="Any stage"
            />
            <Select
              label="Payment method"
              value={method}
              onChange={setMethod}
              options={unique((full!.payments as StatementPayment[]).map((p) => p.method))}
              all="Any method"
            />
          </section>
          <Shown
            shown={statement.shown}
            total={statement.total}
            filters={statement.filters}
            onClear={clear}
          />
          {(show === 'all' || show === 'jobs') && (
            <section className="panel">
              <h2>Jobs in this period</h2>
              <JobTable jobs={statement.jobs as StatementJob[]} label="Jobs in this period" />
            </section>
          )}
          {statement.earlierOwing.length > 0 && (
            <section className="panel">
              <h2>Earlier jobs still owing</h2>
              <p className="muted report-none">
                Created before {statement.from}; included so the total owed is fully explained.
              </p>
              <JobTable jobs={statement.earlierOwing as StatementJob[]} label="Earlier jobs still owing" />
            </section>
          )}
          {statement.laterOwing.length > 0 && (
            <section className="panel">
              <h2>Later jobs still owing</h2>
              <p className="muted report-none">Created after {statement.to}.</p>
              <JobTable jobs={statement.laterOwing as StatementJob[]} label="Later jobs still owing" />
            </section>
          )}
          {(show === 'all' || show === 'payments') && (
            <section className="panel">
              <h2>Payments in this period</h2>
              {statement.payments.length ? (
                <div className="table-wrap">
                  <ResponsiveTable
                    columns={[
                      { index: 0, label: 'Payment' },
                      { index: 2, label: 'Received', details: [3, 4] },
                      { index: 5, label: 'Jobs paid' },
                    ]}
                  >
                    <table aria-label="Payments in this period">
                      <thead>
                        <tr>
                          <th>Date / method</th>
                          <th>Reference</th>
                          <th>Money received</th>
                          <th>Credit used</th>
                          <th>Credit added</th>
                          <th>Jobs paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(statement.payments as StatementPayment[]).map((p) => (
                          <tr key={p.id}>
                            <td>
                              {p.date} · {p.method}
                              <small>
                                {p.ref}
                                {p.refund ? ' · Refund to customer' : ''}
                              </small>
                            </td>
                            <td>{p.reference}</td>
                            <td>{currency(p.received)}</td>
                            <td>{currency(p.creditUsed)}</td>
                            <td>{currency(p.creditAdded)}</td>
                            <td>
                              {p.jobsPaid.map((a) => (
                                <small key={a.job}>
                                  {a.job}: {currency(a.amount)}
                                </small>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ResponsiveTable>
                </div>
              ) : (
                <p className="muted report-none">No matching payments.</p>
              )}
            </section>
          )}
          {statement.adjustments.length > 0 && (
            <section className="panel">
              <h2>Corrections and refunds in this period</h2>
              <div className="table-wrap">
                <ResponsiveTable
                  columns={[
                    { index: 0, label: 'Adjustment' },
                    { index: 2, label: 'Charge', details: [3] },
                    { index: 4, label: 'Reason' },
                  ]}
                >
                  <table aria-label="Corrections and refunds">
                    <thead>
                      <tr>
                        <th>Date / type</th>
                        <th>Job</th>
                        <th>Charge before → after</th>
                        <th>Refunded</th>
                        <th>Reason / approved by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(statement.adjustments as StatementAdjustment[]).map((a) => (
                        <tr key={a.id}>
                          <td>
                            {a.date} · {a.action}
                            <small>{a.ref}</small>
                          </td>
                          <td>{a.job}</td>
                          <td>
                            {currency(a.chargeBefore)} → {currency(a.chargeAfter)}
                          </td>
                          <td>{currency(a.refund)}</td>
                          <td>
                            {a.reason}
                            <small>{a.approvedBy}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function TransactionsTab({
  ledger,
  freshness,
  busy,
  error,
  pdf,
  csv,
  access,
}: TabProps & { access: ReportAccess }) {
  const { range, valid, controls } = useRange();
  const [query, setQuery] = useState(''),
    [type, setType] = useState(''),
    [method, setMethod] = useState(''),
    [staff, setStaff] = useState(''),
    [limit, setLimit] = useState(PAGE);
  const full = useMemo(
    () => (valid ? transactionRegister(ledger, range.from, range.to, access) : null),
    [
      ledger,
      range.from,
      range.to,
      valid,
      access.jobs,
      access.payments,
      access.expenses,
      access.stock,
      access.customers,
    ],
  );
  const register = useMemo(
    () => (full ? filterTransactions(full, { query, type, method, staff }, currency) : null),
    [full, query, type, method, staff],
  );
  const clear = () => {
    setQuery('');
    setType('');
    setMethod('');
    setStaff('');
    setLimit(PAGE);
  };
  const title = 'Transactions';
  const subtitle = register
    ? [
        `Period: ${register.from} to ${register.to}`,
        ...(register.filters.length ? [`Filtered: ${register.filters.join(', ')}`] : []),
      ]
    : [];
  const file = register ? reportFileName('Transactions', `${register.from} to ${register.to}`) : '';
  const rows = (register?.rows ?? []) as TransactionRow[];
  const allRows = (full?.rows ?? []) as TransactionRow[];
  const card = (label: string, value: number, note: string) => (
    <article key={label}>
      <span>{label}</span>
      <strong>{currency(value)}</strong>
      <small>{note}</small>
    </article>
  );
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        {controls}
        <small>Dates use Africa/Lagos. Newest first.</small>
      </section>
      {freshness}
      {!valid || !register ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : (
        <>
          <section className="panel report-header">
            <div>
              <h2>{register.rows.length} records</h2>
              <small>
                Jobs, payments, refunds{access.expenses ? ', expense payments' : ''}, corrections
                {access.stock ? ' and stock changes' : ''}. Corrections show what changed; corrected payments
                already show their current amount.
              </small>
            </div>
            <Exports
              busy={busy || !register.rows.length}
              onCsv={() => csv(file, title, subtitle, transactionSections(register))}
              onPdf={() =>
                void pdf(file, title, subtitle, transactionSections(register, { money: currency, unit: '' }))
              }
            />
          </section>
          {error && (
            <p role="alert" className="dashboard-warning">
              {error}
            </p>
          )}
          <section className="stats dashboard-stats" aria-label="Transaction totals">
            {access.payments && card('Money in', register.totals.moneyIn, 'Customer payments received')}
            {(access.payments || access.expenses) &&
              card(
                'Money out',
                register.totals.moneyOut,
                access.expenses ? 'Refunds and expense payments' : 'Refunds paid',
              )}
            {access.payments && card('Net', register.totals.net, 'Money in minus money out')}
            {access.jobs && card('Job charges', register.totals.charge, 'Value of jobs created')}
          </section>
          <section
            className="panel dashboard-filters report-filters"
            aria-label="Search and filter transactions"
          >
            <label className="wide">
              Search records
              <input
                type="search"
                placeholder="Customer, payee, material, reference, amount…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(PAGE);
                }}
              />
            </label>
            <Select
              label="Type"
              value={type}
              onChange={(v) => {
                setType(v);
                setLimit(PAGE);
              }}
              options={register.types}
              all="All types"
            />
            <Select
              label="Method"
              value={method}
              onChange={(v) => {
                setMethod(v);
                setLimit(PAGE);
              }}
              options={unique(allRows.map((r) => r.method))}
              all="Any method"
            />
            <Select
              label="Staff"
              value={staff}
              onChange={(v) => {
                setStaff(v);
                setLimit(PAGE);
              }}
              options={unique(allRows.map((r) => r.staff))}
              all="Anyone"
            />
          </section>
          <Shown shown={register.shown} total={register.total} filters={register.filters} onClear={clear} />
          <section className="panel">
            {rows.length ? (
              <div className="table-wrap">
                <ResponsiveTable
                  columns={[
                    { index: 0, label: 'Transaction' },
                    { index: 3, label: 'Details', details: [4, 5] },
                    { index: 6, label: 'Amount' },
                  ]}
                >
                  <table aria-label="Transactions">
                    <thead>
                      <tr>
                        <th>Date / type</th>
                        <th>Reference</th>
                        <th>Customer / payee / material</th>
                        <th>Details</th>
                        <th>Method</th>
                        <th>Staff</th>
                        <th>Amount / stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, limit).map((r) => (
                        <tr key={r.id}>
                          <td>
                            {when(r.at)}
                            <small>{r.type}</small>
                          </td>
                          <td>
                            {r.ref}
                            {r.drawer && <small>Drawer: {r.drawer}</small>}
                          </td>
                          <td>{r.party}</td>
                          <td className="report-details">{r.details}</td>
                          <td>{r.method}</td>
                          <td>{r.staff}</td>
                          <td>
                            {r.moneyIn ? (
                              <span className="money-in">+{currency(r.moneyIn)}</span>
                            ) : r.moneyOut ? (
                              <span className="money-out">−{currency(r.moneyOut)}</span>
                            ) : r.charge ? (
                              <>
                                {blank(r.charge)}
                                <small>Charge</small>
                              </>
                            ) : (
                              r.stock
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              </div>
            ) : (
              <p className="muted report-none">No matching records.</p>
            )}
            {rows.length > limit && (
              <div className="report-more">
                <button className="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                  Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} hidden)
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function SummaryTab({
  ledger,
  freshness,
  busy,
  error,
  pdf,
  csv,
  access,
}: TabProps & { access: ReportAccess }) {
  const { range, valid, controls } = useRange();
  const [compare, setCompare] = useState(false);
  const summary = useMemo(
    () => (valid ? summaryReport(ledger, range.from, range.to, access, { compare }) : null),
    [
      ledger,
      range.from,
      range.to,
      valid,
      compare,
      access.jobs,
      access.payments,
      access.expenses,
      access.stock,
      access.customers,
    ],
  );
  const title = 'Business summary';
  const subtitle = summary
    ? [
        `Period: ${summary.from} to ${summary.to}`,
        ...(summary.previous ? [`Compared with ${summary.previous.from} to ${summary.previous.to}`] : []),
        'Sales use job dates; money received uses payment dates.',
      ]
    : [];
  const file = summary ? reportFileName('Summary', `${summary.from} to ${summary.to}`) : '';
  const sections: ReportSection[] = summary
    ? (summarySections(summary, { money: currency, unit: '' }) as ReportSection[])
    : [];
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        {controls}
        <label className="checkbox">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Compare with previous period
        </label>
        <small>Dates use Africa/Lagos.</small>
      </section>
      {freshness}
      {!valid || !summary ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : (
        <>
          <section className="panel report-header">
            <div>
              <h2>
                {summary.from} to {summary.to}
              </h2>
              <small>
                Same figures as the Dashboard, laid out for printing and sharing. Amounts owed and stock are
                as of today.
              </small>
            </div>
            <Exports
              busy={busy}
              onCsv={() => csv(file, title, subtitle, summarySections(summary))}
              onPdf={() => void pdf(file, title, subtitle, sections)}
            />
          </section>
          {error && (
            <p role="alert" className="dashboard-warning">
              {error}
            </p>
          )}
          {!sections.length && (
            <section className="panel empty">
              No summary sections are available under your current page permissions.
            </section>
          )}
          {sections.map((section) => (
            <section className="panel" key={section.title}>
              <h2>{section.title}</h2>
              {section.rows.length ? (
                <div className="table-wrap">
                  <ResponsiveTable
                    columns={[
                      { index: 0, label: section.columns[0] },
                      {
                        index: 1,
                        label: section.columns[1],
                        details: section.columns
                          .slice(2)
                          .map((_, i) => i + 2)
                          .slice(0, -1),
                      },
                      ...(section.columns.length > 2
                        ? [
                            {
                              index: section.columns.length - 1,
                              label: section.columns[section.columns.length - 1],
                            },
                          ]
                        : []),
                    ]}
                  >
                    <table aria-label={section.title}>
                      <thead>
                        <tr>
                          {section.columns.map((c) => (
                            <th
                              key={c}
                              className={
                                section.numeric?.includes(section.columns.indexOf(c)) ? 'numeric' : ''
                              }
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row, r) => (
                          <tr key={r} className={row[0] === 'Total' ? 'report-total' : ''}>
                            {row.map((cell, i) => (
                              <td key={i} className={section.numeric?.includes(i) ? 'numeric' : ''}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ResponsiveTable>
                </div>
              ) : (
                <p className="muted report-none">Nothing recorded in this period.</p>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
