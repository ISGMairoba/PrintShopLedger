import { useState } from 'react';
import { jobWorkflow } from './business-options.mjs';
import Icon from './Icon';
import Modal from './Modal';
import { HOLD_REASONS } from './job-hold.mjs';
import type { Job } from './types';
import { useWords } from './Words';
import { TellCustomer } from './ReadyMessage';
export type ProgressMode = 'next' | 'set' | 'complete';
export type HoldChange = { reason: string; note: string } | null;
export default function JobActions({
  job,
  busy,
  onAction,
  onHold,
}: {
  job: Job;
  busy: boolean;
  onAction: (job: Job, mode: ProgressMode) => void;
  /** Put the job on hold (with a reason) or resume it (null). Left out: no hold buttons. */
  onHold?: (job: Job, hold: HoldChange) => Promise<void>;
}) {
  const { stage } = useWords();
  const jobStatuses = jobWorkflow(job);
  const index = jobStatuses.indexOf(job.productionStatus ?? 'Added'),
    next = jobStatuses[index + 1];
  const held = !!job.hold;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(HOLD_REASONS[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const inProduction = !['Completed', 'Collected', 'Cancelled'].includes(job.productionStatus ?? 'Added');
  const run = async (hold: HoldChange) => {
    if (!onHold) return;
    setError('');
    try {
      await onHold(job, hold);
      setAsking(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="job-actions">
      <button
        className="text-button"
        disabled={busy || held || job.productionStatus === 'Cancelled' || !next}
        onClick={() => onAction(job, 'next')}
      >
        <Icon name="next" /> {next ? `Next: ${stage(next)}` : 'Next action'}
      </button>
      <button
        className="text-button"
        disabled={busy || held || job.productionStatus === 'Cancelled' || !next}
        onClick={() => onAction(job, 'set')}
      >
        <Icon name="quantity" /> Set Action
      </button>
      <button
        className="text-button"
        disabled={
          busy || held || job.productionStatus === 'Cancelled' || index >= jobStatuses.indexOf('Completed')
        }
        onClick={() => onAction(job, 'complete')}
      >
        <Icon name="complete" />{' '}
        {stage('Completed') === 'Completed' ? 'Mark as Complete' : `Mark as ${stage('Completed')}`}
      </button>
      <TellCustomer job={job} busy={busy} />
      {onHold && held && (
        <button className="text-button" disabled={busy} onClick={() => void run(null)}>
          <Icon name="next" /> Resume
        </button>
      )}
      {onHold && !held && inProduction && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setReason(HOLD_REASONS[0]);
            setNote('');
            setError('');
            setAsking(true);
          }}
        >
          <Icon name="reminder" /> Put on hold
        </button>
      )}
      {error && !asking && (
        <small className="danger-text" role="alert">
          {error}
        </small>
      )}
      {asking && (
        <Modal title="Put job on hold" busy={busy} onClose={() => setAsking(false)}>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p className="muted">
            The job stays at {stage(job.productionStatus ?? 'Added')} and its stage clock stops until you
            resume it.
          </p>
          <label>
            Waiting for
            <select aria-label="Hold reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {HOLD_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note{reason === 'Other' ? '' : ' (optional)'}
            <input
              aria-label="Hold note"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="material-actions">
            <button type="button" className="secondary" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void run({ reason, note })}>
              Put on hold
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
