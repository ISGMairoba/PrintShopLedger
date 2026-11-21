// How long a job may stay at a stage before it is flagged "Too long at this stage" (agreed 20 Nov):
// * No due date: the time set for that step (the item's steps, or a saved workflow), else never.
// * With a due date, the time left is shared by the stage the job is at and the stages after it,
//   up to Completed. Stages already done keep the time they really took, so this also re-spreads
//   the rest when the deadline moves (postponed or brought forward).
//   - Every stage has a time: each gets its share of the time left (Design 2h, Printing 4h,
//     Finishing 2h with 48 hours left → 12h, 24h, 12h).
//   - Some have a time ("automatic" ones don't): the timed ones keep their own times and the others
//     share what is left.
//   - Not enough time for the set times: every stage shrinks to fit (untimed ones counting as an
//     average timed stage), and the plan is marked tight so the screen can warn.
//   - No stage has a time: an even share.
//   Added counts only when it has a time (or none has); otherwise its time runs into the next stage.
// Worked out when needed, never stored, so nothing goes stale. When a job entered its stage:
// stageAt (recorded when it moves), else its last change, else when it was added.
import { jobWorkflow } from './business-options.mjs';

const HOUR = 3600000;
const finished = ['Completed', 'Collected', 'Cancelled'];

/** Hours per stage from the business options: { stage: hours }, unknown stages dropped. */
export function validStageHours(value, stages) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid time per stage.');
  const out = {};
  for (const [stage, hours] of Object.entries(value)) {
    if (!stages.includes(stage) || finished.includes(stage)) continue;
    if (hours === null || hours === '' || hours === undefined) continue;
    const n = Number(hours);
    if (!(n >= 0.0166) || n > 2160 || Math.round(n * 10000) / 10000 !== n)
      throw Error(`${stage}: enter a time from 1 minute to 90 days.`);
    out[stage] = n;
  }
  return out;
}

export const stageStartedAt = (job) => job.stageAt ?? job.modifiedAt ?? job.createdAt;

/**
 * How the time to the due date is shared from the job's current stage (or from the sale, with
 * `fromSale`): { allowances: { stage: ms }, needed: ms the set times add up to, available: ms left,
 * tight: the set times don't fit }. null without a usable due date or for a finished job.
 * @param {any} job
 * @param {Record<string, number>} [stageHours]
 * @param {{ dueAt?: string, fromSale?: boolean }} [options] dueAt: plan for this deadline instead.
 */
export function stagePlan(job, stageHours = {}, options = {}) {
  const stage = job.productionStatus ?? 'Added';
  if (finished.includes(stage)) return null;
  const dueAt = options.dueAt ?? job.dueAt;
  if (!dueAt || Number.isNaN(Date.parse(dueAt))) return null;
  const hours = job.stageHours ?? stageHours;
  const flow = jobWorkflow(job);
  const working = flow.slice(0, Math.max(1, flow.indexOf('Completed')));
  const from = options.fromSale ? 0 : Math.max(0, working.indexOf(stage));
  // Added (the order taken) only counts as a stage when it has a time of its own, or when no stage
  // has one (then every stage shares evenly, as before). Otherwise its time runs into the next stage.
  const ahead = working.slice(from);
  const anyTimed = ahead.some((s) => hours[s] > 0);
  const stages = anyTimed ? ahead.filter((s) => s !== 'Added' || hours.Added > 0) : ahead;
  if (!stages.length) return null;
  const start = Date.parse(options.fromSale ? job.createdAt : stageStartedAt(job));
  const available = Math.max(0, Date.parse(dueAt) - start);
  const set = stages.filter((s) => hours[s] > 0);
  const needed = set.reduce((sum, s) => sum + hours[s] * HOUR, 0);
  const allowances = {};
  if (!set.length) for (const s of stages) allowances[s] = available / stages.length;
  else if (set.length === stages.length)
    for (const s of stages) allowances[s] = (available * hours[s] * HOUR) / needed;
  else if (available >= needed) {
    const rest = (available - needed) / (stages.length - set.length);
    for (const s of stages) allowances[s] = hours[s] > 0 ? hours[s] * HOUR : rest;
  } else {
    const average = needed / set.length;
    const scale = available / (needed + average * (stages.length - set.length));
    for (const s of stages) allowances[s] = (hours[s] > 0 ? hours[s] * HOUR : average) * scale;
  }
  if (!(stage in allowances) && ahead.includes(stage)) allowances[stage] = allowances[stages[0]];
  return { allowances, needed, available, tight: set.length > 0 && available < needed };
}

/**
 * The time (ms) a job may spend at its current stage, or null when nothing says. A job sold with a
 * workflow carries its own hours; older jobs use the business's.
 */
export function stageAllowance(job, stageHours = {}) {
  const stage = job.productionStatus ?? 'Added';
  if (finished.includes(stage)) return null;
  const plan = stagePlan(job, stageHours);
  if (plan) return plan.allowances[stage] ?? null;
  const hours = job.stageHours ?? stageHours;
  return hours[stage] ? hours[stage] * HOUR : null;
}

/** Whether a job has been at its stage longer than allowed, and by how much (ms). */
export function stageOverdue(job, stageHours = {}, now = Date.now()) {
  // On hold: the stage clock stops (and time already on hold at this stage is not counted).
  if (job.hold) return null;
  const allowed = stageAllowance(job, stageHours);
  if (allowed === null) return null;
  const spent = now - Date.parse(stageStartedAt(job)) - (job.stageHeldMs ?? 0);
  return spent > allowed ? { spent, allowed, over: spent - allowed } : null;
}

const seenKey = (scope) => `printshopledger:stage-late-seen:${scope}`;
/** The "too long at a stage" notice shows once a day per device. */
export function lateReminderDue(scope, today, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(seenKey(scope)) !== today;
  } catch {
    return true;
  }
}
export function dismissLateReminder(scope, today, storage = globalThis.localStorage) {
  try {
    storage?.setItem(seenKey(scope), today);
  } catch {}
}
/** Opening Jobs from the notice: show the late jobs (read once by the Jobs page). */
export const LATE_FILTER_KEY = 'printshopledger:jobs-stage-filter';

/** "3 hours", "2 days". */
export function spanLabel(ms) {
  const hours = ms / HOUR;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}
