import { jobBalanceFast } from './balances.mjs';
import { jobWorkflow } from './business-options.mjs';
import { stageMoveEvents } from './material-choice.mjs';

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

/**
 * The events for a batch move. Jobs with a choice of materials that pass their confirmation stage
 * need their usage in `usages` (job id → [{ materialId, quantity }]), confirmed before the move.
 * @param {import('./types').Job[]} jobs
 * @param {'next' | 'set' | 'complete'} mode
 * @param {string} target
 * @param {{ id: string, label: string }} actor
 * @param {string} [now]
 * @param {{ ledger?: any, usages?: Record<string, { materialId: string, quantity: number }[]> }} [options]
 */
export function batchProgressEvents(
  jobs,
  mode,
  target,
  actor,
  now = new Date().toISOString(),
  { ledger = null, usages = {} } = {},
) {
  return batchProgressPlan(jobs, mode, target).flatMap((row) =>
    row.reason ? [] : stageMoveEvents(ledger, row.job, row.target, actor, usages[row.job.id] ?? null, now),
  );
}

// Blank optional/hidden descriptions use the service name, keeping receipts, offline events and
// existing server validation compatible. Existing entered descriptions are never erased.
/**
 * The description after choosing another item: a description the person typed stays; one the app
 * filled in for the previous item (a template's name, a product's name) follows the new item.
 */
export function nextDescription(current, previousAuto, nextAuto) {
  const text = current ?? '';
  return !text.trim() || (previousAuto && text === previousAuto) ? nextAuto : text;
}

export function lineWithDescription(line, services, mode = 'required') {
  if (!['required', 'optional', 'hidden'].includes(mode)) throw Error('Choose a valid description setting.');
  if (mode === 'required' || line.description?.trim()) return line;
  const service = services.find((item) => item.id === line.serviceId);
  return { ...line, description: service?.description?.slice(0, 500) ?? '' };
}

/**
 * Which planned items would be marked Collected, and which of those still owe money, so the
 * person sees that the action records collection (and of unpaid work) before applying it.
 * @param {ReturnType<typeof batchProgressPlan>} plan
 * @param {import('./types').Ledger} ledger
 */
export function collectionCheck(plan, ledger) {
  const collecting = plan.filter((row) => !row.reason && row.path.includes('Collected'));
  const unpaid = collecting
    .map((row) => ({ job: row.job, owed: jobBalanceFast(ledger, row.job).outstanding }))
    .filter((row) => row.owed > 0);
  return {
    collecting: collecting.length,
    unpaid: unpaid.length,
    owed: unpaid.reduce((n, r) => n + r.owed, 0),
  };
}
