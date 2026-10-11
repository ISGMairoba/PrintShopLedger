import Icon from './Icon';
import JobTable from './JobTable';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import type { ProgressMode } from './JobActions';
import { paymentName } from './business-options.mjs';
import { jobBalance } from './domain.mjs';
import { lastJobPayment } from './job-progress.mjs';
import { currency, dateLabel, shortId } from './app/shared';
import { useState } from 'react';
import PeriodFilter, { allDates } from './PeriodFilter';
import { inPeriod } from './dashboard.mjs';
import type { CheckoutRecord, Job, Ledger, Payment } from './types';

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
  onReceipt: (record: CheckoutRecord) => void;
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
  onReceipt,
}: Props) {
  const total = ledger.jobs.reduce((sum, job) => sum + job.amount, 0);
  const paid = ledger.payments.reduce(
    (sum, payment) => sum + payment.allocations.reduce((allocated, item) => allocated + item.amount, 0),
    0,
  );
  const customerName = (id: string) =>
    ledger.customers.find((customer) => customer.id === id)?.name ?? 'Unknown customer';
  const search = query.toLowerCase();
  const [period, setPeriod] = useState(allDates);
  const [audit, setAudit] = useState(false);
  const jobSorting = useTableSort<Job>('createdAt', 'desc');
  const paymentSorting = useTableSort<Payment>('createdAt', 'desc');
  const matchingJobs = jobSorting.sortRows(
    ledger.jobs.filter(
      (job) =>
        inPeriod(job.createdAt, period) &&
        `${job.createdByLabel ?? ''} ${job.modifiedByLabel ?? ''} ${job.description} ${job.service} ${customerName(job.customerId)} ${ledger.customers.find((c) => c.id === job.customerId)?.phone ?? ''} ${job.productionStatus ?? 'Added'} ${job.id}`
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
      paid: (job) => jobBalance(ledger, job).paid,
      outstanding: (job) => jobBalance(ledger, job).outstanding,
      status: (job) => job.productionStatus ?? 'Added',
      lastPayment: (job) => Date.parse(lastJobPayment(ledger, job) ?? '') || 0,
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
          .map((allocation) => ledger.jobs.find((job) => job.id === allocation.jobId)?.description ?? '')
          .join(', '),
    },
  );
  return (
    <>
      <section className="stats">
        <article>
          <span>Total job value</span>
          <strong>{currency(total)}</strong>
          <small>{ledger.jobs.length} jobs</small>
        </article>
        <article>
          <span>Paid against jobs</span>
          <strong>{currency(paid)}</strong>
          <small>Allocated to individual jobs</small>
        </article>
        <article>
          <span>Outstanding</span>
          <strong>{currency(total - paid)}</strong>
          <small>
            {ledger.jobs.filter((job) => jobBalance(ledger, job).outstanding > 0).length} jobs awaiting
            payment
          </small>
        </article>
      </section>
      <section className="panel">
        <div className="toolbar">
          <label className="list-sort-select">
            Sort by
            <select
              aria-label={page === 'Jobs' ? 'Sort jobs by' : 'Sort payments by'}
              value={page === 'Jobs' ? jobSorting.key : paymentSorting.key}
              onChange={(e) => (page === 'Jobs' ? jobSorting : paymentSorting).toggle(e.target.value)}
            >
              {page === 'Jobs' ? (
                <>
                  <option value="createdAt">Created at</option>
                  <option value="id">Job ID</option>
                  <option value="description">Description</option>
                  <option value="service">Service</option>
                  <option value="customer">Customer</option>
                  <option value="amount">Job amount</option>
                  <option value="paid">Paid</option>
                  <option value="outstanding">Outstanding</option>
                  <option value="status">Job stage</option>
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
                  <option value="allocations">Job allocations</option>
                </>
              )}
            </select>
          </label>
          <button
            className="secondary"
            onClick={() => {
              const sorting = page === 'Jobs' ? jobSorting : paymentSorting;
              sorting.toggle(sorting.key);
            }}
          >
            {(page === 'Jobs' ? jobSorting : paymentSorting).direction === 'asc'
              ? 'Ascending ↑'
              : 'Descending ↓'}
          </button>
          <input
            aria-label={`Search ${page.toLowerCase()}`}
            placeholder={`Search ${page.toLowerCase()}.`}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <PeriodFilter value={period} onChange={setPeriod} allowAll />
          {page === 'Jobs' && (
            <button className="secondary" aria-pressed={audit} onClick={() => setAudit(!audit)}>
              <Icon name={audit ? 'table' : 'audit'} /> {audit ? 'Normal view' : 'Audit view'}
            </button>
          )}
          <button
            disabled={!ready || busy || legacyConflict || (page === 'Payments' && !ledger.customers.length)}
            onClick={onCreate}
          >
            <Icon name="add" /> {page === 'Jobs' ? 'New job' : 'Record payment'}
          </button>
        </div>
        {!ready ? (
          <div className="empty">Loading saved records.</div>
        ) : page === 'Jobs' ? (
          <>
            {!ledger.jobs.length ? (
              <div className="empty">
                <div className="empty-icon">?</div>
                <h2>Your jobs start here</h2>
                <p>Add a customer, create their job, then record payments against it.</p>
                {!ledger.customers.length && <button onClick={onAddCustomer}>Add your first customer</button>}
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
                />
                {!matchingJobs.length && <p className="empty">No matching jobs.</p>}
              </div>
            )}
          </>
        ) : (
          <>
            {!ledger.payments.length ? (
              <div className="empty">
                <h2>A clear payment trail</h2>
                <p>Payments appear here with the jobs they cover.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <ResponsiveTable
                  extraSortOptions={[
                    { key: 'createdAt', label: 'Created at' },
                    { key: 'date', label: 'Payment date' },
                  ]}
                  columns={[
                    { index: 0, label: 'Payment', details: [1] },
                    { index: 2, label: 'Amount', details: [3] },
                    { index: 4, label: 'Jobs' },
                  ]}
                >
                  <table>
                    <thead>
                      <tr>
                        <SortHeader label="Payment" column="id" sort={paymentSorting} />
                        <SortHeader label="Customer" column="customer" sort={paymentSorting} />
                        <SortHeader label="Amount" column="amount" sort={paymentSorting} />
                        <SortHeader label="Method" column="method" sort={paymentSorting} />
                        <SortHeader label="Job allocations" column="allocations" sort={paymentSorting} />
                      </tr>
                    </thead>
                    <tbody>
                      {matchingPayments.map((payment) => (
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
                            {payment.checkoutId &&
                              ledger.checkouts.find((r) => r.id === payment.checkoutId) && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    onReceipt(ledger.checkouts.find((r) => r.id === payment.checkoutId)!)
                                  }
                                >
                                  Receipt
                                </button>
                              )}
                            {payment.allocations.map((allocation) => (
                              <small key={allocation.jobId}>
                                {ledger.jobs.find((job) => job.id === allocation.jobId)?.description} -{' '}
                                {currency(allocation.amount)}
                              </small>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
