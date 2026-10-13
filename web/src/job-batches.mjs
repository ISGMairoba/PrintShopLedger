import { jobWorkflow } from './business-options.mjs';
import { progressEvents } from './job-progress.mjs';

// Group only by the recorded checkout, never by date, customer or similar descriptions.
/** @param {import('./types').Job[]} jobs */
export function groupJobsByCheckout(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = job.checkoutId ? `checkout:${job.checkoutId}` : `job:${job.id}`;
    if (!groups.has(key)) groups.set(key, { key, checkoutId: job.checkoutId ?? null, jobs: [] });
    groups.get(key).jobs.push(job);
  }
  return [...groups.values()];
}

/** Preview every item, including those that cannot take the requested forward action. */
/** @param {import('./types').Job[]} jobs
 * @param {'next' | 'set' | 'complete'} mode
 * @param {string} [target]
 */
export function batchProgressPlan(jobs, mode, target) {
  if (!['next', 'set', 'complete'].includes(mode)) throw Error('Choose a valid action.');
  const seen = new Set();
  return jobs
    .filter((job) => {
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    })
    .map((job) => {
      const workflow = jobWorkflow(job);
      const current = job.productionStatus ?? 'Added';
      const from = workflow.indexOf(current);
      const desired = mode === 'next' ? workflow[from + 1] : mode === 'complete' ? 'Completed' : target;
      const to = workflow.indexOf(desired);
      const reason =
        current === 'Cancelled'
          ? 'Cancelled'
          : from < 0
            ? 'Unknown current stage'
            : !desired
              ? 'No next stage'
              : to < 0
                ? 'Stage is not in this workflow'
                : to <= from
                  ? 'Already at or beyond this stage'
                  : '';
      return { job, target: desired, path: reason ? [] : workflow.slice(from + 1, to + 1), reason };
    });
}

export function batchProgressEvents(jobs, mode, target, actor, now = new Date().toISOString()) {
  return batchProgressPlan(jobs, mode, target).flatMap((row) =>
    row.reason ? [] : progressEvents(row.job, row.target, actor, now),
  );
}

// Blank optional/hidden descriptions use the service name, keeping receipts, offline events and
// existing server validation compatible. Existing entered descriptions are never erased.
export function lineWithDescription(line, services, mode = 'required') {
  if (!['required', 'optional', 'hidden'].includes(mode)) throw Error('Choose a valid description setting.');
  if (mode === 'required' || line.description?.trim()) return line;
  const service = services.find((item) => item.id === line.serviceId);
  return { ...line, description: service?.description?.slice(0, 500) ?? '' };
}
