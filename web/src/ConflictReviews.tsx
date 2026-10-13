import Modal from './Modal';
import { FeedbackBanner, type FeedbackTone } from './Feedback';
import { currency } from './app/shared';
import type {
  CustomerSyncConflict,
  ExpenseSyncConflict,
  JobSyncConflict,
  MaterialSyncConflict,
} from './cloud';
import { renameActive, stageActive } from './Words';

// Review windows for records changed on this device and in the business workspace at the same time.
// Each shows both versions side by side; the parent decides what "resolve" does.

type Choice = 'local' | 'cloud';
type Feedback = { message: string; tone: FeedbackTone };

export function ExpenseConflictReview({
  conflict,
  busy,
  onClose,
  onResolve,
}: {
  conflict: ExpenseSyncConflict;
  busy: boolean;
  onClose: () => void;
  onResolve: (choice: Choice) => void;
}) {
  const { local, remote } = conflict;
  const labels = {
    incurredOn: 'Date incurred',
    category: 'Category',
    payee: 'Supplier',
    note: 'Notes',
    receiptReference: 'Receipt reference',
  } as const;
  const materials = (items: typeof local.materials | undefined) =>
    items?.map((m) => `${m.name}: ${m.quantity} ${m.measurementUnit}`).join(' · ') || 'None';
  return (
    <Modal title="Review expense changes" wide busy={busy} onClose={onClose}>
      <p>{conflict.message}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>This device</th>
              <th>Business version</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Description</td>
              <td>{local.description}</td>
              <td>{remote?.description ?? 'Not available'}</td>
            </tr>
            <tr>
              <td>Total cost</td>
              <td>{currency(local.amount)}</td>
              <td>{remote ? currency(remote.amount) : '—'}</td>
            </tr>
            {(Object.keys(labels) as (keyof typeof labels)[]).map((field) => (
              <tr key={field}>
                <td>{labels[field]}</td>
                <td>{local[field] || '—'}</td>
                <td>{remote?.[field] || '—'}</td>
              </tr>
            ))}
            <tr>
              <td>Recorded payments</td>
              <td>{currency(local.payments.reduce((sum, p) => sum + p.amount, 0))}</td>
              <td>{currency(remote?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0)}</td>
            </tr>
            <tr>
              <td>Status</td>
              <td>{local.voided ? 'Voided' : 'Active'}</td>
              <td>{remote?.voided ? 'Voided' : 'Active'}</td>
            </tr>
            <tr>
              <td>{renameActive('Materials')}</td>
              <td>{materials(local.materials)}</td>
              <td>{materials(remote?.materials)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Reapplying keeps business payments and applies your pending expense changes against the latest stock.
        Keeping the business version discards this device’s pending changes to this expense.
      </p>
      <div className="material-actions">
        {(['local', 'cloud'] as const).map((choice) => (
          <button
            key={choice}
            disabled={busy}
            className={choice === 'cloud' ? 'secondary' : ''}
            onClick={() => onResolve(choice)}
          >
            {choice === 'local' ? 'Reapply pending changes' : 'Keep business version'}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function JobConflictReview({
  conflict,
  busy,
  onClose,
  onResolve,
}: {
  conflict: JobSyncConflict;
  busy: boolean;
  onClose: () => void;
  onResolve: () => void;
}) {
  return (
    <Modal title={renameActive('Review job progress')} busy={busy} onClose={onClose}>
      <p>{conflict.message}</p>
      <p>
        Business status:{' '}
        {stageActive(
          conflict.cloud.jobs.find((j) => j.id === conflict.event.data.id)?.productionStatus ?? 'Added',
        )}
      </p>
      <button disabled={busy} onClick={onResolve}>
        Use business status
      </button>
    </Modal>
  );
}

export function CustomerConflictReview({
  conflict,
  busy,
  feedback,
  onClose,
  onResolve,
}: {
  conflict: CustomerSyncConflict;
  busy: boolean;
  feedback: Feedback;
  onClose: () => void;
  onResolve: (choice: Choice) => void;
}) {
  const labels = {
    name: 'Full name',
    phone: 'Phone',
    address: 'Address',
    creditLimit: 'Credit limit',
    archived: 'Archived',
    modifiedByLabel: 'Modified by',
  } as const;
  return (
    <Modal title="Review conflicting customer edits" wide busy={busy} onClose={onClose}>
      <FeedbackBanner message={feedback.message} tone={feedback.tone} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>This device</th>
              <th>Business workspace</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(labels) as (keyof typeof labels)[]).map((field) => (
              <tr key={field}>
                <td>{labels[field]}</td>
                <td>
                  {field === 'creditLimit'
                    ? currency(conflict.local.creditLimit)
                    : String(conflict.local[field])}
                </td>
                <td>
                  {conflict.remote
                    ? field === 'creditLimit'
                      ? currency(conflict.remote.creditLimit)
                      : String(conflict.remote[field])
                    : 'Not available'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Keeping the business version discards pending edits to this customer. Other pending records are kept.
      </p>
      <div className="material-actions">
        <button disabled={busy} onClick={() => onResolve('local')}>
          Keep this device's version
        </button>
        <button className="secondary" disabled={busy} onClick={() => onResolve('cloud')}>
          Keep business version
        </button>
      </div>
    </Modal>
  );
}

export function MaterialConflictReview({
  conflict,
  busy,
  feedback,
  onClose,
  onResolve,
}: {
  conflict: MaterialSyncConflict;
  busy: boolean;
  feedback: Feedback;
  onClose: () => void;
  onResolve: (choice: Choice) => void;
}) {
  const { local, remote } = conflict;
  const rows: [string, string | number, string | number][] = [
    ['Name', local.name, remote.name],
    ['Available', local.available, remote.available],
    ['Measurement unit', local.measurementUnit, remote.measurementUnit],
    ['Minimum stock', local.minimumStock ?? 0, remote.minimumStock ?? 0],
    ['Require size', local.requireSize ? 'Yes' : 'No', remote.requireSize ? 'Yes' : 'No'],
    ['Status', local.archived ? 'Archived' : 'Active', remote.archived ? 'Archived' : 'Active'],
    ['Modified by', local.modifiedByLabel, remote.modifiedByLabel],
  ];
  return (
    <Modal title={renameActive('Review conflicting material edits')} wide busy={busy} onClose={onClose}>
      <FeedbackBanner message={feedback.message} tone={feedback.tone} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>This device</th>
              <th>Business workspace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, mine, theirs]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{mine}</td>
                <td>{theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Reapplying your edits preserves business stock movements. Stock additions add your pending quantities
        to the current business stock; stock-count corrections use your chosen count. Keeping the business
        version discards pending edits to this material. Other pending records are kept.
      </p>
      <div className="material-actions">
        <button disabled={busy} onClick={() => onResolve('local')}>
          Reapply pending edits
        </button>
        <button className="secondary" disabled={busy} onClick={() => onResolve('cloud')}>
          Keep business version
        </button>
      </div>
    </Modal>
  );
}
