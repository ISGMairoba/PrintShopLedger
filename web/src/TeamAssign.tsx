import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { jobWorkflow } from './business-options.mjs';
import { useTeam } from './TeamContext';
import { assignEvent, assignmentOf, jobAssignees, personName, teamPeople } from './team.mjs';
import type { Job, TeamEvent, TeamPerson } from './types';
import { useWords } from './Words';

const finished = (job: Job) =>
  ['Completed', 'Collected', 'Cancelled'].includes(job.productionStatus ?? 'Added');
/** The stages work can be assigned to (not Added, Completed, Collected or Cancelled). */
const workStages = (job: Job) =>
  jobWorkflow(job).filter((s: string) => !['Added', 'Completed', 'Collected', 'Cancelled'].includes(s));

/** Who is assigned to a job, as chips, with Assign for those who may (Team work on). */
export function TeamChips({ job }: { job: Job }) {
  const team = useTeam();
  const { stage } = useWords();
  const [open, setOpen] = useState(false);
  if (!team) return null;
  const ids = jobAssignees(team.ledger, job.id);
  const canAssign = team.actor.level >= team.settings.assignRank && !finished(job);
  if (!ids.length && !canAssign) return null;
  const rows = (team.ledger.jobAssignments ?? []).filter((a) => a.jobId === job.id && a.personIds.length);
  return (
    <span className="team-chips">
      {rows.map((a) => (
        <span
          key={a.id}
          className="badge"
          title={a.stage ? `Assigned for ${stage(a.stage)}` : 'Assigned to the job'}
        >
          {a.stage ? `${stage(a.stage)}: ` : ''}
          {a.personIds.map((id) => personName(team.ledger, id)).join(', ')}
        </span>
      ))}
      {canAssign && (
        <button
          type="button"
          className="text-button"
          disabled={team.busy}
          data-opens-dialog
          onClick={() => setOpen(true)}
        >
          <Icon name="users" /> {ids.length ? 'Change' : 'Assign'}
        </button>
      )}
      {open && <AssignDialog jobs={[job]} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** Assign the selected jobs (a selection's action). */
export function AssignButton({ jobs }: { jobs: Job[] }) {
  const team = useTeam();
  const [open, setOpen] = useState(false);
  if (!team || team.actor.level < team.settings.assignRank) return null;
  const open_ = jobs.filter((j) => !finished(j));
  return (
    <>
      <button
        className="secondary"
        disabled={team.busy || !open_.length}
        data-opens-dialog
        onClick={() => setOpen(true)}
      >
        <Icon name="users" /> Assign
      </button>
      {open && <AssignDialog jobs={open_} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Who is chosen in a draft (checkout): '' = the whole job, or a stage, with the people's ids. */
export type AssignDraft = Record<string, string[]>;
/** A draft as saved on a cart line (older carts kept a list for the whole job). */
export const assignDraft = (value?: AssignDraft | string[]): AssignDraft =>
  Array.isArray(value) ? { '': value } : (value ?? {});
const cleanDraft = (draft: AssignDraft) =>
  Object.fromEntries(Object.entries(draft).filter(([, ids]) => ids.length)) as AssignDraft;

/**
 * Assign to, before the job exists (checkout): one line saying who, and a button opening the
 * Assign dialog. The choice is assigned when the sale is saved.
 */
export function AssignDraftButton({
  stages,
  value,
  onChange,
}: {
  stages: string[];
  value: AssignDraft;
  onChange: (next: AssignDraft) => void;
}) {
  const team = useTeam();
  const { stage: stageName } = useWords();
  const [open, setOpen] = useState(false);
  if (!team) return null;
  const work = stages.filter((s) => !['Added', 'Completed', 'Collected', 'Cancelled'].includes(s));
  const chosen = Object.entries(cleanDraft(value)).filter(([s]) => s === '' || work.includes(s));
  const names = (ids: string[]) => ids.map((id) => personName(team.ledger, id)).join(', ');
  return (
    <div className="assign-draft">
      <span>
        <strong>Assign to:</strong>{' '}
        {chosen.length
          ? chosen.map(([s, ids]) => (s ? `${stageName(s)}: ${names(ids)}` : names(ids))).join(' · ')
          : <span className="muted">no one yet (optional)</span>}
      </span>{' '}
      <button type="button" className="text-button" data-opens-dialog onClick={() => setOpen(true)}>
        <Icon name="users" /> {chosen.length ? 'Change' : 'Assign to'}
      </button>
      {open && (
        <AssignDialog
          jobs={[]}
          draft={{ stages: work, value, onApply: (next) => onChange(cleanDraft(next)) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Assign one or many jobs, or stages of them, to Team people. With draft (checkout), the choice is
 * handed back instead of saved.
 */
export function AssignDialog({
  jobs,
  draft,
  onClose,
}: {
  jobs: Job[];
  draft?: { stages: string[]; value: AssignDraft; onApply: (next: AssignDraft) => void };
  onClose: () => void;
}) {
  const team = useTeam();
  const { stage: stageName, w } = useWords();
  // Stages every chosen job has.
  const stages = draft
    ? draft.stages
    : jobs.length
      ? workStages(jobs[0]).filter((s: string) => jobs.every((j) => workStages(j).includes(s)))
      : [];
  const [stage, setStage] = useState('');
  const current = (s: string) =>
    draft
      ? (draft.value[s] ?? [])
      : jobs.length === 1 && team
        ? (assignmentOf(team.ledger, jobs[0].id, s)?.personIds ?? [])
        : [];
  // Each stage changed in this dialog, with who is chosen for it.
  const [picks, setPicks] = useState<AssignDraft>(() => ({ '': current('') }));
  const ids = picks[stage] ?? current(stage);
  const setIds = (next: string[]) => setPicks((p) => ({ ...p, [stage]: next }));
  const [error, setError] = useState('');
  if (!team) return null;
  const people = (teamPeople(team.ledger) as TeamPerson[]).filter((p) => !p.archived);
  const changed = Object.entries(picks).filter(
    ([s, list]) => list.join() !== current(s).join() || (s === stage && !draft),
  );
  const save = async () => {
    setError('');
    try {
      if (draft) {
        draft.onApply({ ...draft.value, ...picks });
        onClose();
        return;
      }
      await team.save(
        jobs.flatMap((job) =>
          changed.map(([s, list]) => assignEvent(team.ledger, job, s, list, team.actor) as TeamEvent),
        ),
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const anyone = Object.values({ ...(draft?.value ?? {}), ...picks }).some((list) => list.length);
  return (
    <Modal
      title={draft || jobs.length === 1 ? w('Assign job') : w(`Assign ${jobs.length} jobs`)}
      busy={team.busy}
      onClose={onClose}
      footer={
        <div className="dialog-action-buttons">
          <button type="button" className="secondary" disabled={team.busy} onClick={onClose}>
            <Icon name="close" /> Cancel
          </button>
          <button type="button" disabled={team.busy} onClick={() => void save()}>
            <Icon name="save" /> {draft ? 'Done' : anyone || ids.length ? 'Save assignment' : 'Clear assignment'}
          </button>
        </div>
      }
    >
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {jobs.length > 1 && (
        <p className="muted">
          The same people are assigned to each of the {jobs.length} jobs, replacing who was assigned.
        </p>
      )}
      {draft && <p className="muted">Assigned when the sale is saved.</p>}
      <label>
        Assign
        <select aria-label="Assign" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">{w('The whole job')}</option>
          {stages.map((s: string) => {
            const n = (picks[s] ?? current(s)).length;
            return (
              <option key={s} value={s}>
                Only {stageName(s)}
                {n ? ` (${n})` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <fieldset className="page-limit-list">
        <legend>People</legend>
        {people.map((p) => (
          <label key={p.id} className="check-label">
            <input
              type="checkbox"
              aria-label={`Assign ${p.name}`}
              checked={ids.includes(p.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id))}
            />
            {p.name}
            {p.role ? <small className="muted"> {p.role}</small> : null}
          </label>
        ))}
      </fieldset>
      {!people.length && <p className="muted">Add people on Users → Team first.</p>}
    </Modal>
  );
}
