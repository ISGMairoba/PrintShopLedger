import { validStageHours } from './stage-time.mjs';
import { fallbackSteps, stagesToSteps, stepsWorkflow, validSteps } from './workflow-steps.mjs';
export const defaultOptions = () => ({
  paymentMethods: [
    { label: 'Cash', kind: 'Cash', enabled: true },
    { label: 'POS', kind: 'POS', enabled: true },
    { label: 'Transfer', kind: 'Transfer', enabled: true },
  ],
  expenseCategories: [
    'Materials',
    'Electricity',
    'Fuel',
    'Rent',
    'Wages',
    'Maintenance',
    'Delivery',
    'Outsourcing',
    'Internet / phone',
    'Other',
  ],
  jobSources: ['In shop / USB', 'Shop network', 'WhatsApp', 'Email', 'Other'],
  stockReasons: ['Restocking', 'Stock Count Correction', 'Returned Stock', 'Damaged Stock'],
  materialUnits: ['sheet', 'piece', 'metre', 'square metre', 'roll', 'kilogram', 'litre'],
  /** The stages of items without their own steps (kept from the fallback below, for older apps). */
  jobStages: ['Added', 'Processing', 'Completed', 'Collected'],
  /** Hours per stage of jobStages (kept from the fallback below). */
  stageHours: /** @type {Record<string, number>} */ ({}),
  /** Saved workflows: starting blocks an item copies and changes (Logo, Paper bag…). */
  workflows: /** @type {SavedWorkflow[]} */ ([]),
  /** The saved workflow items without their own steps follow; none: Added → Processing → Completed. */
  defaultWorkflowId: /** @type {string | null} */ (null),
});
/** @typedef {{ name: string, minutes?: number, unit?: 'm' | 'h' | 'd' }} Step */
/** @typedef {{ id: string, name: string, steps: Step[] }} SavedWorkflow */
export const CURRENT_STAGES_ID = 'our-current-stages';
export function validateList(values, label, max = 80) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 30)
    throw Error(`${label}: enter 1–30 options.`);
  const list = values.map((value) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > max ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw Error(`${label}: each option needs a name up to ${max} characters.`);
    return value.trim();
  });
  if (new Set(list.map((value) => value.toLowerCase())).size !== list.length)
    throw Error(`${label}: remove duplicate names.`);
  return list;
}
export function validateWorkflow(value) {
  const stages = validateList(value, 'Job stages');
  if (
    stages.length < 3 ||
    stages.length > 20 ||
    stages[0] !== 'Added' ||
    stages.at(-2) !== 'Completed' ||
    stages.at(-1) !== 'Collected'
  )
    throw Error('Job stages must start with Added and end with Completed, then Collected (up to 20 stages).');
  return stages;
}
/** Saved workflows: up to 30, each with a unique name and its steps (older ones kept stages). */
export function validateWorkflows(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 30) throw Error('Keep at most 30 workflows.');
  const names = new Set();
  return list.map((w) => {
    const name = String(w?.name ?? '').trim();
    if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name))
      throw Error('Give each workflow a name up to 60 characters.');
    if (names.has(name.toLowerCase())) throw Error(`Two workflows are called "${name}".`);
    names.add(name.toLowerCase());
    if (typeof w.id !== 'string' || !/^[0-9a-z-]{8,40}$/i.test(w.id)) throw Error('Invalid workflow.');
    return { id: w.id, name, steps: validSteps(w.steps ?? stagesToSteps(w.stages, w.hours), name) };
  });
}
export function validateOptions(input) {
  const value = { ...defaultOptions(), ...input };
  for (const [key, label, max] of [
    ['expenseCategories', 'Expense categories', 80],
    ['jobSources', 'Job sources', 80],
    ['stockReasons', 'Stock reasons', 200],
    ['materialUnits', 'Material units', 40],
  ])
    value[key] = validateList(value[key], label, max);
  value.workflows = validateWorkflows(value.workflows);
  // Before saved workflows, a business had one list of stages: it becomes the saved workflow
  // "Our current stages", followed by items without their own steps, so nothing changes.
  if (input?.defaultWorkflowId === undefined && !value.workflows.some((w) => w.id === CURRENT_STAGES_ID)) {
    const old = validateWorkflow(value.jobStages);
    const steps = stagesToSteps(old, validStageHours(value.stageHours, old));
    if (steps.length && !(steps.length === 1 && steps[0].name === 'Processing' && !steps[0].minutes)) {
      value.workflows = [
        { id: CURRENT_STAGES_ID, name: 'Our current stages', steps },
        ...value.workflows,
      ].slice(0, 30);
      value.defaultWorkflowId = CURRENT_STAGES_ID;
    }
  }
  if (!value.workflows.some((w) => w.id === value.defaultWorkflowId)) value.defaultWorkflowId = null;
  const fallback = stepsWorkflow(fallbackSteps(value));
  value.jobStages = fallback.stages;
  value.stageHours = fallback.hours;
  if (
    !Array.isArray(value.paymentMethods) ||
    !value.paymentMethods.length ||
    value.paymentMethods.length > 30
  )
    throw Error('Enter 1–30 payment methods.');
  validateList(
    value.paymentMethods.map((item) => item?.label),
    'Payment methods',
  );
  value.paymentMethods = value.paymentMethods.map((item) => {
    if (!['Cash', 'POS', 'Transfer', 'Other'].includes(item.kind) || typeof item.enabled !== 'boolean')
      throw Error('Choose an accounting type for each payment method.');
    return { label: item.label.trim(), kind: item.kind, enabled: item.enabled };
  });
  if (!value.paymentMethods.some((item) => item.enabled))
    throw Error('Keep at least one payment method enabled.');
  return value;
}
// Jobs from before each job kept its own stages followed the stages of the time.
export const jobWorkflow = (job) =>
  validateWorkflow(job.workflow ?? ['Added', 'In Queue', 'Printing', 'Completed', 'Collected']);
/**
 * How a payment or checkout was paid. No money taken shows as "Wallet" when customer credit
 * covered it, otherwise "None" — never the method that happened to be selected.
 */
export const paymentName = (record) => {
  const money = record.cashReceived ?? record.amount;
  // Refunds carry the money paid out in walletUsed, so they keep their method.
  if (money === 0 && !record.refundId) return record.walletUsed ? 'Wallet' : 'None';
  return record.methodLabel || record.method;
};
