import { useState } from 'react';
import Modal from './Modal';
import { useWords } from './Words';
import { useFeedbackMessage } from './Feedback';
import { jobWorkflow } from './business-options.mjs';
import { batchProgressPlan, collectionCheck } from './job-batches.mjs';
import { currency } from './receipts.mjs';
import type { Job, Ledger } from './types';
import type { ProgressMode } from './JobActions';

export default function BatchJobProgressDialog({
  ledger,
  jobs,
  mode,
  busy,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  jobs: Job[];
  mode: ProgressMode;
  busy: boolean;
  onClose: () => void;
  onSave: (target: string) => Promise<void>;
}) {
  const { w, stage } = useWords();
  const stages = [
    ...new Set(
      jobs.flatMap((job) => {
        const workflow = jobWorkflow(job);
        return job.productionStatus === 'Cancelled'
          ? []
          : workflow.slice(workflow.indexOf(job.productionStatus ?? 'Added') + 1);
      }),
    ),
  ];
  const [target, setTarget] = useState(stages[0] ?? '');
  const [error, setError] = useFeedbackMessage('error');
  const plan = batchProgressPlan(jobs, mode, target);
  const eligible = plan.filter((row) => !row.reason);
  const collect = collectionCheck(plan, ledger);
  const [unpaidConfirmed, setUnpaidConfirmed] = useState(false);
  return (
    <Modal title={w('Update selected jobs')} wide busy={busy} onClose={onClose}>
      <p>
        {eligible.length} will update · {plan.length - eligible.length} will be skipped.
      </p>
      <p className="muted">
        Each item moves forward through its own stages in order. Review the list before saving.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !eligible.length) return;
          setError('');
          try {
            await onSave(target);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        {mode === 'set' && (
          <label>
            Desired stage
            <select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
              {stages.map((value) => (
                <option key={value} value={value}>
                  {stage(value)}
                </option>
              ))}
            </select>
          </label>
        )}
        <ul className="batch-stage-preview">
          {plan.map((row) => (
            <li key={row.job.id}>
              <strong>{row.job.service}</strong> · {row.job.id.slice(0, 8).toUpperCase()}
              {row.job.description && <small>{row.job.description}</small>}
              <small>
                {stage(row.job.productionStatus ?? 'Added')} →{' '}
                {row.reason ? `Skipped: ${row.reason}` : row.path.map(stage).join(' → ')}
              </small>
            </li>
          ))}
        </ul>
        {collect.collecting > 0 ? (
          <div className="notice notice-warning" role="status">
            <strong>
              {collect.collecting} {w(collect.collecting === 1 ? 'job' : 'jobs')} will be marked{' '}
              {stage('Collected')}.
            </strong>{' '}
            This records that the customer has taken {collect.collecting === 1 ? 'it' : 'them'}.
            {collect.unpaid > 0 && (
              <>
                <p>
                  {collect.collecting === 1
                    ? 'It still owes '
                    : `${collect.unpaid} of these still ${collect.unpaid === 1 ? 'owes' : 'owe'} `}
                  <strong>{currency(collect.owed)}</strong>.
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={unpaidConfirmed}
                    onChange={(e) => setUnpaidConfirmed(e.target.checked)}
                  />{' '}
                  {w('Hand over unpaid jobs anyway')}
                </label>
              </>
            )}
          </div>
        ) : (
          <p className="muted">Mark as Complete leaves collection as a separate action.</p>
        )}
        <button disabled={busy || !eligible.length || (collect.unpaid > 0 && !unpaidConfirmed)}>
          Apply to {eligible.length} {w(eligible.length === 1 ? 'job' : 'jobs')}
        </button>
      </form>
    </Modal>
  );
}
