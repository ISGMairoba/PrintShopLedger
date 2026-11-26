// Workflows as steps: every job goes Added → its own steps → Completed → Collected. The first and
// last steps are fixed; the steps between come from the item (services and templates can have their
// own), else the business's fallback (a saved workflow, or the master default: Processing).
// Saved workflows (Business Settings → Dropdowns & workflow) are starting blocks: an item copies
// one and edits its copy, so a later change to the saved workflow changes nothing already copied.
// A step's time is kept in minutes, with the unit it was typed in (m, h, d) for showing it again.
// Timing by ratio (owner, 26 Nov): every step has a share (%) of the job's time instead. The time
// is then the time to the due date, else the workflow's usual turnaround: each step's minutes are
// its share of the turnaround (so the turnaround is their sum), or none when it has no turnaround.

export const FIXED_START = ['Added'];
export const FIXED_END = ['Completed', 'Collected'];
const FIXED = [...FIXED_START, ...FIXED_END];
export const MASTER_STEPS = [{ name: 'Processing' }];
export const UNITS = { m: 1, h: 60, d: 1440 };
const MAX_MINUTES = 90 * 1440;

/**
 * The steps between Added and Completed: unique names (up to 40 characters), at most 20, each with
 * an optional time.
 * @returns {{ name: string, minutes?: number, unit?: 'm' | 'h' | 'd' }[]}
 */
export function validSteps(steps, label = 'Workflow') {
  if (!Array.isArray(steps) || steps.length > 20) throw Error(`${label}: use at most 20 steps.`);
  const seen = new Set();
  const out = steps.map((step) => {
    const name = String(step?.name ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name))
      throw Error(`${label}: give each step a name up to 40 characters.`);
    if (FIXED.some((f) => f.toLowerCase() === name.toLowerCase()))
      throw Error(`${label}: ${name} is already the first or last step.`);
    if (seen.has(name.toLowerCase())) throw Error(`${label}: two steps are called "${name}".`);
    seen.add(name.toLowerCase());
    /** @type {{ name: string, minutes?: number, unit?: 'm' | 'h' | 'd', share?: number }} */
    const out = { name };
    if (step.share !== undefined && step.share !== null && step.share !== '') {
      const share = Number(step.share);
      if (!(share > 0) || share > 100 || Math.round(share * 100) / 100 !== share)
        throw Error(`${label}: ${name} needs a share from 0.01% to 100%.`);
      out.share = share;
    }
    if (step.minutes !== undefined && step.minutes !== null && step.minutes !== '') {
      const minutes = Number(step.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)
        throw Error(`${label}: ${name} takes from 1 minute to 90 days.`);
      out.minutes = minutes;
      out.unit = UNITS[step.unit] ? step.unit : minutes % 1440 === 0 ? 'd' : minutes % 60 === 0 ? 'h' : 'm';
    }
    return out;
  });
  const shared = out.filter((s) => s.share !== undefined);
  if (shared.length) {
    if (shared.length !== out.length) throw Error(`${label}: give every step a share, or none.`);
    const total = shared.reduce((sum, s) => sum + s.share, 0);
    if (Math.abs(total - 100) > 0.05)
      throw Error(`${label}: the shares add up to ${round2(total)}%, not 100%.`);
    const timed = out.filter((s) => s.minutes).length;
    if (timed && timed !== out.length) throw Error(`${label}: enter the usual turnaround again.`);
  }
  return out;
}
const round2 = (n) => Math.round(n * 100) / 100;
/** Whether steps are timed by ratio (every step has a share). */
export const byRatio = (steps) => steps.length > 0 && steps.every((s) => s.share > 0);
/** A ratio workflow's usual turnaround in minutes (the sum of its steps' minutes), or 0. */
export const turnaroundMinutes = (steps) => steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0);

/**
 * How long the steps take in all, in minutes: by ratio the usual turnaround, else the sum when
 * every step has a time; 0 when the time is not known (untimed steps share the time to the due date).
 */
export const stepsMinutes = (steps) =>
  steps.length && steps.every((s) => (s.minutes ?? 0) > 0) ? turnaroundMinutes(steps) : 0;

/** A span in words: "45 min", "6 hours", "3 days". */
export function minutesLabel(minutes) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.round(minutes / 6) / 10;
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round((minutes / 1440) * 10) / 10;
  return `${days} days`;
}
/**
 * Steps with shares spread over a turnaround: each step's minutes are its share of it (at least a
 * minute), or none without a turnaround. unit: how the turnaround was typed, for showing it again.
 */
export function shareSteps(steps, turnaround, unit = 'd') {
  return steps.map((s) => {
    const { minutes: _m, unit: _u, ...rest } = s;
    if (!(turnaround > 0) || !(s.share > 0)) return rest;
    return { ...rest, minutes: Math.max(1, Math.round((turnaround * s.share) / 100)), unit };
  });
}
/** Ratios typed as plain numbers (1 : 2 : 1) as percentages adding up to 100. */
export function sharesFromWeights(weights) {
  const total = weights.reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
  if (!(total > 0)) return weights.map(() => undefined);
  const shares = weights.map((n) => round2(((n > 0 ? n : 0) * 100) / total));
  // Rounding: the last share takes the difference, so they add up to exactly 100.
  const last = shares.length - 1;
  shares[last] = round2(100 - shares.slice(0, last).reduce((sum, n) => sum + n, 0));
  return shares;
}

/**
 * A step list as a job's workflow: its stages, hours per stage and, timed by ratio, shares per stage.
 * @returns {{ stages: string[], hours: Record<string, number>, shares?: Record<string, number> }}
 */
export function stepsWorkflow(steps) {
  /** @type {Record<string, number>} */
  const hours = {};
  for (const s of steps) if (s.minutes) hours[s.name] = Math.round((s.minutes / 60) * 10000) / 10000;
  const stages = [...FIXED_START, ...steps.map((s) => s.name), ...FIXED_END];
  if (!byRatio(steps)) return { stages, hours };
  return { stages, hours, shares: Object.fromEntries(steps.map((s) => [s.name, s.share])) };
}
/** A stage list (and hours) as steps: for older settings and jobs. */
export function stagesToSteps(stages, hours = {}) {
  return (stages ?? [])
    .filter((s) => !FIXED.includes(s))
    .map((name) => {
      const h = Number(hours?.[name]);
      if (!(h > 0)) return { name };
      const minutes = Math.min(MAX_MINUTES, Math.max(1, Math.round(h * 60)));
      return { name, minutes, unit: minutes % 1440 === 0 ? 'd' : minutes % 60 === 0 ? 'h' : 'm' };
    });
}

/** The amount and unit to show for a step's time. */
export const stepAmount = (step) => (step.minutes ? step.minutes / UNITS[step.unit ?? 'm'] : '');

/**
 * The steps a business gives items without their own: its fallback saved workflow, else Processing.
 * @returns {import('./types').Step[]}
 */
export function fallbackSteps(options, kind = '') {
  const own =
    kind === 'shelf'
      ? options.defaultShelfWorkflowId
      : kind === 'service'
        ? options.defaultServiceWorkflowId
        : null;
  const flows = options.workflows ?? [];
  const saved = flows.find((w) => w.id === own) ?? flows.find((w) => w.id === options.defaultWorkflowId);
  return saved ? saved.steps : MASTER_STEPS;
}
/** The name of the saved workflow items of a kind follow ('' for Added → Processing → Completed). */
export function fallbackName(options, kind = '') {
  const own =
    kind === 'shelf'
      ? options.defaultShelfWorkflowId
      : kind === 'service'
        ? options.defaultServiceWorkflowId
        : null;
  const flows = options.workflows ?? [];
  return (
    (flows.find((w) => w.id === own) ?? flows.find((w) => w.id === options.defaultWorkflowId))?.name ?? ''
  );
}
/**
 * The steps an item's jobs follow: its own, else the business's usual steps for its kind
 * ('service' or 'shelf'), else the business's usual steps.
 * @returns {import('./types').Step[]}
 */
export const itemSteps = (options, production, kind = '') =>
  production?.steps ?? fallbackSteps(options, kind);
