// Job deadlines. A job may carry dueAt (ISO time). New jobs get the business default duration,
// which staff can change or clear when adding the job.

const HOUR = 3600000;
const finished = ['Completed', 'Collected', 'Cancelled'];

/** When a job added at `from` is due under the business default, or '' when there is no default. */
export function defaultDueAt(duration, from = new Date().toISOString()) {
  const value = Number(duration?.value ?? 0);
  if (!value || Number.isNaN(Date.parse(from))) return '';
  return new Date(Date.parse(from) + value * (duration.unit === 'hours' ? 1 : 24) * HOUR).toISOString();
}

/** A deadline entered for a new job: '' (none) or an ISO time within five years. */
export function validDueAt(value, from = new Date().toISOString()) {
  if (value === undefined || value === null || value === '') return '';
  const at = Date.parse(value);
  if (typeof value !== 'string' || Number.isNaN(at)) throw Error('Enter a valid deadline.');
  if (at > Date.parse(from) + 5 * 366 * 24 * HOUR) throw Error('Choose a deadline within five years.');
  return new Date(at).toISOString();
}

/**
 * Where a job stands against its deadline: 'none', 'done' (finished or cancelled), 'overdue',
 * 'soon' (due within 24 hours) or 'later'.
 */
export function deadlineState(job, now = Date.now()) {
  if (!job?.dueAt || Number.isNaN(Date.parse(job.dueAt))) return 'none';
  if (finished.includes(job.productionStatus ?? 'Added')) return 'done';
  const left = Date.parse(job.dueAt) - now;
  return left < 0 ? 'overdue' : left <= 24 * HOUR ? 'soon' : 'later';
}

/** "2 days", "5 hours", "No default deadline". */
export function durationLabel(duration) {
  const value = Number(duration?.value ?? 0);
  if (!value) return 'No default deadline';
  const unit = duration.unit === 'hours' ? 'hour' : 'day';
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/** ISO time ↔ the value of an <input type="datetime-local"> in this device's time zone. */
export function toLocalInput(iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value) {
  if (!value) return '';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

export function deadlineProgress(job, now = Date.now()) {
  const state = deadlineState(job, now);
  if (state === 'none') return { state, progress: 0, label: 'No due date' };
  if (state === 'done') return { state, progress: 1, label: job.productionStatus || 'Completed' };
  const due = Date.parse(job.dueAt),
    start = Date.parse(job.createdAt),
    left = due - now;
  const duration = Math.abs(left),
    days = Math.ceil(duration / (24 * HOUR)),
    hours = Math.ceil(duration / HOUR);
  const period =
    duration >= 24 * HOUR
      ? `${days} day${days === 1 ? '' : 's'}`
      : duration >= HOUR
        ? `${hours} hour${hours === 1 ? '' : 's'}`
        : `${Math.max(1, Math.ceil(duration / 60000))} min`;
  const today =
    new Date(now).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) ===
    new Date(due).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  return {
    state,
    progress: Math.max(0, Math.min(1, (now - start) / Math.max(1, due - start))),
    label:
      left < 0
        ? `Overdue by ${period}`
        : left === 0
          ? 'Due now'
          : today
            ? `Due today · ${period} left`
            : `${period} left`,
  };
}
