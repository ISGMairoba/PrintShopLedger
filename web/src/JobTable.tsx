import DeadlineProgress from './DeadlineProgress';
import Icon from './Icon';
import { useState, useEffect } from 'react';
import { groupJobsByCheckout } from './job-batches.mjs';
import { materialPending } from './material-choice.mjs';
import { jobWorkflow } from './business-options.mjs';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import JobActions, { type ProgressMode } from './JobActions';
import { jobBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import { lastJobPayment } from './job-progress.mjs';
import { deadlineState } from './job-deadlines.mjs';
import type { Ledger, Job } from './types';
import { useWords } from './Words';
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const time = (value: string) =>
  new Date(value).toLocaleTimeString('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
  });
export default function JobTable({
  ledger,
  jobs,
  sorting,
  busy,
  pointOfService = false,
  audit = false,
  onJob,
  onAction,
  onBulkAction,
  onDue,
  grouped = false,
  selecting = false,
  pageSort = false,
}: {
  ledger: Ledger;
  jobs: Job[];
  sorting: ReturnType<typeof useTableSort<Job>>;
  busy: boolean;
  pointOfService?: boolean;
  /** Show who added and last changed each job. */
  audit?: boolean;
  onJob: (id: string) => void;
  onAction: (job: Job, mode: ProgressMode) => void;
  onDue?: (jobs: Job[]) => void;
  onBulkAction?: (jobs: Job[], mode: ProgressMode) => void;
  grouped?: boolean;
  selecting?: boolean;
  /** The page toolbar has its own Sort by. */
  pageSort?: boolean;
}) {
  const { w, stage: stageLabel } = useWords();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visibleKey = jobs.map((job) => job.id).join('|');
  useEffect(() => {
    const visible = new Set(visibleKey.split('|'));
    setSelectedIds((ids) => ids.filter((id) => visible.has(id)));
  }, [visibleKey]);
  useEffect(() => {
    if (!selecting) setSelectedIds([]);
  }, [selecting]);
  const selected = jobs.filter((job) => selectedIds.includes(job.id));
  const toggle = (items: Job[], checked: boolean) =>
    setSelectedIds((ids) =>
      checked
        ? [...new Set([...ids, ...items.map((job) => job.id)])]
        : ids.filter((id) => !items.some((job) => job.id === id)),
    );
  const actions = (items: Job[]) => (
    <div className="job-bulk-actions">
      {onDue && (
        <button
          className="secondary"
          disabled={
            busy ||
            !items.some((j) => !['Completed', 'Collected', 'Cancelled'].includes(j.productionStatus ?? ''))
          }
          onClick={() =>
            onDue(
              items.filter(
                (j) => !['Completed', 'Collected', 'Cancelled'].includes(j.productionStatus ?? ''),
              ),
            )
          }
        >
          <Icon name="calendar" /> Change due date
        </button>
      )}
      <button
        className="secondary"
        disabled={busy || !items.length}
        onClick={() => onBulkAction?.(items, 'next')}
      >
        <Icon name="next" /> Next action
      </button>
      <button
        className="secondary"
        disabled={busy || !items.length}
        onClick={() => onBulkAction?.(items, 'set')}
      >
        <Icon name="quantity" /> Set Action
      </button>
      <button
        className="secondary"
        disabled={busy || !items.length}
        onClick={() => onBulkAction?.(items, 'complete')}
      >
        <Icon name="complete" />{' '}
        {stageLabel('Completed') === 'Completed' ? 'Mark as Complete' : `Mark as ${stageLabel('Completed')}`}
      </button>
    </div>
  );
  const renderTable = (rows: Job[]) => (
    <ResponsiveTable
      pageSort={pageSort}
      columns={[
        { index: 0, label: w('Job'), details: [1, 3, 4] },
        { index: 2, label: 'Amount' },
        { index: -1, label: 'Actions', actions: true },
      ]}
      labels={{ 1: 'Customer', 3: 'Progress', 4: 'Date', 5: 'Added by', 6: 'Last changed' }}
      extraSortOptions={[
        { key: 'description', label: 'Description' },
        { key: 'id', label: w('Job ID') },
        { key: 'paid', label: 'Paid' },
        { key: 'outstanding', label: 'Outstanding' },
        { key: 'lastPayment', label: 'Last payment' },
        { key: 'source', label: 'Source' },
        { key: 'dueAt', label: 'Deadline' },
      ]}
    >
      <table className="jobs-table">
        <thead>
          <tr>
            <SortHeader label={w('Job')} column="service" sort={sorting} />
            <SortHeader label="Customer" column="customer" sort={sorting} />
            <SortHeader label="Amount" column="amount" sort={sorting} />
            <SortHeader label="Status / progress" column="status" sort={sorting} />
            <SortHeader label="Date" column="createdAt" sort={sorting} />
            {audit && (
              <>
                <SortHeader label="Added by" column="createdBy" sort={sorting} />
                <SortHeader label="Last changed" column="modifiedAt" sort={sorting} />
              </>
            )}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => {
            const jobStatuses = jobWorkflow(job);
            const customer = ledger.customers.find((c) => c.id === job.customerId),
              balance = jobBalance(ledger, job),
              stage = job.productionStatus ?? 'Added',
              lastPaid = lastJobPayment(ledger, job);
            return (
              <tr key={job.id}>
                <td>
                  <div className="job-info">
                    {onBulkAction && selecting && (
                      <label className="check-label job-selection">
                        <input
                          type="checkbox"
                          aria-label={`Select ${job.service} (${job.id.slice(0, 8).toUpperCase()})`}
                          disabled={busy}
                          checked={selectedIds.includes(job.id)}
                          onChange={(event) => toggle([job], event.target.checked)}
                        />{' '}
                        Select
                      </label>
                    )}
                    <button className="text-button job-service" onClick={() => onJob(job.id)}>
                      {job.service}
                    </button>
                    <small>{job.description}</small>
                    {job.quantity !== undefined && (
                      <small>
                        Quantity: {job.quantity}
                        {job.width != null && job.height != null ? ` (${job.width} × ${job.height})` : ''}
                      </small>
                    )}
                    <small>ID: {job.id.slice(0, 8).toUpperCase()}</small>
                  </div>
                </td>
                <td>
                  {customer?.name ?? 'Unknown customer'}
                  <small>{customer?.phone ?? ''}</small>
                </td>
                <td>
                  <strong>{currency(job.amount)}</strong>
                  <small>Paid: {currency(balance.paid)}</small>
                  <small>Outstanding: {currency(balance.outstanding)}</small>
                </td>
                <td>
                  <span
                    className={`badge ${balance.status === 'Fully paid' ? 'paid' : balance.status === 'Unpaid' ? 'unpaid' : 'partial'}`}
                  >
                    {balance.status}
                  </span>
                  <small>
                    Stage: {stageLabel(stage)}
                    {job.shelfItem ? ' · Shelf' : ''}
                  </small>
                  {materialPending(job) && stage !== 'Cancelled' && (
                    <small className="material-pending">Material to confirm</small>
                  )}
                  {pointOfService && (
                    <small>
                      Source: {job.source ?? 'Not recorded'}
                      {job.sourceNote && ` — ${job.sourceNote}`}
                    </small>
                  )}
                  <progress
                    className="job-progress"
                    aria-label={`Progress for ${job.description || job.service}`}
                    value={Math.max(0, jobStatuses.indexOf(stage))}
                    max={jobStatuses.length - 1}
                  />
                </td>
                <td>
                  <span className="job-date">
                    {!pointOfService && <small className="job-date-label">Added </small>}
                    {date(job.createdAt)}, {time(job.createdAt)}
                  </span>
                  {!pointOfService && <small>Last payment: {lastPaid ? date(lastPaid) : 'None'}</small>}
                  <DeadlineProgress job={job} />
                </td>
                {audit && (
                  <>
                    <td>
                      {job.createdByLabel || 'Not recorded'}
                      <small>
                        {date(job.createdAt)}, {time(job.createdAt)}
                      </small>
                    </td>
                    <td>
                      {job.modifiedByLabel || job.createdByLabel || 'Not recorded'}
                      {job.modifiedAt && (
                        <small>
                          {date(job.modifiedAt)}, {time(job.modifiedAt)}
                        </small>
                      )}
                    </td>
                  </>
                )}
                <td>
                  {/* The next stage stays the first (main) action; on phones the rest go under More. */}
                  <JobActions job={job} busy={busy} onAction={onAction} />
                  {onDue && !['Completed', 'Collected', 'Cancelled'].includes(job.productionStatus ?? '') && (
                    <button className="text-button" disabled={busy} onClick={() => onDue([job])}>
                      <Icon name="calendar" /> Change due date
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTable>
  );
  return (
    <>
      {onBulkAction && selecting && (
        <div className="job-batch-toolbar" role="region" aria-label="Selection actions">
          <label className="check-label">
            <input
              type="checkbox"
              aria-label={w('Select all visible jobs')}
              disabled={busy || !jobs.length}
              checked={jobs.length > 0 && selected.length === jobs.length}
              onChange={(event) => toggle(jobs, event.target.checked)}
            />{' '}
            Select all shown
          </label>
          <strong className="selection-count" aria-live="polite">
            {selected.length} selected
          </strong>
          {actions(selected)}
          {selected.length > 0 && (
            <button className="text-button" disabled={busy} onClick={() => setSelectedIds([])}>
              <Icon name="close" /> Clear
            </button>
          )}
        </div>
      )}
      {grouped && onBulkAction ? (
        <div className="checkout-groups">
          {groupJobsByCheckout(jobs).map((group) => {
            const items: Job[] = group.jobs;
            const total = items.reduce((sum, job) => sum + job.amount, 0);
            const paid = items.reduce((sum, job) => sum + jobBalance(ledger, job).paid, 0);
            const fullCount = group.checkoutId
              ? ledger.jobs.filter((job) => job.checkoutId === group.checkoutId).length
              : 1;
            const customer = ledger.customers.find((value) => value.id === items[0].customerId);
            return (
              <section className="checkout-group" key={group.key}>
                <div className="checkout-group-header">
                  <label className="check-label">
                    {selecting && (
                      <input
                        type="checkbox"
                        aria-label={`Select checkout ${group.checkoutId?.slice(0, 8).toUpperCase() ?? items[0].id.slice(0, 8).toUpperCase()}`}
                        checked={items.every((job) => selectedIds.includes(job.id))}
                        disabled={busy}
                        onChange={(event) => toggle(items, event.target.checked)}
                      />
                    )}
                    <strong>
                      {group.checkoutId
                        ? `Checkout ${group.checkoutId.slice(0, 8).toUpperCase()}`
                        : w('Individual job')}
                    </strong>
                  </label>
                  <span>
                    {customer?.name ?? 'Unknown customer'} · {customer?.phone ?? ''}
                  </span>
                </div>
                <p>
                  {items.length} {w(items.length === 1 ? 'job' : 'jobs')} shown
                  {fullCount > items.length ? ` of ${fullCount} — filters hide other items` : ''} ·{' '}
                  {date(items[0].createdAt)}, {time(items[0].createdAt)}
                </p>
                <p>
                  <strong>Total {currency(total)}</strong> · Paid {currency(paid)} · Outstanding{' '}
                  {currency(total - paid)}
                </p>
                {actions(items)}
                <details open>
                  <summary>View items</summary>
                  {renderTable(items)}
                </details>
              </section>
            );
          })}
          <p className="muted">
            Actions apply to the items shown. Change the filters to include hidden items.
          </p>
        </div>
      ) : (
        renderTable(jobs)
      )}
    </>
  );
}
