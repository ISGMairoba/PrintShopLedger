import Icon from './Icon';
import { TemplateSummary } from './TemplateFields';
import Modal from './Modal';
import { deadlineState } from './job-deadlines.mjs';
import JobActions, { type ProgressMode } from './JobActions';
import { AdjustmentHistory } from './SaleAdjustmentsPage';
import { paymentName } from './business-options.mjs';
import { jobBalance } from './domain.mjs';
import { currency, dateLabel, shortId } from './app/shared';
import type { Job, Ledger } from './types';
import { useWords } from './Words';

const lagosTime = (value: string) =>
  new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

type Props = {
  job: Job;
  ledger: Ledger;
  busy: boolean;
  /** Any held sync conflict (blocks adjustments). */
  hasConflict: boolean;
  /** A legacy sync conflict (blocks job actions and payments). */
  legacyConflict: boolean;
  /** Pending work for this customer is held for review. */
  customerHeld: boolean;
  /** The user may open Sale Adjustments. */
  canAdjust: boolean;
  /** Adjustments can be saved now (online, or the local trial). */
  canSave: boolean;
  onClose: () => void;
  onAdjust: (job: Job) => void;
  onAction: (job: Job, mode: ProgressMode) => void;
  onPayment: (customerId: string) => void;
};

/** One job: amounts, payment history, adjustments and the next actions. */
export default function JobDetails({
  job,
  ledger,
  busy,
  hasConflict,
  legacyConflict,
  customerHeld,
  canAdjust,
  canSave,
  onClose,
  onAdjust,
  onAction,
  onPayment,
}: Props) {
  const { w } = useWords();
  const customerName = (id: string) =>
    ledger.customers.find((customer) => customer.id === id)?.name ?? 'Unknown customer';
  return (
    <Modal
      title={job.description}
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <div className="dialog-action-buttons">
          {canAdjust && (
            <button
              type="button"
              className="secondary"
              disabled={busy || hasConflict || !canSave}
              onClick={() => onAdjust(job)}
            >
              <Icon name="adjustments" /> Adjust sale / refund
            </button>
          )}
          <button
            type="button"
            disabled={busy || legacyConflict || customerHeld || jobBalance(ledger, job).outstanding <= 0}
            onClick={() => onPayment(job.customerId)}
          >
            <Icon name="payments" /> Receive customer payment
          </button>
        </div>
      }
    >
      <span className="eyebrow">
        {w('JOB')} #{shortId(job.id)}
      </span>
      <p>
        {customerName(job.customerId)} · {job.service}
      </p>
      <p className="muted">
        Added by {job.createdByLabel || 'Not recorded'} on {lagosTime(job.createdAt)}
        {job.modifiedAt && job.modifiedAt !== job.createdAt
          ? ` · Last changed by ${job.modifiedByLabel || 'Not recorded'} on ${lagosTime(job.modifiedAt)}`
          : ''}
      </p>
      {(job.discountAmount ?? 0) > 0 && (
        <p className="muted">
          Price {currency(job.grossAmount ?? job.amount)} · Discount −{currency(job.discountAmount ?? 0)}
          {job.discount?.reason ? ` · ${job.discount.reason}` : ''} · given by{' '}
          {job.createdByLabel || 'Not recorded'}
        </p>
      )}
      {job.dueAt && !Number.isNaN(Date.parse(job.dueAt)) && (
        <p className={`deadline deadline-${deadlineState(job)}`}>
          Deadline: {lagosTime(job.dueAt)}
          {deadlineState(job) === 'overdue' && <span className="badge unpaid">Overdue</span>}
          {deadlineState(job) === 'soon' && <span className="badge partial">Due soon</span>}
        </p>
      )}
      {job.templateSnapshot && (
        <TemplateSummary snapshot={job.templateSnapshot} quantity={job.quantity ?? 1} amount={job.amount} />
      )}
      <div className="detail-summary">
        <span>
          {w('Job amount')} <strong>{currency(job.amount)}</strong>
        </span>
        <span>
          Paid <strong>{currency(jobBalance(ledger, job).paid)}</strong>
        </span>
        <span>
          Outstanding <strong>{currency(jobBalance(ledger, job).outstanding)}</strong>
        </span>
      </div>
      {job.productionStatus === 'Cancelled' && (
        <p className="notice notice-warning">
          This sale was cancelled. Original receipts and adjustments remain in history.
        </p>
      )}
      <h3>Payment history</h3>
      {ledger.payments
        .filter((payment) => payment.allocations.some((allocation) => allocation.jobId === job.id))
        .map((payment) => (
          <div className="history" key={payment.id}>
            <span>
              {dateLabel(payment.paidOn)} · {paymentName(payment)}
              <small>{payment.reference || `Payment #${shortId(payment.id)}`}</small>
            </span>
            <strong>
              {currency(payment.allocations.find((allocation) => allocation.jobId === job.id)!.amount)}
            </strong>
          </div>
        ))}
      {!ledger.payments.some((payment) =>
        payment.allocations.some((allocation) => allocation.jobId === job.id),
      ) && <p className="muted">No payments recorded yet.</p>}
      <AdjustmentHistory
        records={ledger.saleAdjustments.filter(
          (r) =>
            r.jobId === job.id ||
            r.paymentChanges.some((p) =>
              [...p.before.allocations, ...p.after.allocations].some((a) => a.jobId === job.id),
            ),
        )}
      />
      <section className="job-detail-stage" aria-label={w('Job stage')}>
        <h3>{w('Job stage')}</h3>
        <JobActions job={job} busy={busy || legacyConflict} onAction={onAction} />
      </section>
    </Modal>
  );
}
