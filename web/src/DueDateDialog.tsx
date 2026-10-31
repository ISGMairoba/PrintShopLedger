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
            await onSave(
              operationEvent(
                'job.due_changed',
                {
                  id: jobs[0].id,
                  jobIds: jobs.map((j) => j.id),
                  expectedDueDates: Object.fromEntries(jobs.map((j) => [j.id, j.dueAt ?? ''])),
                  dueAt: fromLocalInput(due),
                  reason,
                },
                actor,
              ) as OperationsEvent,
            );
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
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <small>Clear this field to remove the deadline.</small>
          <div className="material-actions">
            {[1, 2, 7].map((days) => (
              <button
                className="secondary"
                type="button"
                key={days}
                onClick={() =>
                  setDue(
                    toLocalInput(
                      new Date(
                        Math.max(Date.now(), ...jobs.map((j) => Date.parse(j.dueAt ?? '') || 0)) +
                          days * 86400000,
                      ).toISOString(),
                    ),
                  )
                }
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
