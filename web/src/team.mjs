// Team work (plans/job-assignment.md): the Team, assigning jobs and stages, work records (Done by
// with shares, Done at against Recorded at, redo, outside work) and confirming them. The server
// (public.apply_team_event) checks the same rules; these apply a change on this device at once.
import { jobWorkflow } from './business-options.mjs';

/** The Team work choices and their defaults (each a business setting). */
export const TEAM_DEFAULTS = Object.freeze({
  enabled: false,
  /** Ask "Done by" on every stage move; off: the people assigned are credited. */
  askDoneBy: true,
  /** Lowest rank that records work for someone else (2 = Admin). */
  othersRank: 2,
  /** Lowest rank that sets an earlier Done at. */
  earlierRank: 2,
  /** How far back Done at can be (days). */
  doneAtDays: 7,
  /** Work records start as Recorded and count once confirmed. */
  needsConfirming: true,
  confirmRank: 2,
  assignRank: 2,
  /** How long after collection a work record can be corrected (days). */
  correctionDays: 7,
  commission: false,
});
const RANKED = ['othersRank', 'earlierRank', 'confirmRank', 'assignRank'];
const DAYS = ['doneAtDays', 'correctionDays'];
const SWITCHES = ['enabled', 'askDoneBy', 'needsConfirming', 'commission'];

/** The business's Team work choices, defaults filled in. */
export function teamSettings(settings) {
  return { ...TEAM_DEFAULTS, ...(settings?.teamWork ?? {}) };
}
/** Checks the choices; keeps only those changed from the default. */
export function validateTeamSettings(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object') throw Error('Invalid Team work settings.');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SWITCHES.includes(key)) {
      if (typeof value !== 'boolean') throw Error('Invalid Team work setting.');
    } else if (RANKED.includes(key)) {
      if (![1, 2, 3, 4].includes(value)) throw Error('Choose a rank for each Team work choice.');
    } else if (DAYS.includes(key)) {
      if (!Number.isInteger(value) || value < 0 || value > 90) throw Error('Choose 0 to 90 days.');
    } else throw Error('Unknown Team work setting.');
    if (value !== TEAM_DEFAULTS[key]) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}
/** Whether the server keeps Team work yet (its download lists the app users on the Team). */
export const teamReady = (ledger) => (ledger?.teamPeople?.length ?? 0) > 0;
/** Team work is on and the server keeps it. */
export const teamOn = (ledger, settings) => teamReady(ledger) && teamSettings(settings).enabled;

/**
 * Everyone on the Team (app users and people added by name); active only unless asked.
 * @returns {import('./types').TeamPerson[]}
 */
export function teamPeople(ledger, { all = false } = {}) {
  return (ledger?.teamPeople ?? []).filter((p) => all || !p.archived);
}
export const personName = (ledger, id) =>
  (ledger?.teamPeople ?? []).find((p) => p.id === id)?.name ?? 'Someone no longer on the Team';

/** A stable id for a job's (or one stage's) assignment, so two devices assign the same record. */
export function assignmentId(jobId, stage = '') {
  const text = `${jobId}|${stage}`;
  const parts = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x7f4a7c15].map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  });
  const hex = parts.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const assignmentOf = (ledger, jobId, stage = '') =>
  (ledger?.jobAssignments ?? []).find((a) => a.jobId === jobId && (a.stage ?? '') === stage);
/** Who is assigned to a stage: its own assignees, else the whole job's. */
export function assignedTo(ledger, job, stage = job.productionStatus ?? 'Added') {
  const own = assignmentOf(ledger, job.id, stage)?.personIds ?? [];
  return own.length ? own : (assignmentOf(ledger, job.id, '')?.personIds ?? []);
}
/** Everyone assigned anything on the job (whole job and stages). */
export function jobAssignees(ledger, jobId) {
  return [
    ...new Set(
      (ledger?.jobAssignments ?? []).filter((a) => a.jobId === jobId).flatMap((a) => a.personIds ?? []),
    ),
  ];
}
const finished = (job) => ['Completed', 'Collected', 'Cancelled'].includes(job.productionStatus ?? 'Added');
/**
 * Jobs with work for this person now: assigned to the current stage (or the whole job), not finished.
 * @returns {import('./types').Job[]}
 */
export function myWork(ledger, personId) {
  return (ledger?.jobs ?? []).filter((job) => !finished(job) && assignedTo(ledger, job).includes(personId));
}

/** An assignment change: the whole job (stage '') or one stage, to these people. */
export function assignEvent(ledger, job, stage, personIds, actor, now = new Date().toISOString()) {
  const current = assignmentOf(ledger, job.id, stage);
  return {
    id: crypto.randomUUID(),
    kind: 'team.assigned',
    data: {
      id: current?.id ?? assignmentId(job.id, stage),
      baseVersion: current?.version ?? 0,
      jobId: job.id,
      stage,
      personIds: [...new Set(personIds)],
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

/**
 * Shares as entered: { personId, share }, in percent (adding up to 100) or quantities (at most the
 * job's quantity). Returns a problem, or ''.
 */
export function sharesProblem(shares, unit, quantity) {
  if (!shares.length) return 'Choose who did the work.';
  if (shares.length > 20) return 'Choose up to 20 people.';
  if (shares.some((s) => !(Number(s.share) > 0))) return 'Each share must be more than 0.';
  const total = shares.reduce((n, s) => n + Number(s.share), 0);
  if (unit === 'percent' && Math.abs(total - 100) > 0.01) return 'The shares must add up to 100%.';
  if (unit === 'quantity' && quantity > 0 && total > quantity)
    return `The quantities add up to more than the job's ${quantity}.`;
  return '';
}
/** Equal percentages for these people, adding up to exactly 100. */
export function equalShares(personIds) {
  if (!personIds.length) return [];
  const each = Math.floor((100 / personIds.length) * 100) / 100;
  return personIds.map((personId, i) => ({
    personId,
    share: i === 0 ? Math.round((100 - each * (personIds.length - 1)) * 100) / 100 : each,
  }));
}
/** The stages a move from the job's stage to `target` finishes (each gets a work record). */
export function stagesFinished(job, target) {
  const flow = jobWorkflow(job);
  const from = flow.indexOf(job.productionStatus ?? 'Added');
  const to = flow.indexOf(target);
  return from < 0 || to <= from ? [] : flow.slice(from, to);
}
/**
 * Work records for a stage move. work: { shares, unit, doneAt, redo?, vendor?, note?, auto? }. One
 * record per stage the move finishes.
 * @returns {import('./types').TeamEvent[]}
 */
export function workEvents(job, target, work, actor, now = new Date().toISOString()) {
  const stages = stagesFinished(job, target);
  // "Added" is not work.
  return stages
    .filter((stage) => stage !== 'Added')
    .map((stage) => ({
      id: crypto.randomUUID(),
      kind: 'team.work_recorded',
      data: {
        id: crypto.randomUUID(),
        jobId: job.id,
        stage,
        unit: work.unit,
        shares: work.shares.map((s) => ({ personId: s.personId, share: Number(s.share) })),
        doneAt: work.doneAt ?? now,
        ...(work.redo ? { redo: work.redo } : {}),
        ...(work.vendor ? { vendor: work.vendor } : {}),
        ...(work.note?.trim() ? { note: work.note.trim() } : {}),
        ...(work.auto ? { auto: true } : {}),
        recordedBy: actor.id,
        recordedByLabel: actor.label,
        recordedByRank: actor.level,
      },
    }));
}
/**
 * Work records crediting the people assigned to each stage a move finishes (equal shares), for
 * moves that ask no "Done by" (that choice off, or several jobs moved at once).
 * @returns {import('./types').TeamEvent[]}
 */
export function autoWorkEvents(ledger, job, target, actor, now = new Date().toISOString()) {
  return stagesFinished(job, target)
    .filter((stage) => stage !== 'Added')
    .flatMap((stage) => {
      const ids = assignedTo(ledger, job, stage);
      if (!ids.length) return [];
      const [event] = workEvents(
        { ...job, productionStatus: stage },
        jobWorkflow(job)[jobWorkflow(job).indexOf(stage) + 1],
        { unit: 'percent', shares: equalShares(ids), doneAt: now, auto: true },
        actor,
        now,
      );
      return event ? [event] : [];
    });
}
/**
 * Work records waiting to be confirmed (newest first).
 * @returns {import('./types').WorkRecord[]}
 */
export const toConfirm = (ledger) =>
  (ledger?.workRecords ?? [])
    .filter((r) => r.status !== 'confirmed')
    .sort((a, b) => (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''));
/** Whether this person may confirm a record (not their own, unless no one else can). */
export function canConfirm(ledger, record, actor, settings) {
  const tw = teamSettings(settings);
  if ((actor.level ?? 0) < tw.confirmRank || record.status === 'confirmed') return false;
  const own = (record.shares ?? []).some((s) => s.personId === actor.id);
  if (!own) return true;
  return !teamPeople(ledger).some((p) => p.member && p.id !== actor.id && (p.rank ?? 0) >= tw.confirmRank);
}
/** Confirms these work records. */
export const confirmEvent = (recordIds, actor, now = new Date().toISOString()) => ({
  id: crypto.randomUUID(),
  kind: 'team.work_confirmed',
  data: {
    id: crypto.randomUUID(),
    recordIds,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
  },
});
/** A Team person added by name (or changed). */
export const personEvent = (person, fields, actor, now = new Date().toISOString()) => ({
  id: crypto.randomUUID(),
  kind: 'team.person_saved',
  data: {
    id: person?.id ?? crypto.randomUUID(),
    baseVersion: person?.version ?? 0,
    name: fields.name,
    role: fields.role ?? '',
    phone: fields.phone ?? '',
    branchId: fields.branchId ?? null,
    archived: !!fields.archived,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
  },
});
/** Recorded noticeably after it was done (the report flags late recording). */
export const recordedLate = (record, hours = 24) =>
  Date.parse(record.recordedAt) - Date.parse(record.doneAt) > hours * 3600000;

/** Applies a team change on this device (the server's figures replace it on the next sync). */
export function applyTeamEvent(ledger, event) {
  const d = event.data;
  const now = d.modifiedAt ?? d.doneAt ?? new Date().toISOString();
  if (event.kind === 'team.person_saved') {
    if (!d.name?.trim() || d.name.trim().length > 80) throw Error('Enter a name of up to 80 letters.');
    const list = ledger.teamPeople ?? [];
    const old = list.find((p) => p.id === d.id);
    if ((old?.version ?? 0) !== (d.baseVersion ?? 0)) throw Error('This person was changed elsewhere.');
    const person = {
      id: d.id,
      name: d.name.trim(),
      role: (d.role ?? '').trim(),
      phone: (d.phone ?? '').trim(),
      branchId: d.branchId ?? null,
      archived: !!d.archived,
      version: (old?.version ?? 0) + 1,
      modifiedByLabel: d.modifiedByLabel,
      modifiedAt: now,
    };
    return { ...ledger, teamPeople: old ? list.map((p) => (p.id === d.id ? person : p)) : [...list, person] };
  }
  if (event.kind === 'team.assigned') {
    const list = ledger.jobAssignments ?? [];
    const old = list.find((a) => a.id === d.id);
    if ((old?.version ?? 0) !== (d.baseVersion ?? 0)) throw Error('Someone else changed who is assigned.');
    const next = {
      id: d.id,
      jobId: d.jobId,
      stage: d.stage ?? '',
      personIds: d.personIds,
      version: (old?.version ?? 0) + 1,
      modifiedBy: d.modifiedBy,
      modifiedByLabel: d.modifiedByLabel,
      modifiedAt: now,
    };
    return { ...ledger, jobAssignments: old ? list.map((a) => (a.id === d.id ? next : a)) : [...list, next] };
  }
  if (event.kind === 'team.work_recorded') {
    if (!d.shares.length && !d.vendor) throw Error('Choose who did the work, or an outside vendor.');
    const list = ledger.workRecords ?? [];
    if (list.some((r) => r.id === d.id)) return ledger;
    const record = {
      ...d,
      recordedAt: new Date().toISOString(),
      status: 'recorded',
      version: 1,
    };
    return { ...ledger, workRecords: [...list, record] };
  }
  if (event.kind === 'team.work_confirmed') {
    const ids = new Set(d.recordIds);
    return {
      ...ledger,
      workRecords: (ledger.workRecords ?? []).map((r) =>
        ids.has(r.id) && r.status !== 'confirmed'
          ? {
              ...r,
              status: 'confirmed',
              confirmedBy: d.modifiedBy,
              confirmedByLabel: d.modifiedByLabel,
              confirmedAt: now,
              version: (r.version ?? 1) + 1,
            }
          : r,
      ),
    };
  }
  throw Error('Unknown team change.');
}
