import { useState } from 'react';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import Icon from './Icon';
import JobTable from './JobTable';
import { lastJobPayment } from './job-progress.mjs';
import type { ProgressMode } from './JobActions';
import { jobBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import type { Ledger, Job, CheckoutRecord } from './types';
type Props = {
  ledger: Ledger;
  busy: boolean;
  ready: boolean;
  onCheckout: () => void;
  onPayment: () => void;
  onJob: (id: string) => void;
  onNext: (job: Job, mode: ProgressMode) => void;
  onReceipt: (record: CheckoutRecord) => void;
};
export default function PointOfServicePage({
  ledger,
  busy,
  ready,
  onCheckout,
  onPayment,
  onJob,
  onNext,
  onReceipt,
}: Props) {
  const [query, setQuery] = useState(''),
    [allDates, setAllDates] = useState(false),
    [receipts, setReceipts] = useState(false);
  const sorting = useTableSort<Job>('createdAt', 'desc'),
    receiptSorting = useTableSort<CheckoutRecord>('createdAt', 'desc');
  const name = (id: string) => ledger.customers.find((c) => c.id === id)?.name ?? 'Unknown customer';
  const visible = sorting.sortRows(
    ledger.jobs.filter(
      (j) =>
        (allDates ||
          (Date.parse(j.createdAt) >= Date.now() - 30 * 86400000 &&
            !['Collected', 'Cancelled'].includes(j.productionStatus ?? 'Added'))) &&
        [
          j.id,
          j.description,
          j.service,
          name(j.customerId),
          j.source,
          j.productionStatus ?? 'Added',
          j.createdAt,
          j.modifiedAt,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    {
      id: (j) => j.id,
      service: (j) => j.service,
      paid: (j) => jobBalance(ledger, j).paid,
      lastPayment: (j) => Date.parse(lastJobPayment(ledger, j) ?? '') || 0,
      description: (j) => j.description,
      customer: (j) => name(j.customerId),
      amount: (j) => j.amount,
      outstanding: (j) => jobBalance(ledger, j).outstanding,
      status: (j) => j.productionStatus ?? 'Added',
      createdAt: (j) => Date.parse(j.createdAt),
      source: (j) => j.source ?? '',
    },
  );
  const records = receiptSorting.sortRows(
    ledger.checkouts.filter((r) =>
      [
        r.id,
        name(r.customerId),
        r.reference,
        r.createdByLabel,
        r.createdAt,
        r.cashReceived / 100,
        r.total / 100,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    {
      id: (r) => r.id,
      customer: (r) => name(r.customerId),
      total: (r) => r.total,
      cash: (r) => r.cashReceived,
      createdAt: (r) => Date.parse(r.createdAt),
    },
  );
  return (
    <section className="panel">
      <div className="toolbar">
        <input
          aria-label="Search point of service"
          placeholder="Search job, customer, source or receipt"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check-label">
          <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} /> Include
          older, collected and cancelled jobs
        </label>
        <button className="secondary" onClick={() => setReceipts((v) => !v)}>
          {receipts ? 'Show jobs' : 'Receipts'}
        </button>
        <button disabled={busy || !ready} onClick={onCheckout}>
          <Icon name="add" /> Add job
        </button>
        <button disabled={busy || !ready || !ledger.customers.length} onClick={onPayment}>
          <Icon name="payments" /> Receive payment
        </button>
      </div>
      {!ready ? (
        <p>Loading workspace…</p>
      ) : receipts ? (
        <div className="table-wrap">
          <ResponsiveTable
            columns={[
              { index: 0, label: 'Receipt', details: [1, 4] },
              { index: 2, label: 'Amount', details: [3] },
              { index: 5, label: 'Actions' },
            ]}
          >
            <table>
              <thead>
                <tr>
                  <SortHeader column="id" label="Receipt ID" sort={receiptSorting} />
                  <SortHeader column="customer" label="Customer" sort={receiptSorting} />
                  <SortHeader column="total" label="New jobs" sort={receiptSorting} />
                  <SortHeader column="cash" label="Money received" sort={receiptSorting} />
                  <SortHeader column="createdAt" label="Date" sort={receiptSorting} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id.slice(0, 8).toUpperCase()}</td>
                    <td>{name(r.customerId)}</td>
                    <td>{currency(r.total)}</td>
                    <td>{currency(r.cashReceived)}</td>
                    <td>{new Date(r.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</td>
                    <td>
                      <button className="text-button" onClick={() => onReceipt(r)}>
                        <Icon name="details" /> Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          {!records.length && <p className="empty">No receipts match.</p>}
        </div>
      ) : (
        <div className="table-wrap">
          <JobTable
            ledger={ledger}
            jobs={visible.slice(0, allDates ? undefined : 100)}
            sorting={sorting}
            busy={busy}
            pointOfService
            onJob={onJob}
            onAction={onNext}
          />
          {!visible.length && <p className="empty">No matching jobs. Add a job or include older records.</p>}
        </div>
      )}
    </section>
  );
}
