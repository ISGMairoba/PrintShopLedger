import { jobBalanceFast, lastPaymentFast } from './balances.mjs';
import jobViewItems from './JobViewControls';
import ToolbarActions from './ToolbarActions';
import Icon from './Icon';
import JobTable from './JobTable';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import type { ProgressMode } from './JobActions';
import { paymentName } from './business-options.mjs';
import { currency, dateLabel, shortId } from './app/shared';
import { useMemo, useState } from 'react';
import { useShowMore } from './ShowMore';
import { useDateFilter } from './PeriodFilter';
import { inPeriod } from './dashboard.mjs';
import type { CheckoutRecord, Job, Ledger, Payment } from './types';
import { useWords } from './Words';

type Props = {
  page: 'Jobs' | 'Payments';
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  /** A held sync conflict blocks new work until it is reviewed. */
  legacyConflict: boolean;
  query: string;
  onQuery: (query: string) => void;
  /** New job (Jobs) or record payment (Payments). */
  onCreate: () => void;
  onAddCustomer: () => void;
  onJob: (jobId: string) => void;
  onAction: (job: Job, mode: ProgressMode) => void;
  onDue?: (jobs: Job[]) => void;
  onBulkAction: (jobs: Job[], mode: ProgressMode) => void;
  onReceipt: (record: CheckoutRecord) => void;
  /** Admin or higher (online): correct a payment's amount, method, date or reference. */
  onCorrectPayment?: (payment: Payment) => void;
};

/** The Jobs and Payments list pages: totals, sort and search, and the table. */
export default function JobsPaymentsPage({
  page,
  ledger,
  ready,
  busy,
  legacyConflict,
  query,
  onQuery,
  onCreate,
  onAddCustomer,
  onJob,
  onAction,
  onDue,
  onBulkAction,
  onReceipt,
  onCorrectPayment,
}: Props) {
  const { w } = useWords();
  const [grouped, setGrouped] = useState(false);
  const [selecting, setSelecting] = useState(false);
  // Looked up once per list of customers, not once per job.
  const customersById = useMemo(() => new Map(ledger.customers.map((c) => [c.id, c])), [ledger.customers]);
  const customerName = (id: string) => customersById.get(id)?.name ?? 'Unknown customer';
  const jobsById = useMemo(() => new Map(ledger.jobs.map((job) => [job.id, job])), [ledger.jobs]);
  const checkoutsById = useMemo(
    () => new Map((ledger.checkouts ?? []).map((record) => [record.id, record])),
    [ledger.checkouts],
  );
  const search = query.toLowerCase();
  const dates = useDateFilter(page === 'Jobs' ? 'jobs' : 'payments');
  const period = dates.period;
  const [audit, setAudit] = useState(false);
  const jobSorting = useTableSort<Job>('createdAt', 'desc');
  const paymentSorting = useTableSort<Payment>('createdAt', 'desc');
  const matchingJobs = jobSorting.sortRows(
    ledger.jobs.filter(
      (job) =>
        inPeriod(job.createdAt, period) &&
        `${job.createdByLabel ?? ''} ${job.modifiedByLabel ?? ''} ${job.description} ${job.service} ${customerName(job.customerId)} ${customersById.get(job.customerId)?.phone ?? ''} ${job.productionStatus ?? 'Added'} ${job.id}`
          .toLowerCase()
          .includes(search),
    ),
    {
      createdAt: (job) => Date.parse(job.createdAt),
      service: (job) => job.service,
      description: (job) => job.description,
      id: (job) => job.id,
      customer: (job) => customerName(job.customerId),
      amount: (job) => job.amount,
      paid: (job) => jobBalanceFast(ledger, job).paid,
      outstanding: (job) => jobBalanceFast(ledger, job).outstanding,
      status: (job) => job.productionStatus ?? 'Added',
      lastPayment: (job) => Date.parse(lastPaymentFast(ledger, job) ?? '') || 0,
      source: (job) => job.source ?? '',
      dueAt: (job) => Date.parse(job.dueAt ?? '') || Number.MAX_SAFE_INTEGER,
      createdBy: (job) => job.createdByLabel ?? '',
      modifiedAt: (job) => Date.parse(job.modifiedAt ?? job.createdAt),
    },
  );
  const matchingPayments = paymentSorting.sortRows(
    ledger.payments.filter(
      (payment) =>
        inPeriod(payment.paidOn, period) &&
        `${payment.id} ${customerName(payment.customerId)} ${payment.reference} ${paymentName(payment)}`
          .toLowerCase()
          .includes(search),
    ),
    {
      createdAt: (payment) => Date.parse(payment.createdAt),
      id: (payment) => payment.id,
      date: (payment) => Date.parse(payment.paidOn),
      customer: (payment) => customerName(payment.customerId),
      amount: (payment) => payment.amount,
      method: paymentName,
      allocations: (payment) =>
        payment.allocations
          .map((allocation) => jobsById.get(allocation.jobId)?.description ?? '')
          .join(', '),
    },
  );
  const pagedPayments = useShowMore(matchingPayments);
  // Totals describe the list as filtered (period and search).
  const balances = matchingJobs.map((job) => jobBalanceFast(ledger, job));
  const total = matchingJobs.reduce((sum, job) => sum + job.amount, 0);
  const paid = balances.reduce((sum, balance) => sum + balance.paid, 0);
  const outstanding = balances.reduce((sum, balance) => sum + balance.outstanding, 0);
  const received = matchingPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const allocated = matchingPayments.reduce(
    (sum, payment) => sum + payment.allocations.reduce((n, item) => n + item.amount, 0),
    0,
  );
  return (
    <>
      {page === 'Jobs' ? (
        <section className="stats">
          <article>
            <span>{w('Total job value')}</span>
            <strong>{currency(total)}</strong>
            <small>
              {w(`${matchingJobs.length} ${matchingJobs.length === 1 ? 'job' : 'jobs'} in this list`)}
            </small>
          </article>
          <article>
            <span>{w('Paid against jobs')}</span>
            <strong>{currency(paid)}</strong>
            <small>{w('Allocated to these jobs')}</small>
          </article>
          <article>
            <span>Outstanding</span>
            <strong>{currency(outstanding)}</strong>
            <small>
              {w(`${balances.filter((balance) => balance.outstanding > 0).length} jobs awaiting payment`)}
            </small>
          </article>
        </section>
      ) : (
        <section className="stats">
          <article>
            <span>Payments received</span>
            <strong>{currency(received)}</strong>
            <small>{matchingPayments.length} payments in this list</small>
          </article>
          <article>
            <span>{w('Allocated to jobs')}</span>
            <strong>{currency(allocated)}</strong>
            <small>{w('Paid against individual jobs')}</small>
          </article>
          <article>
            <span>Customers</span>
            <strong>{new Set(matchingPayments.map((payment) => payment.customerId)).size}</strong>
            <small>Paid in this list</small>
          </article>
        </section>
      )}
      <section className="panel">
        <div className="toolbar job-list-toolbar">
          <input
            aria-label={`Search ${page.toLowerCase()}`}
            placeholder={`Search ${page.toLowerCase()}.`}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          {dates.button}
          <label className="list-sort-select">
            Sort by
            <select
              aria-label={page === 'Jobs' ? w('Sort jobs by') : 'Sort payments by'}
              value={page === 'Jobs' ? jobSorting.key : paymentSorting.key}
              onChange={(e) => (page === 'Jobs' ? jobSorting : paymentSorting).toggle(e.target.value)}
            >
              {page === 'Jobs' ? (
                <>
                  <option value="createdAt">Created at</option>
                  <option value="id">{w('Job ID')}</option>
                  <option value="description">Description</option>
                  <option value="service">{w('Service')}</option>
                  <option value="customer">Customer</option>
                  <option value="amount">{w('Job amount')}</option>
                  <option value="paid">Paid</option>
                  <option value="outstanding">Outstanding</option>
                  <option value="status">{w('Job stage')}</option>
                  <option value="lastPayment">Last payment date</option>
                  <option value="dueAt">Deadline</option>
                  <option value="createdBy">Added by</option>
                  <option value="modifiedAt">Last changed</option>
                </>
              ) : (
                <>
                  <option value="createdAt">Created at</option>
                  <option value="id">Payment ID</option>
                  <option value="date">Payment date</option>
                  <option value="customer">Customer</option>
                  <option value="amount">Amount</option>
                  <option value="method">Method</option>
                  <option value="allocations">{w('Job allocations')}</option>
                </>
              )}
            </select>
          </label>
          <button
            className="secondary sort-direction"
            aria-label={
              (page === 'Jobs' ? jobSorting : paymentSorting).direction === 'asc'
                ? 'Ascending, reverse sort direction'
                : 'Descending, reverse sort direction'
            }
            title={
              (page === 'Jobs' ? jobSorting : paymentSorting).direction === 'asc' ? 'Ascending' : 'Descending'
            }
            onClick={() => {
              const sorting = page === 'Jobs' ? jobSorting : paymentSorting;
              sorting.toggle(sorting.key);
            }}
          >
            {(page === 'Jobs' ? jobSorting : paymentSorting).direction === 'asc' ? '↑' : '↓'}
          </button>
          <ToolbarActions
            more={
              page === 'Jobs'
                ? jobViewItems({
                    audit: audit,
                    onAudit: () => setAudit((value) => !value),
                    grouped: grouped,
                    selecting: selecting,
                    onGroup: () => setGrouped((value) => !value),
                    onSelect: () => setSelecting((value) => !value),
                  })
                : undefined
            }
          >
            <button
              disabled={!ready || busy || legacyConflict || (page === 'Payments' && !ledger.customers.length)}
              onClick={onCreate}
            >
              <Icon name="add" /> {page === 'Jobs' ? w('New job') : 'Record payment'}
            </button>
          </ToolbarActions>
        </div>
        {dates.panel}
        {!ready ? (
          <div className="empty">Loading saved records.</div>
        ) : page === 'Jobs' ? (
          <>
            {!ledger.jobs.length ? (
              <div className="empty">
                <div className="empty-icon">?</div>
                <h2>{w('Your jobs start here')}</h2>
                <p>{w('Add a customer, create their job, then record payments against it.')}</p>
                {!ledger.customers.length && (
                  <button onClick={onAddCustomer}>
                    <Icon name="add" /> Add your first customer
                  </button>
                )}
              </div>
            ) : (
              <div className="table-wrap">
                <JobTable
                  ledger={ledger}
                  jobs={matchingJobs}
                  sorting={jobSorting}
                  busy={busy || legacyConflict}
                  audit={audit}
                  onJob={onJob}
                  onAction={onAction}
                  onBulkAction={onBulkAction}
                  onDue={onDue}
                  grouped={grouped}
                  selecting={selecting}
                  pageSort
                />
                {!matchingJobs.length && <p className="empty">{w('No matching jobs.')}</p>}
              </div>
            )}
          </>
        ) : (
          <>
            {!ledger.payments.length ? (
              <div className="empty">
                <h2>A clear payment trail</h2>
                <p>{w('Payments appear here with the jobs they cover.')}</p>
              </div>
            ) : (
              <div className="table-wrap">
                <ResponsiveTable
                  pageSort
                  extraSortOptions={[
                    { key: 'createdAt', label: 'Created at' },
                    { key: 'date', label: 'Payment date' },
                  ]}
                  columns={[
                    { index: 0, label: 'Payment', details: [1, 4] },
                    { index: 2, label: 'Amount', details: [3] },
                    { index: -1, label: 'Actions' },
                  ]}
                >
                  <table>
                    <thead>
                      <tr>
                        <SortHeader label="Payment" column="id" sort={paymentSorting} />
                        <SortHeader label="Customer" column="customer" sort={paymentSorting} />
                        <SortHeader label="Amount" column="amount" sort={paymentSorting} />
                        <SortHeader label="Method" column="method" sort={paymentSorting} />
                        <SortHeader label={w('Job allocations')} column="allocations" sort={paymentSorting} />
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedPayments.shown.map((payment) => (
                        <tr key={payment.id}>
                          <td>
                            #{shortId(payment.id)}
                            <small>
                              {dateLabel(payment.paidOn)}
                              {payment.reference && ` · ${payment.reference}`}
                            </small>
                          </td>
                          <td>{customerName(payment.customerId)}</td>
                          <td>
                            {currency(payment.amount)}
                            {ledger.saleAdjustments.some((r) => r.paymentId === payment.id) && (
                              <small>{payment.amount ? 'Corrected' : 'Removed (₦0 correction)'}</small>
                            )}
                            <small>Wallet used: {currency(payment.walletUsed ?? 0)}</small>
                            <small>Wallet added: {currency(payment.walletAdded ?? 0)}</small>
                          </td>
                          <td>{paymentName(payment)}</td>
                          <td>
                            {payment.refundId && (
                              <strong>
                                Refund: {currency(payment.walletUsed ?? 0)}
                                <small>Money returned to customer</small>
                              </strong>
                            )}
                            {payment.allocations.map((allocation) => (
                              <small key={allocation.jobId}>
                                {jobsById.get(allocation.jobId)?.description} -{' '}
                                {currency(allocation.amount)}
                              </small>
                            ))}
                          </td>
                          <td>
                            <div className="material-actions stacked-actions">
                              {payment.checkoutId && checkoutsById.get(payment.checkoutId) && (
                                  <button
                                    className="text-button"
                                    onClick={() => onReceipt(checkoutsById.get(payment.checkoutId!)!)}
                                  >
                                    <Icon name="details" /> Receipt
                                  </button>
                                )}
                              {onCorrectPayment && !payment.refundId && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  aria-label={`Correct payment ${shortId(payment.id)}`}
                                  onClick={() => onCorrectPayment(payment)}
                                >
                                  <Icon name="edit" /> Correct
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
                {pagedPayments.more}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
