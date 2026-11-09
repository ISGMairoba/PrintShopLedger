import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { profitReport, profitSections } from './profit.mjs';
import { profitLoss, profitLossSections } from './profit-loss.mjs';
import ResponsiveTable from './ResponsiveTable';
import { validRange } from './dashboard.mjs';
import PeriodFilter, { usePeriod } from './PeriodFilter';
import {
  customerStatement,
  payeeStatement,
  payeeStatementSections,
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
import { useWords } from './Words';
import { statementMessage } from './share.mjs';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import ListedCombobox from './ListedCombobox';

/** How a customer appears in the statement picker: name, phone, and archived when it is. */
const customerOption = (c: { name: string; phone: string; archived?: boolean }) =>
  `${c.name}${c.phone && c.phone !== c.name ? ' — ' + c.phone : ''}${c.archived ? ' (archived)' : ''}`;
import { nameSections } from './report-words';

export type ReportAccess = {
  customers: boolean;
  jobs: boolean;
  payments: boolean;
  expenses: boolean;
  stock: boolean;
  /** May see costs and profit (Business Settings → Pricing templates → who sees costs). */
  costs?: boolean;
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
  payeeId?: string;
  onPayeeChange?: (id: string) => void;
  access: ReportAccess;
  /** The owner's choice of branch (All branches or one). */
  branchControl?: ReactNode;
};
type Tab = 'Customer statement' | 'Payee statement' | 'Transactions' | 'Summary' | 'Profit' | 'Profit & loss';
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
  display = (o) => o,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  all: string;
  /** How an option is shown (the value stays as saved). */
  display?: (option: string) => string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {display(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Exports({
  busy,
  onCsv,
  onPdf,
  onShare,
}: {
  busy: boolean;
  onCsv: () => void;
  onPdf: () => void;
  onShare?: () => void;
}) {
  return (
    <div className="material-actions">
      {onShare && (
        <button className="secondary" disabled={busy} onClick={onShare}>
          <Icon name="share" /> Share
        </button>
      )}
      <button disabled={busy} onClick={onCsv}>
        <Icon name="export" /> Download spreadsheet
      </button>
      <button className="secondary" disabled={busy} onClick={onPdf}>
        <Icon name="export" /> {busy ? 'Preparing PDF…' : 'Save as PDF'}
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
        <Icon name="close" /> Clear search and filters
      </button>
    </p>
  );
}

function JobTable({ jobs, label }: { jobs: StatementJob[]; label: string }) {
  const { w, stage } = useWords();
  if (!jobs.length) return <p className="muted report-none">{w('No matching jobs.')}</p>;
  return (
    <div className="table-wrap">
      <ResponsiveTable
        columns={[
          { index: 1, label: w('Job') },
          { index: 4, label: 'Amount', details: [5] },
          { index: 6, label: 'Outstanding' },
        ]}
      >
        <table aria-label={label}>
          <thead>
            <tr>
              <th>Date</th>
              <th>{w('Job')}</th>
              <th>{w('Service')}</th>
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
                <td>{stage(j.stage)}</td>
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
  payeeId = '',
  onPayeeChange = () => {},
  access,
  branchControl,
}: Props) {
  // Load the PDF and share code now: phones only open the share sheet straight after the tap.
  useEffect(() => {
    void import('./report-pdf');
    void import('./share-pdf');
  }, []);
  const tabs = (
    ['Customer statement', 'Payee statement', 'Transactions', 'Summary', 'Profit', 'Profit & loss'] as Tab[]
  ).filter(
    (t) =>
      (t !== 'Customer statement' || (access.customers && access.jobs && access.payments)) &&
      (t !== 'Payee statement' || access.expenses) &&
      (t !== 'Profit' || (!!access.costs && access.jobs)) &&
      (t !== 'Profit & loss' || (!!access.costs && access.jobs && access.expenses)),
  );
  const [tab, setTab] = useState<Tab>(
    payeeId && tabs.includes('Payee statement') ? 'Payee statement' : tabs[0],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const brand = branding.businessName ? branding : businessName;
  const company = branding.businessName || businessName;
  const { w, terms } = useWords();
  const named = (sections: ReportSection[]) => nameSections(sections, terms);
  const notify = useFeedback();

  async function pdf(file: string, title: string, subtitle: string[], sections: ReportSection[]) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { downloadReportPdf } = await import('./report-pdf');
      downloadReportPdf(file, brand, {
        title,
        subtitle: subtitle.map(w),
        sections: named(sections),
        generatedAt: new Date().toISOString(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the PDF.');
    } finally {
      setBusy(false);
    }
  }
  function csv(file: string, title: string, subtitle: string[], sections: ReportSection[]) {
    setError('');
    try {
      downloadCsv(file, [company, title, ...subtitle.map(w)], named(sections));
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
  const keptFrom = ledger.historySummary?.cutoff;
  const kept = keptFrom ? (
    <div className="dashboard-warning" role="status">
      This device keeps records from{' '}
      {new Date(keptFrom + 'T12:00:00+01:00').toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}
      . Balances and totals are complete; for the detail of earlier records, choose Everything in My Account →
      This device, or use a device that keeps everything.
    </div>
  ) : null;
  const freshness0 =
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
  const freshness = (
    <>
      {kept}
      {freshness0}
    </>
  );
  async function share(
    file: string,
    title: string,
    subtitle: string[],
    sections: ReportSection[],
    to: { text: string; phone?: string },
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const [{ createReportPdf }, { sharePdf, shareResult }] = await Promise.all([
        import('./report-pdf'),
        import('./share-pdf'),
      ]);
      const doc = createReportPdf(brand, {
        title,
        subtitle: subtitle.map(w),
        sections: named(sections),
        generatedAt: new Date().toISOString(),
      });
      const note = shareResult(await sharePdf(doc, file, { title, ...to }));
      if (note) notify(note, 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share the PDF.');
    } finally {
      setBusy(false);
    }
  }
  const shared = { ledger, freshness, busy, error, pdf, csv, share, company };
  return (
    <div className="dashboard reports">
      {branchControl && <section className="panel dashboard-filters">{branchControl}</section>}
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
      ) : tab === 'Profit' ? (
        <ProfitTab {...shared} />
      ) : tab === 'Profit & loss' ? (
        <ProfitLossTab {...shared} />
      ) : tab === 'Payee statement' ? (
        <PayeeStatementTab {...shared} payeeId={payeeId} onPayeeChange={onPayeeChange} />
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
  company: string;
  /** Share the PDF (WhatsApp on phones), with a message to the customer. */
  share: (
    file: string,
    title: string,
    subtitle: string[],
    sections: ReportSection[],
    to: { text: string; phone?: string },
  ) => Promise<void>;
};

type PayeeExpenseRow = {
  id: string;
  date: string;
  ref: string;
  description: string;
  category: string;
  amount: number;
  paid: number;
  outstanding: number;
  status: string;
};
type PayeePaymentRow = {
  id: string;
  date: string;
  ref: string;
  expense: string;
  method: string;
  source: string;
  reference: string;
  amount: number;
};
type PayeeStatement = {
  payee: { id: string; name: string; phone?: string; address?: string; archived?: boolean };
  from: string;
  to: string;
  expenses: PayeeExpenseRow[];
  earlierOwing: PayeeExpenseRow[];
  payments: PayeePaymentRow[];
  totals: { incurred: number; paid: number; owedNow: number; lastPaid: string };
  loans?: {
    owed: number;
    borrowedInPeriod: number;
    repaidInPeriod: number;
    repaymentDue: string;
    entries: { id: string; date: string; kind: string; amount: number; note: string }[];
  };
};
function PayeeStatementTab({
  ledger,
  freshness,
  busy,
  error,
  pdf,
  csv,
  payeeId,
  onPayeeChange,
}: TabProps & { payeeId: string; onPayeeChange: (id: string) => void }) {
  const { range, valid, controls } = useRange();
  const payees = useMemo(
    () => [...(ledger.payees ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [ledger.payees],
  );
  const [text, setText] = useState(() => {
    const saved = payees.find((p) => p.id === payeeId);
    return saved ? customerOption(saved) : '';
  });
  const statement = useMemo(
    () =>
      valid && payeeId && payees.some((p) => p.id === payeeId)
        ? (payeeStatement(ledger, payeeId, range.from, range.to) as PayeeStatement)
        : null,
    [ledger, payees, payeeId, range.from, range.to, valid],
  );
  const title = 'Payee statement';
  const subtitle = statement
    ? [
        `${statement.payee.name}${statement.payee.phone ? ' - ' + statement.payee.phone : ''}`,
        `Period: ${statement.from} to ${statement.to}`,
        'The amount owed is current as of the generated time.',
      ]
    : [];
  const file = statement
    ? reportFileName('Payee statement', statement.payee.name, `${statement.from} to ${statement.to}`)
    : '';
  const t = statement?.totals;
  const expenseTable = (rows: PayeeExpenseRow[], label: string) =>
    rows.length ? (
      <div className="table-wrap">
        <table aria-label={label}>
          <thead>
            <tr>
              <th>Date / expense</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Outstanding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.date} · {r.description}
                  <small>
                    {r.ref} · {r.category}
                  </small>
                </td>
                <td>{currency(r.amount)}</td>
                <td>{currency(r.paid)}</td>
                <td>{currency(r.outstanding)}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="muted report-none">None.</p>
    );
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        <div className="wide">
          <ListedCombobox
            label="Payee"
            name="statement-payee"
            placeholder="Type a payee name or phone number"
            required={false}
            emptyText="No matching payee."
            options={payees.map(customerOption)}
            value={text}
            onChange={(next) => {
              setText(next);
              const picked = payees.find((p) => customerOption(p) === next);
              if ((picked?.id ?? '') !== payeeId) onPayeeChange(picked?.id ?? '');
            }}
          />
        </div>
        {controls}
        <small>Dates use Africa/Lagos.</small>
      </section>
      {freshness}
      {!valid ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : !statement || !t ? (
        <section className="panel empty">
          <h2>No payee chosen</h2>
          <p>Choose a payee above to see what was spent with them, paid, and still owed.</p>
        </section>
      ) : (
        <>
          <section className="panel report-header">
            <div>
              <h2>{statement.payee.name}</h2>
              <p>
                {statement.payee.phone}
                {statement.payee.address && ` · ${statement.payee.address}`}
                {statement.payee.archived && ' · Archived'}
              </p>
            </div>
            <Exports
              busy={busy}
              onCsv={() => csv(file, title, subtitle, payeeStatementSections(statement))}
              onPdf={() =>
                void pdf(
                  file,
                  title,
                  subtitle,
                  payeeStatementSections(statement, { money: currency, unit: '' }),
                )
              }
            />
          </section>
          {error && (
            <p role="alert" className="dashboard-warning">
              {error}
            </p>
          )}
          <section className="stats dashboard-stats" aria-label="Payee statement summary">
            <article>
              <span>Owed to payee now</span>
              <strong>{currency(t.owedNow)}</strong>
              <small>All unpaid expenses, any date</small>
            </article>
            <article>
              <span>Expenses in period</span>
              <strong>{currency(t.incurred)}</strong>
              <small>{statement.expenses.length} expenses</small>
            </article>
            <article>
              <span>Paid in period</span>
              <strong>{currency(t.paid)}</strong>
              <small>{statement.payments.length} payments</small>
            </article>
            <article>
              <span>Last paid</span>
              <strong>{t.lastPaid || '—'}</strong>
            </article>
            {statement.loans && (
              <article>
                <span>Loan still owed</span>
                <strong>{currency(statement.loans.owed)}</strong>
                <small>
                  Borrowed {currency(statement.loans.borrowedInPeriod)} · repaid{' '}
                  {currency(statement.loans.repaidInPeriod)} in period
                  {statement.loans.repaymentDue && statement.loans.owed > 0
                    ? ` · next due ${statement.loans.repaymentDue}`
                    : ''}
                </small>
              </article>
            )}
          </section>
          {!!statement.loans?.entries.length && (
            <section className="panel">
              <h2>Loans in this period</h2>
              <div className="table-wrap">
                <table aria-label="Loans in this period">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Borrowed / repaid</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.loans.entries.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.date}
                          <small>{e.note}</small>
                        </td>
                        <td>{e.kind}</td>
                        <td>{currency(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="panel">
            <h2>Expenses in this period</h2>
            {expenseTable(statement.expenses, 'Expenses in this period')}
          </section>
          {statement.earlierOwing.length > 0 && (
            <section className="panel">
              <h2>Earlier expenses still owed</h2>
              {expenseTable(statement.earlierOwing, 'Earlier expenses still owed')}
            </section>
          )}
          <section className="panel">
            <h2>Payments in this period</h2>
            {statement.payments.length ? (
              <div className="table-wrap">
                <table aria-label="Payments to payee">
                  <thead>
                    <tr>
                      <th>Date / expense</th>
                      <th>Paid from</th>
                      <th>Reference</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.date} · {p.expense}
                          <small>{p.ref}</small>
                        </td>
                        <td>{p.source === 'Personal funds' ? 'Personal funds' : p.method}</td>
                        <td>{p.reference}</td>
                        <td>{currency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted report-none">No payments in this period.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function StatementTab({
  ledger,
  freshness,
  busy,
  error,
  pdf,
  csv,
  share,
  company,
  customerId,
  onCustomerChange,
}: TabProps & { customerId: string; onCustomerChange: (id: string) => void }) {
  const { w, stage: stageLabel } = useWords();
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
  const [customerText, setCustomerText] = useState(() => {
    const saved = ledger.customers.find((c) => c.id === customerId);
    return saved ? customerOption(saved) : '';
  });
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
      <span>{w(label)}</span>
      <strong>{currency(value)}</strong>
      {note && <small>{w(note)}</small>}
    </article>
  );
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        <div className="wide">
          <ListedCombobox
            label="Customer"
            name="statement-customer"
            placeholder="Type a name or phone number"
            required={false}
            emptyText="No matching customer."
            options={customers.map(customerOption)}
            value={customerText}
            onChange={(text) => {
              setCustomerText(text);
              const picked = customers.find((c) => customerOption(c) === text);
              if ((picked?.id ?? '') !== customerId) {
                onCustomerChange(picked?.id ?? '');
                clear();
              }
            }}
          />
        </div>
        {controls}
        <small>Dates use Africa/Lagos.</small>
      </section>
      {freshness}
      {!valid ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : !statement || !t ? (
        <section className="panel empty">
          <h2>No customer chosen</h2>
          <p>Choose a customer above to see their statement.</p>
        </section>
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
              onShare={() =>
                void share(
                  file,
                  title,
                  subtitle,
                  statementSections(statement, { money: currency, unit: '' }),
                  {
                    text: statementMessage(statement.customer.name, t.owedNow, company),
                    phone: statement.customer.phone,
                  },
                )
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
                placeholder={w('Job, payment, reference, amount\u2026')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Show
              <select value={show} onChange={(e) => setShow(e.target.value)}>
                <option value="all">All records</option>
                <option value="jobs">{w('Jobs only')}</option>
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
              display={stageLabel}
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
              <h2>{w('Jobs in this period')}</h2>
              <JobTable jobs={statement.jobs as StatementJob[]} label={w('Jobs in this period')} />
            </section>
          )}
          {statement.earlierOwing.length > 0 && (
            <section className="panel">
              <h2>{w('Earlier jobs still owing')}</h2>
              <p className="muted report-none">
                Created before {statement.from}; included so the total owed is fully explained.
              </p>
              <JobTable
                jobs={statement.earlierOwing as StatementJob[]}
                label={w('Earlier jobs still owing')}
              />
            </section>
          )}
          {statement.laterOwing.length > 0 && (
            <section className="panel">
              <h2>{w('Later jobs still owing')}</h2>
              <p className="muted report-none">Created after {statement.to}.</p>
              <JobTable jobs={statement.laterOwing as StatementJob[]} label={w('Later jobs still owing')} />
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
                      { index: 5, label: w('Jobs paid') },
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
                          <th>{w('Jobs paid')}</th>
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
                        <th>{w('Job')}</th>
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
  const { w } = useWords();
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
      <span>{w(label)}</span>
      <strong>{currency(value)}</strong>
      <small>{w(note)}</small>
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
                {w('Jobs, payments, refunds')}
                {access.expenses ? ', expense payments' : ''}, corrections
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
              display={w}
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
                        <th>{w('Customer / payee / material')}</th>
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
                            <small>{w(r.type)}</small>
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
                  <Icon name="add" /> Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit}{' '}
                  hidden)
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function ProfitTab({ ledger, freshness, busy, error, pdf, csv }: TabProps) {
  const { range, valid, controls } = useRange();
  const report = useMemo(
    () => (valid ? (profitReport(ledger, range.from, range.to) as ProfitReport) : null),
    [ledger, range.from, range.to, valid],
  );
  const [showJobs, setShowJobs] = useState(false);
  const title = 'Profit';
  const subtitle = report
    ? [
        `Period: ${report.from} to ${report.to}`,
        'Estimated from the costs set in Pricing Templates; jobs with no cost set are counted separately.',
      ]
    : [];
  const file = report ? reportFileName('Profit', `${report.from} to ${report.to}`) : '';
  const t = report?.totals;
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        {controls}
        <small>
          Dates use Africa/Lagos. Jobs count on the day they were sold; cancelled jobs are left out.
        </small>
      </section>
      {freshness}
      {!valid || !report || !t ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : (
        <>
          <section className="panel report-header">
            <div>
              <h2>
                {report.from} to {report.to}
              </h2>
              <small>
                Costs come from template estimates at the sale, service costs, the costs linked to each
                material, and materials added in production (unless already in the price).
              </small>
            </div>
            <Exports
              busy={busy}
              onCsv={() =>
                csv(
                  file,
                  title,
                  subtitle,
                  profitSections(report, { money: (k: number) => (k / 100).toFixed(2) }),
                )
              }
              onPdf={() =>
                void pdf(file, title, subtitle, profitSections(report, { money: currency, unit: '' }))
              }
            />
          </section>
          {error && (
            <p role="alert" className="dashboard-warning">
              {error}
            </p>
          )}
          <section className="stats dashboard-stats" aria-label="Profit summary">
            <article>
              <span>Estimated profit</span>
              <strong>{currency(t.profit)}</strong>
              <small>{t.margin === null ? 'No sales with a cost' : `${t.margin}% of sales`}</small>
            </article>
            <article>
              <span>Sales</span>
              <strong>{currency(t.revenue)}</strong>
              <small>{t.jobs - t.unknownJobs} jobs with a cost</small>
            </article>
            <article>
              <span>Estimated cost</span>
              <strong>{currency(t.cost)}</strong>
            </article>
            <article>
              <span>No cost set</span>
              <strong>{t.unknownJobs} jobs</strong>
              <small>{currency(t.unknownRevenue)} of sales not in the profit</small>
            </article>
            {!!t.otherIncome && (
              <article>
                <span>Other income</span>
                <strong>{currency(t.otherIncome)}</strong>
                <small>Gifts, grants and other money that is not a sale; not in the profit</small>
              </article>
            )}
          </section>
          <section className="panel">
            <h2>By service or template</h2>
            {report.byItem.length ? (
              <div className="table-wrap">
                <table aria-label="Profit by service or template">
                  <thead>
                    <tr>
                      <th>Service / template</th>
                      <th>Sales</th>
                      <th>Cost</th>
                      <th>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byItem.map((g) => (
                      <tr key={g.item}>
                        <td>
                          {g.item}
                          <small>
                            {g.jobs} jobs{g.unknown ? ` · ${g.unknown} with no cost set` : ''}
                          </small>
                        </td>
                        <td>{currency(g.revenue)}</td>
                        <td>{currency(g.cost)}</td>
                        <td className={g.profit < 0 ? 'danger-text' : undefined}>{currency(g.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted report-none">No jobs in this period.</p>
            )}
          </section>
          {report.jobs.length > 0 && (
            <section className="panel">
              <h2>Jobs</h2>
              <button type="button" className="text-button" onClick={() => setShowJobs(!showJobs)}>
                {showJobs ? 'Hide jobs' : `Show all ${report.jobs.length} jobs`}
              </button>
              {showJobs && (
                <div className="table-wrap">
                  <table aria-label="Profit by job">
                    <thead>
                      <tr>
                        <th>Date / job</th>
                        <th>Sale</th>
                        <th>Cost</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.jobs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.day} · {r.description}
                            <small>
                              {r.item} · {r.basis}
                            </small>
                          </td>
                          <td>{currency(r.revenue)}</td>
                          <td>{r.known ? currency(r.cost) : '—'}</td>
                          <td className={r.known && r.profit < 0 ? 'danger-text' : undefined}>
                            {r.known ? currency(r.profit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
type ProfitLoss = {
  from: string;
  to: string;
  sales: number;
  jobCost: number;
  grossProfit: number;
  expenses: { category: string; amount: number }[];
  operating: number;
  otherIncome: number;
  net: number;
  stockPurchases: number;
  unknownJobs: number;
  unknownSales: number;
};
function ProfitLossTab({ ledger, freshness, busy, error, pdf, csv }: TabProps) {
  const { range, valid, controls } = useRange();
  const report = useMemo(
    () =>
      valid ? (profitLoss(ledger, range.from, range.to) as ProfitLoss & { previous: ProfitLoss }) : null,
    [ledger, range.from, range.to, valid],
  );
  const title = 'Profit & loss';
  const subtitle = report
    ? [
        `Period: ${report.from} to ${report.to}, compared with ${report.previous.from} to ${report.previous.to}`,
        'Job costs are estimates from Pricing Templates; materials bought into stock are counted through the jobs that use them.',
      ]
    : [];
  const file = report ? reportFileName('Profit and loss', `${report.from} to ${report.to}`) : '';
  const change = (now: number, before: number) => {
    const d = now - before;
    return d === 0
      ? 'Same as the period before'
      : `${d > 0 ? '+' : '−'}${currency(Math.abs(d))} on the period before`;
  };
  const line = (
    label: string,
    now: number,
    before: number,
    opts: { strong?: boolean; minus?: boolean } = {},
  ) => (
    <tr className={opts.strong ? 'report-total' : undefined}>
      <td>{opts.strong ? <strong>{label}</strong> : label}</td>
      <td className={now < 0 && !opts.minus ? 'danger-text' : undefined}>
        {opts.minus && now ? '−' : ''}
        {opts.strong ? <strong>{currency(now)}</strong> : currency(now)}
      </td>
      <td>
        {opts.minus && before ? '−' : ''}
        {currency(before)}
      </td>
    </tr>
  );
  return (
    <>
      <section className="panel dashboard-filters report-filters">
        {controls}
        <small>Dates use Africa/Lagos. Jobs count on the day they were sold; expenses on their date.</small>
      </section>
      {freshness}
      {!valid || !report ? (
        <div className="dashboard-warning" role="alert">
          Choose valid From and To dates, in order, spanning no more than ten years.
        </div>
      ) : (
        <>
          <section className="panel report-header">
            <div>
              <h2>
                {report.from} to {report.to}
              </h2>
              <small>
                Compared with {report.previous.from} to {report.previous.to}. Loans and owner money are not
                income or expenses; loan interest is an expense.
              </small>
            </div>
            <Exports
              busy={busy}
              onCsv={() =>
                csv(
                  file,
                  title,
                  subtitle,
                  profitLossSections(report, { money: (k: number) => (k / 100).toFixed(2) }),
                )
              }
              onPdf={() =>
                void pdf(file, title, subtitle, profitLossSections(report, { money: currency, unit: '' }))
              }
            />
          </section>
          {error && (
            <p role="alert" className="dashboard-warning">
              {error}
            </p>
          )}
          <section className="stats dashboard-stats" aria-label="Profit and loss summary">
            <article>
              <span>Net profit</span>
              <strong className={report.net < 0 ? 'danger-text' : undefined}>{currency(report.net)}</strong>
              <small>{change(report.net, report.previous.net)}</small>
            </article>
            <article>
              <span>Gross profit</span>
              <strong>{currency(report.grossProfit)}</strong>
              <small>
                Sales {currency(report.sales)} less estimated job costs {currency(report.jobCost)}
              </small>
            </article>
            <article>
              <span>Expenses</span>
              <strong>{currency(report.operating)}</strong>
              <small>{change(report.operating, report.previous.operating)}</small>
            </article>
            {(report.otherIncome > 0 || report.previous.otherIncome > 0) && (
              <article>
                <span>Other income</span>
                <strong>{currency(report.otherIncome)}</strong>
                <small>Gifts, grants and other money that is not a sale</small>
              </article>
            )}
          </section>
          <section className="panel">
            <h2>Statement</h2>
            <div className="table-wrap">
              <table aria-label="Profit and loss statement">
                <thead>
                  <tr>
                    <th />
                    <th>This period</th>
                    <th>Period before</th>
                  </tr>
                </thead>
                <tbody>
                  {line('Sales (after discounts)', report.sales, report.previous.sales)}
                  {line('Estimated cost of jobs', report.jobCost, report.previous.jobCost, { minus: true })}
                  {line('Gross profit', report.grossProfit, report.previous.grossProfit, { strong: true })}
                  {[...new Set([...report.expenses, ...report.previous.expenses].map((x) => x.category))].map(
                    (c) => (
                      <Fragment key={c}>
                        {line(
                          c,
                          report.expenses.find((x) => x.category === c)?.amount ?? 0,
                          report.previous.expenses.find((x) => x.category === c)?.amount ?? 0,
                          { minus: true },
                        )}
                      </Fragment>
                    ),
                  )}
                  {line('Total expenses', report.operating, report.previous.operating, { minus: true })}
                  {line('Other income', report.otherIncome, report.previous.otherIncome)}
                  {line('Net profit', report.net, report.previous.net, { strong: true })}
                </tbody>
              </table>
            </div>
            {report.stockPurchases > 0 && (
              <p className="muted">
                {currency(report.stockPurchases)} of materials bought into stock in this period is not listed
                as an expense: its cost is counted in the jobs that use the materials.
              </p>
            )}
            {report.unknownJobs > 0 && (
              <p className="notice notice-warning">
                {report.unknownJobs} job{report.unknownJobs === 1 ? ' is' : 's are'} not fully costed, so{' '}
                {currency(report.unknownSales)} of sales is counted with only the costs that are known. Give
                those items (and their materials) a cost in Pricing Templates → Costs for a truer profit.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
type ProfitReport = {
  from: string;
  to: string;
  totals: {
    jobs: number;
    revenue: number;
    cost: number;
    profit: number;
    margin: number | null;
    unknownJobs: number;
    unknownRevenue: number;
    otherIncome?: number;
  };
  byItem: { item: string; jobs: number; revenue: number; cost: number; profit: number; unknown: number }[];
  jobs: {
    id: string;
    day: string;
    item: string;
    description: string;
    revenue: number;
    cost: number;
    known: boolean;
    basis: string;
    profit: number;
  }[];
};

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
  const { terms } = useWords();
  const sections: ReportSection[] = summary
    ? nameSections(summarySections(summary, { money: currency, unit: '' }) as ReportSection[], terms)
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
