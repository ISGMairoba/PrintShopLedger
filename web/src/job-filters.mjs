/**
 * Jobs list filters: where a job is against a chosen stage, and how far it is paid.
 */

/**
 * Whether a job falls in a stage range.
 * @param {{ productionStatus?: string, workflow?: string[] }} job
 * @param {string} stage the chosen stage
 * @param {'only' | 'upTo' | 'from'} range only that stage, the order up to it, or it to Completed
 * @param {string[]} order every stage in order (the usual steps, then any item's own steps)
 * @param {string[]} jobStages the business's stages (ending Completed, Collected)
 */
export function inStageRange(job, stage, range, order, jobStages) {
  const at = job.productionStatus ?? 'Added';
  if (range === 'only' || stage === 'Cancelled') return at === stage;
  // Ranges leave out cancelled jobs, and collected ones (they are past Completed).
  if (at === 'Cancelled' || at === jobStages[jobStages.length - 1]) return false;
  // A job's own steps decide when they hold both stages; otherwise the shared order.
  const own = job.workflow?.length ? job.workflow : null;
  const steps = own?.includes(stage) && own.includes(at) ? own : order;
  const where = Math.sign(steps.indexOf(at) - steps.indexOf(stage));
  return range === 'upTo' ? where <= 0 : where >= 0;
}

/**
 * @param {{ paid: number, outstanding: number }} balance
 * @returns {'paid' | 'part' | 'unpaid'}
 */
export const payState = (balance) =>
  balance.outstanding <= 0 ? 'paid' : balance.paid > 0 ? 'part' : 'unpaid';

/** @param {'paid' | 'part' | 'unpaid'} state @param {'' | 'paid' | 'part' | 'unpaid' | 'owing'} filter */
export const payMatches = (state, filter) =>
  !filter || (filter === 'owing' ? state !== 'paid' : state === filter);
