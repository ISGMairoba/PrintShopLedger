import { useState } from 'react';
import Modal from './Modal';
import { useWords } from './Words';
import { useFeedbackMessage } from './Feedback';
import { jobWorkflow } from './business-options.mjs';
import { batchProgressPlan } from './job-batches.mjs';
import type { Job } from './types';
import type { ProgressMode } from './JobActions';

export default function BatchJobProgressDialog({
  jobs,
  mode,
  busy,
  onClose,
  onSave,
}: {
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
        <p className="muted">Mark as Complete leaves collection as a separate action.</p>
        <button disabled={busy || !eligible.length}>
          Apply to {eligible.length} {w(eligible.length === 1 ? 'job' : 'jobs')}
        </button>
      </form>
    </Modal>
  );
}
