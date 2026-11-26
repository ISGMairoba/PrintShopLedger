import { useId, useState } from 'react';
import DialogActions from './DialogActions';
import Icon from './Icon';
import Modal from './Modal';
import ResponsiveTable from './ResponsiveTable';
import { useTeam } from './TeamContext';
import DoneByFields, { draftFrom, draftWork } from './DoneByFields';
import { MaterialCorrectionRequest } from './MaterialCorrection';
import { pendingMaterialCorrections } from './material-corrections.mjs';
import {
  approverRank,
  canConfirm,
  confirmEvent,
  correctEvent,
  correctionRoute,
  decideEvent,
  pendingCorrections,
  myWork,
  personEvent,
  personName,
  recordedLate,
  teamPeople,
  termsEvent,
  termsOf,
  toConfirm,
} from './team.mjs';
import type {
  CommissionTerms,
  Job,
  LocalState,
  TeamEvent,
  TeamPerson,
  WorkCorrection,
  WorkRecord,
} from './types';
import { currency } from './receipts.mjs';
import { commissionBalance, payoutEvents } from './team-payouts.mjs';
import { usePaidFromOptions } from './paid-from';
import { money } from './domain.mjs';
import { roleNames } from './page-access.mjs';
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
  const [correcting, setCorrecting] = useState<WorkRecord | null>(null);
  if (!team) return null;
  const records = (team.ledger.workRecords ?? []).filter((r) => r.jobId === job.id);
  if (!records.length) return null;
  const full = team.ledger.jobs.find((j) => j.id === job.id);
  return (
    <details>
      <summary>Work records ({records.length})</summary>
      {correcting && full && (
        <CorrectWorkDialog record={correcting} job={full} onClose={() => setCorrecting(null)} />
      )}
      {records.map((r) => (
        <p key={r.id}>
          <strong>{stage(r.stage)}</strong>: {creditText(team.ledger, r)}
          {r.redo ? ' · redo' : ''}{' '}
          <button
            type="button"
            className="text-button"
            disabled={team.busy}
            data-opens-dialog
            onClick={() => setCorrecting(r)}
          >
            <Icon name="edit" /> Correct
          </button>
          <br />
          <small className="muted">
            {r.corrections?.length ? `Corrected ${r.corrections.length}× · ` : ''}
            Done {when(r.doneAt)} · recorded {when(r.recordedAt)} by {r.recordedByLabel ?? '—'} ·{' '}
            {r.status === 'confirmed'
              ? `confirmed by ${r.confirmedByLabel ?? '—'}`
              : 'waiting to be confirmed'}
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
  const waiting = team ? toConfirm(team.ledger).length + pendingMaterialCorrections(team.ledger).length : 0;
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
  const [terms, setTerms] = useState<TeamPerson | null>(null);
  const [paying, setPaying] = useState<{ person: TeamPerson; kind: 'payout' | 'deduction' } | null>(null);
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
    const requests = pendingCorrections(ledger) as WorkCorrection[];
    const materialRequests = pendingMaterialCorrections(ledger) as Job[];
    const waiting = toConfirm(ledger) as WorkRecord[];
    const mine = waiting.filter((r) => canConfirm(ledger, r, actor, { teamWork: team.settings }));
    return (
      <section className="panel">
        {!!(requests.length || materialRequests.length) && (
          <>
            <h2>Correction requests</h2>
            {materialRequests.map((job) => (
              <MaterialCorrectionRequest
                key={job.id}
                ledger={ledger}
                job={job}
                busy={busy}
                actor={actor}
                onSave={team.saveJob}
                showJob
              />
            ))}
            <ul className="request-list">
              {requests.map((c) => {
                const record = (ledger.workRecords ?? []).find((r) => r.id === c.recordId);
                const job = jobOf(c.jobId);
                const may = actor.level >= c.approverRank && c.requestedBy !== actor.id;
                return (
                  <li key={c.id} className="request-item pending">
                    <div>
                      <strong>{job?.service ?? 'Job'}</strong> · {record ? stage(record.stage) : ''} · asked
                      by {c.requestedByLabel} on {when(c.requestedAt)}
                      <br />
                      <small>
                        {record ? creditText(ledger, record) : '—'} →{' '}
                        {creditText(ledger, { ...(record as WorkRecord), ...c.changes } as WorkRecord)}
                      </small>
                      <br />
                      <small className="muted">
                        Why: {c.reason}
                        {may ? '' : ` · needs a ${roleNames[c.approverRank as 1] ?? 'higher rank'} or above`}
                      </small>
                    </div>
                    {may && (
                      <div className="material-actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void run([decideEvent(c, false, '', actor) as TeamEvent])}
                        >
                          <Icon name="close" /> Decline
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run([decideEvent(c, true, '', actor) as TeamEvent])}
                        >
                          <Icon name="complete" /> Approve
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
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
                {picked.length === mine.length
                  ? 'Clear selection'
                  : `Select all you can confirm (${mine.length})`}
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
                                setPicked(
                                  e.target.checked ? [...picked, r.id] : picked.filter((id) => id !== r.id),
                                )
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
  const setsTerms = team.settings.commission && actor.level >= team.settings.termsRank;
  const termsText = (id: string) => {
    const t = termsOf(ledger, id) as CommissionTerms | null;
    if (!t || t.kind === 'none') return t?.salesRate ? `${t.salesRate}% of sales` : '—';
    const work =
      t.kind === 'percent'
        ? `${t.rate}% of value`
        : `${currency(t.rate)} per ${t.kind === 'perJob' ? 'job' : t.kind === 'perStage' ? 'stage' : 'unit'}`;
    return t.salesRate ? `${work} + ${t.salesRate}% of sales` : work;
  };
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
            {
              index: 0,
              label: 'Person',
              details: [
                1,
                2,
                3,
                ...(team.settings.commission ? [4] : []),
                ...(branches ? [team.settings.commission ? 5 : 4] : []),
              ],
            },
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
                {team.settings.commission && <th>Commission</th>}
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
                  {team.settings.commission && (
                    <td>
                      {termsText(p.id)}
                      {setsTerms && !p.archived && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          data-opens-dialog
                          onClick={() => setTerms(p)}
                        >
                          <Icon name="edit" /> Terms
                        </button>
                      )}
                      {setsTerms &&
                        (() => {
                          const b = commissionBalance(ledger, p.id);
                          if (!b.earned && !b.paid && !b.deducted) return null;
                          return (
                            <>
                              <small>
                                {b.balance >= 0
                                  ? `Owed ${currency(b.balance)}`
                                  : `Advance ${currency(-b.balance)} (paid back from commission)`}
                              </small>
                              <span className="material-actions">
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  data-opens-dialog
                                  onClick={() => setPaying({ person: p, kind: 'payout' })}
                                >
                                  <Icon name="payments" /> Pay
                                </button>
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  data-opens-dialog
                                  onClick={() => setPaying({ person: p, kind: 'deduction' })}
                                >
                                  Deduct
                                </button>
                              </span>
                            </>
                          );
                        })()}
                    </td>
                  )}
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
                            <Icon name={p.archived ? 'restore' : 'archive'} />{' '}
                            {p.archived ? 'Restore' : 'Remove'}
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
      {paying && (
        <PayCommissionDialog
          person={paying.person}
          kind={paying.kind}
          onClose={() => setPaying(null)}
          onSave={(input) =>
            team
              .save(payoutEvents(ledger, paying.person.id, input, actor) as TeamEvent[])
              .then(() => setPaying(null))
          }
        />
      )}
      {terms && (
        <TermsDialog
          person={terms}
          current={termsOf(ledger, terms.id) as CommissionTerms | null}
          busy={busy}
          onClose={() => setTerms(null)}
          onSave={(commission) => team.save([termsEvent(ledger, terms.id, commission, actor) as TeamEvent])}
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
          <p>
            Their work records stay. They can no longer be assigned or credited, and you can restore them
            later.
          </p>
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
              <input
                name="role"
                maxLength={60}
                placeholder="e.g. Finisher"
                defaultValue={person?.role ?? ''}
              />
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

/** Correct a work record: saved at once, sent for approval, or saved with whoever recorded it told. */
export function CorrectWorkDialog({
  record,
  job,
  onClose,
}: {
  record: WorkRecord;
  job: Job;
  onClose: () => void;
}) {
  const team = useTeam();
  const { stage } = useWords();
  const [draft, setDraft] = useState(() => draftFrom(record));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  if (!team) return null;
  const route = correctionRoute(record, team.actor, { teamWork: team.settings });
  const approver = roleNames[approverRank(record, { teamWork: team.settings }) as 1] ?? 'higher rank';
  const outcome =
    route === 'direct'
      ? 'Your correction is saved at once, with the reason and what it was before.'
      : route === 'alert'
        ? `Your correction is saved at once, and ${record.recordedByLabel ?? 'whoever recorded it'} is told.`
        : `Your correction goes for approval by a ${approver} or above.`;
  const save = async () => {
    setError('');
    try {
      if (reason.trim().length < 3) throw Error('Give a reason for the correction.');
      const checked = draftWork(draft, job, undefined, 3650);
      if (checked.problem) throw Error(checked.problem);
      await team.save([correctEvent(record, checked.work, reason, team.actor) as TeamEvent]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Modal
      title={`Correct work: ${stage(record.stage)}`}
      busy={team.busy}
      onClose={onClose}
      footer={
        <div className="dialog-action-buttons">
          <button type="button" className="secondary" disabled={team.busy} onClick={onClose}>
            <Icon name="close" /> Cancel
          </button>
          <button type="button" disabled={team.busy} onClick={() => void save()}>
            <Icon name="save" /> {route === 'request' ? 'Ask for the correction' : 'Save correction'}
          </button>
        </div>
      }
    >
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        {job.service} · now: {creditText(team.ledger, record)}. {outcome}
      </p>
      <DoneByFields job={job} stage={stage(record.stage)} value={draft} onChange={setDraft} correcting />
      <label>
        Reason
        <input
          aria-label="Reason for the correction"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </Modal>
  );
}

/** A person's commission terms (Team work → Commission on). */
function TermsDialog({
  person,
  current,
  busy,
  onClose,
  onSave,
}: {
  person: TeamPerson;
  current: CommissionTerms | null;
  busy: boolean;
  onClose: () => void;
  onSave: (commission: CommissionTerms | null) => Promise<void>;
}) {
  const [kind, setKind] = useState<CommissionTerms['kind']>(current?.kind ?? 'none');
  const [rate, setRate] = useState(
    current && current.kind !== 'none'
      ? String(current.kind === 'percent' ? current.rate : current.rate / 100)
      : '',
  );
  const [sales, setSales] = useState(current?.salesRate ? String(current.salesRate) : '');
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try {
      const value = Number(rate || 0);
      const salesRate = Number(sales || 0);
      if (!(value >= 0) || (kind === 'percent' && value > 100)) throw Error('Enter a percent from 0 to 100.');
      if (!(salesRate >= 0 && salesRate <= 100)) throw Error('Enter a sales percent from 0 to 100.');
      const commission: CommissionTerms | null =
        kind === 'none' && !salesRate
          ? null
          : {
              kind,
              rate: kind === 'percent' ? value : Math.round(value * 100),
              ...(salesRate ? { salesRate } : {}),
            };
      await onSave(commission);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Modal
      title={`Commission for ${person.name}`}
      busy={busy}
      onClose={onClose}
      footer={
        <div className="dialog-action-buttons">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            <Icon name="close" /> Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void save()}>
            <Icon name="save" /> Save terms
          </button>
        </div>
      }
    >
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <label>
        For their work
        <select
          aria-label="Commission for their work"
          value={kind}
          onChange={(e) => setKind(e.target.value as CommissionTerms['kind'])}
        >
          <option value="none">None</option>
          <option value="percent">A percent of the value credited to them</option>
          <option value="perJob">An amount per job</option>
          <option value="perStage">An amount per stage</option>
          <option value="perUnit">An amount per unit (pay per piece)</option>
        </select>
      </label>
      {kind !== 'none' && (
        <label>
          {kind === 'percent' ? 'Percent' : 'Amount (₦)'}
          <input
            aria-label={kind === 'percent' ? 'Commission percent' : 'Commission amount'}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
      )}
      <label>
        Sales commission (% of the jobs they sold, optional)
        <input
          aria-label="Sales commission percent"
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          step="any"
          value={sales}
          onChange={(e) => setSales(e.target.value)}
        />
      </label>
      <p className="muted">
        Work counts once the job is completed. A job&apos;s value is split equally between the people who did
        it.
      </p>
    </Modal>
  );
}

/** Pay a person's commission (from a money account, an expense) or deduct from it (no money moves). */
function PayCommissionDialog({
  person,
  kind,
  onClose,
  onSave,
}: {
  person: TeamPerson;
  kind: 'payout' | 'deduction';
  onClose: () => void;
  onSave: (input: {
    kind: 'payout' | 'deduction';
    amount: number;
    paidFrom: { kind: string; label: string; source?: string; accountId?: string } | null;
    note: string;
  }) => Promise<void>;
}) {
  const team = useTeam();
  const formId = useId();
  const ledger = team?.ledger;
  const balance = ledger
    ? commissionBalance(ledger, person.id)
    : { earned: 0, paid: 0, deducted: 0, balance: 0 };
  const options = usePaidFromOptions(ledger?.moneyAccounts ?? []);
  const [amount, setAmount] = useState(balance.balance > 0 ? String(balance.balance / 100) : '');
  const [from, setFrom] = useState(options[0]?.key ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const busy = !!team?.busy;
  let kobo = 0;
  try {
    kobo = money(amount || '0');
  } catch {
    kobo = 0;
  }
  const advance = kind === 'payout' ? Math.max(0, kobo - Math.max(0, balance.balance)) : 0;
  return (
    <Modal
      title={kind === 'payout' ? `Pay ${person.name}` : `Deduct from ${person.name}`}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {kind === 'payout' ? `Pay ${currency(kobo)}` : `Deduct ${currency(kobo)}`}
        </DialogActions>
      }
    >
      <p className="muted">
        Earned {currency(balance.earned)} on confirmed work · paid {currency(balance.paid)}
        {balance.deducted ? ` · deducted ${currency(balance.deducted)}` : ''} ·{' '}
        {balance.balance >= 0 ? `owed ${currency(balance.balance)}` : `advance ${currency(-balance.balance)}`}
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          const paidFrom = options.find((o) => o.key === from) ?? null;
          onSave({ kind, amount: kobo, paidFrom: kind === 'payout' ? paidFrom : null, note }).catch((cause) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      >
        <label>
          Amount (₦)
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
          />
        </label>
        {kind === 'payout' && (
          <label>
            Paid from
            <select aria-label="Paid from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {kind === 'payout' ? 'Note' : 'Reason'}
          <input
            maxLength={200}
            required={kind === 'deduction'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={kind === 'payout' ? 'Note' : 'Reason'}
          />
        </label>
      </form>
      {advance > 0 && (
        <p className="notice" role="status">
          {currency(advance)} of this is an advance: it is paid back from {person.name}'s later commission.
        </p>
      )}
      <p className="muted">
        {kind === 'payout'
          ? 'Recorded as an expense (Commission) paid from the account chosen. Work corrected after it is paid shows as a plus or minus on the next payment.'
          : 'A deduction lowers what is owed (for example spoilt work). No money moves.'}
      </p>
    </Modal>
  );
}
