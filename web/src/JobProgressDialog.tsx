import { useFeedbackMessage } from './Feedback';
import { jobWorkflow } from './business-options.mjs';
import { useState } from 'react';
import Modal from './Modal';
import type { Job, Ledger } from './types';
import MaterialUsedFields, { usageDraft, usagesFrom, type UsageDraft } from './MaterialUsedFields';
import { materialConfirmDue } from './material-choice.mjs';
import type { ProgressMode } from './JobActions';
import { useWords } from './Words';
export default function JobProgressDialog({
  ledger,
  job,
  mode,
  busy,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  job: Job;
  mode: ProgressMode;
  busy: boolean;
  onClose: () => void;
  /** usages: the material(s) used, when this move confirms them (a choice-of-materials job). */
  onSave: (target: string, usages: { materialId: string; quantity: number }[] | null) => Promise<void>;
}) {
  const { w, stage } = useWords();
  const stageName = stage;
  const jobStatuses = jobWorkflow(job);
  const index = jobStatuses.indexOf(job.productionStatus ?? 'Added');
  const [target, setTarget] = useState(mode === 'complete' ? 'Completed' : jobStatuses[index + 1]),
    [error, setError] = useFeedbackMessage('error');
  const path = jobStatuses.slice(index + 1, jobStatuses.indexOf(target) + 1);
  const confirming = materialConfirmDue(job, target);
  const [draft, setDraft] = useState<UsageDraft>(() => (job.materialChoice ? usageDraft(job) : []));
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
            await onSave(target, confirming ? usagesFrom(draft) : null);
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
        {confirming && <MaterialUsedFields ledger={ledger} job={job} value={draft} onChange={setDraft} />}
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
