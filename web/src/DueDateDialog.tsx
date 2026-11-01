import { useState } from 'react';
import Modal from './Modal';
import { toLocalInput, fromLocalInput } from './job-deadlines.mjs';
import { operationEvent } from './operations.mjs';
import type { Job, OperationsEvent } from './types';
export default function DueDateDialog({
  jobs,
  busy,
  actor,
  onSave,
  onClose,
}: {
  jobs: Job[];
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: OperationsEvent) => Promise<void>;
  onClose: () => void;
}) {
  const [due, setDue] = useState(jobs.length === 1 ? toLocalInput(jobs[0].dueAt ?? '') : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  // Several jobs: Postpone moves each job from its own due date (or from now when it has none).
  const [shift, setShift] = useState<number | null>(null);
  const DAY = 86400000;
  const postponed = (job: Job, days: number) =>
    new Date(Math.max(Date.now(), Date.parse(job.dueAt ?? '') || 0) + days * DAY).toISOString();
  const save = (list: Job[], dueAt: string) =>
    onSave(
      operationEvent(
        'job.due_changed',
        {
          id: list[0].id,
          jobIds: list.map((j) => j.id),
          expectedDueDates: Object.fromEntries(list.map((j) => [j.id, j.dueAt ?? ''])),
          dueAt,
          reason,
        },
        actor,
      ) as OperationsEvent,
    );
  return (
    <Modal
      title={`Change due date · ${jobs.length} job${jobs.length === 1 ? '' : 's'}`}
      busy={busy}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <p>{jobs.map((j) => j.service + ': ' + j.description).join(' · ')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (shift !== null) {
              // One change per new date (jobs that end up on the same date are saved together).
              const groups = new Map<string, Job[]>();
              for (const job of jobs) {
                const at = postponed(job, shift);
                groups.set(at, [...(groups.get(at) ?? []), job]);
              }
              for (const [at, list] of groups) await save(list, at);
            } else await save(jobs, fromLocalInput(due));
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            New due date
            <input
              aria-label="New due date"
              type="datetime-local"
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setShift(null);
              }}
            />
          </label>
          <small>
            {shift !== null
              ? `Each job moves ${shift} day${shift === 1 ? '' : 's'} later than its own due date (jobs without one: from now).`
              : jobs.length > 1
                ? 'A date entered here applies to every selected job. Clear it to remove the deadlines.'
                : 'Clear this field to remove the deadline.'}
          </small>
          <div className="material-actions">
            {[1, 2, 7].map((days) => (
              <button
                className="secondary"
                type="button"
                key={days}
                onClick={() => {
                  if (jobs.length === 1) {
                    setDue(toLocalInput(postponed(jobs[0], days)));
                    setShift(null);
                  } else {
                    setDue('');
                    setShift(days);
                  }
                }}
              >
                Postpone {days} day{days === 1 ? '' : 's'}
              </button>
            ))}
          </div>
          <label>
            Reason
            <textarea
              aria-label="Reason for due date change"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="submit">Save due date</button>
        </fieldset>
      </form>
    </Modal>
  );
}
