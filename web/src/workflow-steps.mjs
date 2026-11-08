// Workflows as steps: every job goes Added → its own steps → Completed → Collected. The first and
// last steps are fixed; the steps between come from the item (services and templates can have their
// own), else the business's fallback (a saved workflow, or the master default: Processing).
// Saved workflows (Business Settings → Dropdowns & workflow) are starting blocks: an item copies
// one and edits its copy, so a later change to the saved workflow changes nothing already copied.
// A step's time is kept in minutes, with the unit it was typed in (m, h, d) for showing it again.

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
  return steps.map((step) => {
    const name = String(step?.name ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name))
      throw Error(`${label}: give each step a name up to 40 characters.`);
    if (FIXED.some((f) => f.toLowerCase() === name.toLowerCase()))
      throw Error(`${label}: ${name} is already the first or last step.`);
    if (seen.has(name.toLowerCase())) throw Error(`${label}: two steps are called "${name}".`);
    seen.add(name.toLowerCase());
    const out = { name };
    if (step.minutes !== undefined && step.minutes !== null && step.minutes !== '') {
      const minutes = Number(step.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)
        throw Error(`${label}: ${name} takes from 1 minute to 90 days.`);
      out.minutes = minutes;
      out.unit = UNITS[step.unit] ? step.unit : minutes % 1440 === 0 ? 'd' : minutes % 60 === 0 ? 'h' : 'm';
    }
    return out;
  });
}

/**
 * A step list as a job's workflow: its stages and hours per stage.
 * @returns {{ stages: string[], hours: Record<string, number> }}
 */
export function stepsWorkflow(steps) {
  /** @type {Record<string, number>} */
  const hours = {};
  for (const s of steps) if (s.minutes) hours[s.name] = Math.round((s.minutes / 60) * 10000) / 10000;
  return { stages: [...FIXED_START, ...steps.map((s) => s.name), ...FIXED_END], hours };
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
export function fallbackSteps(options) {
  const saved = (options.workflows ?? []).find((w) => w.id === options.defaultWorkflowId);
  return saved ? saved.steps : MASTER_STEPS;
}
/**
 * The steps an item's jobs follow: its own, else the business's fallback.
 * @returns {import('./types').Step[]}
 */
export const itemSteps = (options, production) => production?.steps ?? fallbackSteps(options);
