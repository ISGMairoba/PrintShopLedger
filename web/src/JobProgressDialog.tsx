import { useFeedbackMessage } from './Feedback';
import { jobWorkflow } from './business-options.mjs';
import { useState } from 'react';
import Modal from './Modal';
import type { Job } from './types';
import type { ProgressMode } from './JobActions';
import { useWords } from './Words';
export default function JobProgressDialog({
  job,
  mode,
  busy,
  onClose,
  onSave,
}: {
  job: Job;
  mode: ProgressMode;
  busy: boolean;
  onClose: () => void;
  onSave: (target: string) => Promise<void>;
}) {
  const { w, stage } = useWords();
  const stageName = stage;
  const jobStatuses = jobWorkflow(job);
  const index = jobStatuses.indexOf(job.productionStatus ?? 'Added');
  const [target, setTarget] = useState(mode === 'complete' ? 'Completed' : jobStatuses[index + 1]),
    [error, setError] = useFeedbackMessage('error');
  const path = jobStatuses.slice(index + 1, jobStatuses.indexOf(target) + 1);
  return (
    <Modal
      title={mode === 'set' ? w('Set job stage') : w(`Move job to ${stage(target)}?`)}
      busy={busy}
      onClose={onClose}
    >
      <strong>{job.service}</strong>
      <p>{job.description}</p>
      <p>Current stage: {stage(job.productionStatus ?? 'Added')}</p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
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
            <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
              {jobStatuses.slice(index + 1).map((stage) => (
                <option key={stage} value={stage}>
                  {stageName(stage)}
                </option>
              ))}
            </select>
          </label>
        )}
        <p>Proceed in order: {path.map(stage).join(' → ')}</p>
        <p className="muted">
          Each stage is recorded separately.{' '}
          {target === 'Collected'
            ? 'This action also records collection.'
            : w('Completion does not mark the job as collected.')}
        </p>
        <button disabled={busy || !path.length}>
          {mode === 'next' ? 'Confirm next action' : mode === 'complete' ? 'Mark as Complete' : 'Set action'}
        </button>
      </form>
    </Modal>
  );
}
