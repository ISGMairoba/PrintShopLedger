// How long a job may stay at a stage before it is flagged "Too long at this stage":
// * a fixed time set for that stage (Business Settings → Dropdowns & workflow → Time per stage), or
// * for a job with a due date, an even share of the time from the sale to the due date across the
//   stages before Completed.
// A job with neither is never flagged. When a job entered its stage: stageAt (recorded when it
// moves), else its last change, else when it was added.
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
    if (!(n >= 0.25) || n > 2160 || Math.round(n * 100) / 100 !== n)
      throw Error(`${stage}: enter hours from 0.25 to 2160 (90 days).`);
    out[stage] = n;
  }
  return out;
}

export const stageStartedAt = (job) => job.stageAt ?? job.modifiedAt ?? job.createdAt;

/** The time (ms) a job may spend at its current stage, or null when nothing says. */
export function stageAllowance(job, stageHours = {}) {
  const stage = job.productionStatus ?? 'Added';
  if (finished.includes(stage)) return null;
  if (stageHours[stage]) return stageHours[stage] * HOUR;
  if (!job.dueAt || Number.isNaN(Date.parse(job.dueAt))) return null;
  const flow = jobWorkflow(job);
  const working = flow.slice(0, Math.max(1, flow.indexOf('Completed')));
  const total = Date.parse(job.dueAt) - Date.parse(job.createdAt);
  return total > 0 ? total / working.length : null;
}

/** Whether a job has been at its stage longer than allowed, and by how much (ms). */
export function stageOverdue(job, stageHours = {}, now = Date.now()) {
  const allowed = stageAllowance(job, stageHours);
  if (allowed === null) return null;
  const spent = now - Date.parse(stageStartedAt(job));
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
