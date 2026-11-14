import Icon from './Icon';
import { useFeedbackMessage } from './Feedback';
import { jobWorkflow } from './business-options.mjs';
import { useState } from 'react';
import Modal from './Modal';
import type { Job, Ledger } from './types';
import MaterialCheckFields, { checkDraftFor, checkUsagesFrom, type CheckDraft } from './MaterialCheckFields';
import { materialConfirmDue } from './material-choice.mjs';
import type { ProgressMode } from './JobActions';
import { useWords } from './Words';
export default function JobProgressDialog({
  ledger,
  job,
  mode,
  busy,
  confirms,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  job: Job;
  mode: ProgressMode;
  busy: boolean;
  /** Whether this person's materials check applies at once (else it goes for approval). */
  confirms: boolean;
  onClose: () => void;
  /** usages: the materials used, when this move passes the job's confirmation stage. */
  onSave: (
    target: string,
    usages: { line: string; materialId: string; quantity: number }[] | null,
  ) => Promise<void>;
}) {
  const { w, stage } = useWords();
  const stageName = stage;
  const jobStatuses = jobWorkflow(job);
  const index = jobStatuses.indexOf(job.productionStatus ?? 'Added');
  const [target, setTarget] = useState(mode === 'complete' ? 'Completed' : jobStatuses[index + 1]),
    [error, setError] = useFeedbackMessage('error');
  const path = jobStatuses.slice(index + 1, jobStatuses.indexOf(target) + 1);
  const confirming = materialConfirmDue(job, target);
  const [draft, setDraft] = useState<CheckDraft>(() => checkDraftFor(ledger, job));
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
            await onSave(target, confirming ? checkUsagesFrom(draft) : null);
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
        {confirming && (
          <MaterialCheckFields
            ledger={ledger}
            job={job}
            value={draft}
            onChange={setDraft}
            confirms={confirms}
          />
        )}
        <p>Proceed in order: {path.map(stage).join(' → ')}</p>
        <p className="muted">
          Each stage is recorded separately.{' '}
          {target === 'Collected'
            ? 'This action also records collection.'
            : w('Completion does not mark the job as collected.')}
        </p>
        <button disabled={busy || !path.length}>
          <Icon name="complete" />{' '}
          {mode === 'next' ? 'Confirm next action' : mode === 'complete' ? 'Mark as Complete' : 'Set action'}
        </button>
      </form>
    </Modal>
  );
}
