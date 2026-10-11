import { jobWorkflow } from './business-options.mjs';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import JobActions, { type ProgressMode } from './JobActions';
import { jobBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import { lastJobPayment } from './job-progress.mjs';
import type { Ledger, Job } from './types';
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
  onJob,
  onAction,
}: {
  ledger: Ledger;
  jobs: Job[];
  sorting: ReturnType<typeof useTableSort<Job>>;
  busy: boolean;
  pointOfService?: boolean;
  onJob: (id: string) => void;
  onAction: (job: Job, mode: ProgressMode) => void;
}) {
  return (
    <ResponsiveTable
      columns={[
        { index: 0, label: 'Job', details: [1, 3, 4] },
        { index: 2, label: 'Amount' },
        { index: 5, label: 'Actions', actions: true },
      ]}
      labels={{ 1: 'Customer', 3: 'Progress', 4: 'Date' }}
      extraSortOptions={[
        { key: 'description', label: 'Description' },
        { key: 'id', label: 'Job ID' },
        { key: 'paid', label: 'Paid' },
        { key: 'outstanding', label: 'Outstanding' },
        { key: 'lastPayment', label: 'Last payment' },
        { key: 'source', label: 'Source' },
      ]}
    >
      <table className="jobs-table">
        <thead>
          <tr>
            <SortHeader label="Job" column="service" sort={sorting} />
            <SortHeader label="Customer" column="customer" sort={sorting} />
            <SortHeader label="Amount" column="amount" sort={sorting} />
            <SortHeader label="Status / progress" column="status" sort={sorting} />
            <SortHeader label="Date" column="createdAt" sort={sorting} />
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const jobStatuses = jobWorkflow(job);
            const customer = ledger.customers.find((c) => c.id === job.customerId),
              balance = jobBalance(ledger, job),
              stage = job.productionStatus ?? 'Added',
              lastPaid = lastJobPayment(ledger, job);
            return (
              <tr key={job.id}>
                <td>
                  <div className="job-info">
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
                    {pointOfService && (
                      <small>
                        Source: {job.source ?? 'Not recorded'}
                        {job.sourceNote && ` — ${job.sourceNote}`}
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
                  <small>Stage: {stage}</small>
                  <progress
                    className="job-progress"
                    aria-label={`Progress for ${job.description}`}
                    value={Math.max(0, jobStatuses.indexOf(stage))}
                    max={jobStatuses.length - 1}
                  />
                </td>
                <td>
                  {!pointOfService && <small>Added</small>}
                  {date(job.createdAt)}
                  <small>{time(job.createdAt)}</small>
                  {!pointOfService && <small>Last payment: {lastPaid ? date(lastPaid) : 'None'}</small>}
                </td>
                <td>
                  <JobActions job={job} busy={busy} onAction={onAction} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}
