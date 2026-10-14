import jobViewItems from './JobViewControls';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { useState } from 'react';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import Icon from './Icon';
import JobTable from './JobTable';
import { lastJobPayment } from './job-progress.mjs';
import type { ProgressMode } from './JobActions';
import { jobBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import { useDateFilter } from './PeriodFilter';
import { inPeriod } from './dashboard.mjs';
import type { Ledger, Job, CheckoutRecord } from './types';
import { useWords } from './Words';
type Props = {
  ledger: Ledger;
  busy: boolean;
  ready: boolean;
  onCheckout: () => void;
  onPayment: () => void;
  /** Sell shelf items quickly (shown when the business has shelf items). */
  onQuickSale?: () => void;
  onJob: (id: string) => void;
  onNext: (job: Job, mode: ProgressMode) => void;
  onBulkAction: (jobs: Job[], mode: ProgressMode) => void;
  onReceipt: (record: CheckoutRecord) => void;
};
export default function PointOfServicePage({
  ledger,
  busy,
  ready,
  onCheckout,
  onPayment,
  onQuickSale,
  onJob,
  onNext,
  onBulkAction,
  onReceipt,
}: Props) {
  const { w } = useWords();
  const [grouped, setGrouped] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [query, setQuery] = useState(''),
    [showClosed, setShowClosed] = useState(false),
    [audit, setAudit] = useState(false),
    [receipts, setReceipts] = useState(false);
  const dates = useDateFilter('pointOfService'),
    period = dates.period;
  const sorting = useTableSort<Job>('createdAt', 'desc'),
    receiptSorting = useTableSort<CheckoutRecord>('createdAt', 'desc');
  const name = (id: string) => ledger.customers.find((c) => c.id === id)?.name ?? 'Unknown customer';
  const visible = sorting.sortRows(
    ledger.jobs.filter(
      (j) =>
        inPeriod(j.createdAt, period) &&
        (showClosed || !['Collected', 'Cancelled'].includes(j.productionStatus ?? 'Added')) &&
        [
          j.id,
          j.description,
          j.service,
          name(j.customerId),
          j.source,
          j.productionStatus ?? 'Added',
          j.createdAt,
          j.modifiedAt,
          j.createdByLabel,
          j.modifiedByLabel,
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
      dueAt: (j) => Date.parse(j.dueAt ?? '') || Number.MAX_SAFE_INTEGER,
      createdBy: (j) => j.createdByLabel ?? '',
      modifiedAt: (j) => Date.parse(j.modifiedAt ?? j.createdAt),
    },
  );
  const records = receiptSorting.sortRows(
    ledger.checkouts.filter(
      (r) =>
        inPeriod(r.createdAt, period) &&
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
      <div className="toolbar job-list-toolbar">
        <input
          aria-label="Search point of service"
          placeholder={w('Search job, customer, source or receipt')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {dates.button}
        <label className="check-label">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{' '}
          {w('Show collected and cancelled jobs')}
        </label>

        <ToolbarActions
          more={
            <>
              {jobViewItems({
                showBatch: !receipts,
                audit: audit,
                onAudit: () => setAudit((value) => !value),
                grouped: grouped,
                selecting: selecting,
                onGroup: () => setGrouped((value) => !value),
                onSelect: () => setSelecting((value) => !value),
              })}
              <MenuToggle pressed={receipts} icon="details" onClick={() => setReceipts((v) => !v)}>
                Receipts
              </MenuToggle>
            </>
          }
        >
          <button
            className="secondary"
            disabled={busy || !ready || !ledger.customers.length}
            onClick={onPayment}
          >
            <Icon name="payments" /> Receive payment
          </button>
          {onQuickSale && ledger.services.some((s) => s.shelfItem && !s.archived) && (
            <button className="secondary" disabled={busy || !ready} onClick={onQuickSale}>
              <Icon name="drawer" /> Quick sale
            </button>
          )}
          <button disabled={busy || !ready} onClick={onCheckout}>
            <Icon name="add" /> {w('Add job')}
          </button>
        </ToolbarActions>
      </div>
      {dates.panel}
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
                  <SortHeader column="total" label={w('New jobs')} sort={receiptSorting} />
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
          {!records.length && (
            <div className="empty">
              <h2>No receipts</h2>
              <p>No receipts match your search and dates.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <JobTable
            ledger={ledger}
            jobs={visible.slice(0, period.preset === 'all' ? undefined : 500)}
            sorting={sorting}
            busy={busy}
            audit={audit}
            pointOfService
            onJob={onJob}
            onAction={onNext}
            onBulkAction={onBulkAction}
            grouped={grouped}
            selecting={selecting}
          />
          {!visible.length && (
            <p className="empty">
              {w('No matching jobs. Add a job, choose a longer period or show collected and cancelled jobs.')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
