import { useId, useState } from 'react';
import DialogActions from './DialogActions';
import Icon from './Icon';
import Modal from './Modal';
import ResponsiveTable from './ResponsiveTable';
import { useTeam } from './TeamContext';
import {
  canConfirm,
  confirmEvent,
  myWork,
  personEvent,
  personName,
  recordedLate,
  teamPeople,
  toConfirm,
} from './team.mjs';
import type { LocalState, TeamEvent, TeamPerson, WorkRecord } from './types';
import { useWords } from './Words';

const when = (at?: string) =>
  at
    ? new Date(at).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
/** How a work record's credit reads: "Ada 60%, Tunde 40%", or the vendor. */
export function creditText(ledger: Parameters<typeof personName>[0], record: WorkRecord) {
  if (record.vendor) return `${record.vendor.name} (outside vendor)`;
  return record.shares
    .map((s) => `${personName(ledger, s.personId)} ${s.share}${record.unit === 'percent' ? '%' : ''}`)
    .join(', ');
}

/** A job's work records (job details), when Team work is on. */
export function JobWorkRecords({ job }: { job: { id: string } }) {
  const team = useTeam();
  const { stage } = useWords();
  if (!team) return null;
  const records = (team.ledger.workRecords ?? []).filter((r) => r.jobId === job.id);
  if (!records.length) return null;
  return (
    <details>
      <summary>Work records ({records.length})</summary>
      {records.map((r) => (
        <p key={r.id}>
          <strong>{stage(r.stage)}</strong>: {creditText(team.ledger, r)}
          {r.redo ? ' · redo' : ''}
          <br />
          <small className="muted">
            Done {when(r.doneAt)} · recorded {when(r.recordedAt)} by {r.recordedByLabel ?? '—'} ·{' '}
            {r.status === 'confirmed' ? `confirmed by ${r.confirmedByLabel ?? '—'}` : 'waiting to be confirmed'}
          </small>
        </p>
      ))}
    </details>
  );
}
/** The Users page's tabs when Team work is on. */
export function UsersTabs({
  value,
  onChange,
}: {
  value: 'users' | 'team' | 'confirm';
  onChange: (next: 'users' | 'team' | 'confirm') => void;
}) {
  const team = useTeam();
  const waiting = team ? toConfirm(team.ledger).length : 0;
  const tabs: ['users' | 'team' | 'confirm', string][] = [
    ['users', 'Users'],
    ['team', 'Team'],
    ['confirm', waiting ? `Work to confirm (${waiting})` : 'Work to confirm'],
  ];
  return (
    <div className="settings-tabs" role="tablist" aria-label="Users sections">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={value === key ? 'active' : 'secondary'}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
/** Users → Team and Work to confirm (plans/job-assignment.md). */
export default function TeamPage({
  section,
  branches,
  refused,
}: {
  section: 'team' | 'confirm';
  /** Open branches, when the business has several. */
  branches?: { id: string; name: string }[];
  /** Team changes the server refused (set aside so the rest synced). */
  refused?: LocalState['teamRefused'];
}) {
  const team = useTeam();
  const { stage } = useWords();
  const [editing, setEditing] = useState<TeamPerson | 'new' | null>(null);
  const [removing, setRemoving] = useState<TeamPerson | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  if (!team) return null;
  const { ledger, actor, busy } = team;
  const manage = actor.level >= 2;
  const run = async (events: TeamEvent[], done?: () => void) => {
    setError('');
    try {
      await team.save(events);
      done?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const jobOf = (id: string) => ledger.jobs.find((j) => j.id === id);
  if (section === 'confirm') {
    const waiting = toConfirm(ledger) as WorkRecord[];
    const mine = waiting.filter((r) => canConfirm(ledger, r, actor, { teamWork: team.settings }));
    return (
      <section className="panel">
        <h2>Work to confirm</h2>
        <p className="muted">
          Recorded work counts in reports once it is confirmed. You confirm others&apos; work; your own is
          confirmed by someone else.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {!waiting.length ? (
          <div className="empty">No work is waiting to be confirmed.</div>
        ) : (
          <>
            <div className="material-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy || !mine.length}
                onClick={() => setPicked(picked.length === mine.length ? [] : mine.map((r) => r.id))}
              >
                {picked.length === mine.length ? 'Clear selection' : `Select all you can confirm (${mine.length})`}
              </button>
              <button
                type="button"
                disabled={busy || !picked.length}
                onClick={() => void run([confirmEvent(picked, actor) as TeamEvent], () => setPicked([]))}
              >
                <Icon name="complete" /> Confirm selected ({picked.length})
              </button>
            </div>
            <div className="table-wrap">
              <ResponsiveTable
                columns={[
                  { index: 1, label: 'Job', details: [2, 3, 4, 5] },
                  { index: 0, label: 'Select', actions: true },
                ]}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Job</th>
                      <th>Stage</th>
                      <th>Done by</th>
                      <th>Done at · recorded</th>
                      <th>Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiting.map((r) => {
                      const job = jobOf(r.jobId);
                      const allowed = mine.includes(r);
                      return (
                        <tr key={r.id}>
                          <td className="cell-fit">
                            <input
                              type="checkbox"
                              aria-label="Select work record"
                              disabled={!allowed}
                              checked={picked.includes(r.id)}
                              onChange={(e) =>
                                setPicked(e.target.checked ? [...picked, r.id] : picked.filter((id) => id !== r.id))
                              }
                            />
                          </td>
                          <td>
                            <strong>{job?.service ?? 'Job'}</strong>
                            <small>{job?.description}</small>
                          </td>
                          <td>
                            {stage(r.stage)}
                            {r.redo && <small className="danger-text"> Redo</small>}
                          </td>
                          <td>{creditText(ledger, r)}</td>
                          <td className="cell-fit">
                            {when(r.doneAt)}
                            <small className={recordedLate(r) ? 'danger-text' : 'muted'}>
                              Recorded {when(r.recordedAt)}
                              {recordedLate(r) ? ' (late)' : ''}
                            </small>
                          </td>
                          <td>{r.recordedByLabel ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ResponsiveTable>
            </div>
          </>
        )}
      </section>
    );
  }
  const people = teamPeople(ledger, { all: true }) as TeamPerson[];
  const branchName = (id?: string | null) =>
    !id ? 'Every branch' : (branches?.find((b) => b.id === id)?.name ?? id);
  return (
    <section className="panel">
      <h2>Team</h2>
      <p className="muted">
        Everyone who does work. App users are on the Team automatically; add anyone else by name. They never
        get a sign-in.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!!refused?.length && (
        <div className="notice" role="status">
          <strong>Team changes the server did not save</strong>
          <ul>
            {refused.slice(-5).map((r) => (
              <li key={r.at + r.kind}>
                {when(r.at)}: {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {manage && (
        <div className="material-actions">
          <button type="button" disabled={busy} data-opens-dialog onClick={() => setEditing('new')}>
            <Icon name="add" /> Add person
          </button>
        </div>
      )}
      <div className="table-wrap">
        <ResponsiveTable
          columns={[
            { index: 0, label: 'Person', details: branches ? [1, 2, 3, 4] : [1, 2, 3] },
            { index: -1, label: 'Actions', actions: true },
          ]}
        >
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Assigned now</th>
                {branches && <th>Branch</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.id === actor.id ? ' (you)' : ''}
                    <small className="muted">{p.member ? 'App user' : 'Added by name'}</small>
                    {p.archived && <small className="danger-text">Removed</small>}
                  </td>
                  <td>{p.role || '—'}</td>
                  <td>{p.phone || '—'}</td>
                  <td className="cell-fit">{myWork(ledger, p.id).length}</td>
                  {branches && <td>{p.member ? '—' : branchName(p.branchId)}</td>}
                  <td>
                    {p.member ? (
                      <small className="muted">Change on the Users tab</small>
                    ) : (
                      manage && (
                        <div className="material-actions">
                          {!p.archived && (
                            <button
                              className="text-button"
                              disabled={busy}
                              data-opens-dialog
                              onClick={() => setEditing(p)}
                            >
                              <Icon name="edit" /> Edit
                            </button>
                          )}
                          <button
                            className={`text-button ${p.archived ? '' : 'danger-text'}`}
                            disabled={busy}
                            onClick={() =>
                              p.archived
                                ? void run([personEvent(p, { ...p, archived: false }, actor) as TeamEvent])
                                : setRemoving(p)
                            }
                          >
                            <Icon name={p.archived ? 'restore' : 'archive'} /> {p.archived ? 'Restore' : 'Remove'}
                          </button>
                        </div>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </div>
      {editing && (
        <PersonDialog
          person={editing === 'new' ? null : editing}
          branches={branches}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(fields) =>
            team.save([personEvent(editing === 'new' ? null : editing, fields, actor) as TeamEvent])
          }
        />
      )}
      {removing && (
        <Modal
          title={`Remove ${removing.name} from the Team?`}
          busy={busy}
          onClose={() => setRemoving(null)}
          footer={
            <div className="dialog-action-buttons">
              <button type="button" className="secondary" disabled={busy} onClick={() => setRemoving(null)}>
                <Icon name="close" /> Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() =>
                  void run([personEvent(removing, { ...removing, archived: true }, actor) as TeamEvent], () =>
                    setRemoving(null),
                  )
                }
              >
                <Icon name="archive" /> Remove
              </button>
            </div>
          }
        >
          <p>Their work records stay. They can no longer be assigned or credited, and you can restore them later.</p>
        </Modal>
      )}
    </section>
  );
}

function PersonDialog({
  person,
  branches,
  busy,
  onClose,
  onSave,
}: {
  person: TeamPerson | null;
  branches?: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (fields: { name: string; role: string; phone: string; branchId: string | null }) => Promise<void>;
}) {
  const formId = useId();
  const [error, setError] = useState('');
  return (
    <Modal
      title={person ? `Edit ${person.name}` : 'Add a Team person'}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Save person
        </DialogActions>
      }
    >
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const name = String(form.get('name') ?? '').trim();
          if (!name) return setError('Enter a name.');
          setError('');
          try {
            await onSave({
              name,
              role: String(form.get('role') ?? ''),
              phone: String(form.get('phone') ?? ''),
              branchId: String(form.get('branch') ?? '') || null,
            });
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Name
              <input name="name" required maxLength={80} defaultValue={person?.name ?? ''} />
            </label>
            <label>
              Role (optional)
              <input name="role" maxLength={60} placeholder="e.g. Finisher" defaultValue={person?.role ?? ''} />
            </label>
            <label>
              Phone (optional)
              <input name="phone" type="tel" maxLength={40} defaultValue={person?.phone ?? ''} />
            </label>
            {branches && (
              <label>
                Branch
                <select name="branch" defaultValue={person?.branchId ?? ''}>
                  <option value="">Every branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
