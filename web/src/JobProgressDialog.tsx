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
import { useTeam } from './TeamContext';
import { assignedTo, stagesFinished } from './team.mjs';
import DoneByFields, { draftWork, vendorPayee, workDraft, type WorkDraft } from './DoneByFields';
import { usePaidFromOptions } from './paid-from';
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
    /** Team work: the "Done by" step's work record (team.mjs workEvents), when asked. */
    work?: Record<string, any> | null,
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
  // Team work: who did the stages this move finishes.
  const team = useTeam();
  const finishing = stagesFinished(job, target).filter((s: string) => s !== 'Added');
  const askDoneBy = !!team && team.settings.askDoneBy && finishing.length > 0;
  const paidFrom = usePaidFromOptions(team?.ledger.moneyAccounts ?? []);
  const [done, setDone] = useState<WorkDraft>(() =>
    workDraft(
      team
        ? assignedTo(team.ledger, job).filter(
            (id: string) => team.settings.othersRank <= team.actor.level || id === team.actor.id,
          )
        : [],
    ),
  );
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
            let work: Record<string, any> | null = null;
            if (askDoneBy && team) {
              const checked = draftWork(done, job, job.createdAt, team.settings.doneAtDays);
              if (checked.problem) throw Error(checked.problem);
              work = checked.work ?? null;
              // An outside vendor's cost: an expense for this job (paid now, or owed to the vendor).
              if (work?.vendor && work.vendor.cost > 0 && team.canExpense)
                work = {
                  ...work,
                  vendorExpense: {
                    payeeId: vendorPayee(team.ledger, work.vendor.name)?.id ?? null,
                    paidFrom: paidFrom.find((o) => o.key === done.vendorPaidFrom) ?? null,
                  },
                };
            }
            await onSave(target, confirming ? checkUsagesFrom(draft) : null, work);
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
        {askDoneBy && (
          <DoneByFields
            job={job}
            stage={finishing.map(stage).join(', ')}
            value={done}
            onChange={setDone}
            expense={!!team?.canExpense}
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
