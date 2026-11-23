import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { jobWorkflow } from './business-options.mjs';
import { useTeam } from './TeamContext';
import { assignEvent, assignmentOf, jobAssignees, personName, teamPeople } from './team.mjs';
import type { Job, TeamEvent, TeamPerson } from './types';
import { useWords } from './Words';

const finished = (job: Job) => ['Completed', 'Collected', 'Cancelled'].includes(job.productionStatus ?? 'Added');
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
        <span key={a.id} className="badge" title={a.stage ? `Assigned for ${stage(a.stage)}` : 'Assigned to the job'}>
          {a.stage ? `${stage(a.stage)}: ` : ''}
          {a.personIds.map((id) => personName(team.ledger, id)).join(', ')}
        </span>
      ))}
      {canAssign && (
        <button type="button" className="text-button" disabled={team.busy} data-opens-dialog onClick={() => setOpen(true)}>
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
      <button className="secondary" disabled={team.busy || !open_.length} data-opens-dialog onClick={() => setOpen(true)}>
        <Icon name="users" /> Assign
      </button>
      {open && <AssignDialog jobs={open_} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Assign one or many jobs, or one stage of them, to Team people. */
export function AssignDialog({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  const team = useTeam();
  const { stage: stageName, w } = useWords();
  // Stages every chosen job has.
  const stages = jobs.length
    ? workStages(jobs[0]).filter((s: string) => jobs.every((j) => workStages(j).includes(s)))
    : [];
  const [stage, setStage] = useState('');
  const current = (s: string) =>
    jobs.length === 1 && team ? (assignmentOf(team.ledger, jobs[0].id, s)?.personIds ?? []) : [];
  const [ids, setIds] = useState<string[]>(() => current(''));
  const [error, setError] = useState('');
  if (!team) return null;
  const people = (teamPeople(team.ledger) as TeamPerson[]).filter((p) => !p.archived);
  const save = async () => {
    setError('');
    try {
      await team.save(jobs.map((job) => assignEvent(team.ledger, job, stage, ids, team.actor) as TeamEvent));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Modal
      title={jobs.length === 1 ? w('Assign job') : w(`Assign ${jobs.length} jobs`)}
      busy={team.busy}
      onClose={onClose}
      footer={
        <div className="dialog-action-buttons">
          <button type="button" className="secondary" disabled={team.busy} onClick={onClose}>
            <Icon name="close" /> Cancel
          </button>
          <button type="button" disabled={team.busy} onClick={() => void save()}>
            <Icon name="save" /> {ids.length ? 'Save assignment' : 'Clear assignment'}
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
        <p className="muted">The same people are assigned to each of the {jobs.length} jobs, replacing who was assigned.</p>
      )}
      <label>
        Assign
        <select
          aria-label="Assign"
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setIds(current(e.target.value));
          }}
        >
          <option value="">{w('The whole job')}</option>
          {stages.map((s: string) => (
            <option key={s} value={s}>
              Only {stageName(s)}
            </option>
          ))}
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
