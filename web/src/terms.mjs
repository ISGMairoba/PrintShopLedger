// Business words. A shop can call jobs "orders", services "products" and materials "stock items",
// and rename the three fixed job stages (Added, Completed, Collected). Only what is shown changes:
// stored records, events and the server keep the original names, so switching back is safe.

const fixedStages = ['Added', 'Completed', 'Collected'];

export const termPresets = {
  print: {
    label: 'Print shop',
    job: 'job',
    jobs: 'jobs',
    service: 'service',
    services: 'services',
    material: 'material',
    materials: 'materials',
    stages: { Added: 'Added', Completed: 'Completed', Collected: 'Collected' },
  },
  retail: {
    label: 'Retail shop',
    job: 'order',
    jobs: 'orders',
    service: 'product',
    services: 'products',
    material: 'stock item',
    materials: 'stock items',
    stages: { Added: 'Order placed', Completed: 'Ready', Collected: 'Collected' },
  },
  mixed: {
    label: 'Print and retail',
    job: 'order',
    jobs: 'orders',
    service: 'item',
    services: 'items',
    material: 'stock item',
    materials: 'stock items',
    stages: { Added: 'Order placed', Completed: 'Ready', Collected: 'Collected' },
  },
};

const wordKeys = ['job', 'jobs', 'service', 'services', 'material', 'materials'];
const presetTerms = (name) => {
  const { label: _label, stages, ...words } = termPresets[name];
  return { preset: name, ...words, stages: { ...stages } };
};
export const termDefaults = () => presetTerms('print');

/** Business words from settings: { preset, job, jobs, service, services, material, materials, stages }. */
export function validateTerms(input) {
  if (input === undefined || input === null) return termDefaults();
  if (typeof input !== 'object') throw Error('Words: choose a preset or enter your own words.');
  const preset = input.preset === 'custom' || termPresets[input.preset] ? input.preset : 'print';
  const base = preset === 'custom' ? termDefaults() : presetTerms(preset);
  const value = { ...base, ...input, preset, stages: { ...base.stages, ...(input.stages ?? {}) } };
  const clean = (text, label, max) => {
    if (typeof text !== 'string') throw Error(`Words: enter ${label}.`);
    const word = text.trim().replace(/\s+/g, ' ');
    if (!word || word.length > max || !/^[\p{L}\p{N}][\p{L}\p{N} '&./-]*$/u.test(word))
      throw Error(`Words: ${label} must be 1–${max} letters or numbers.`);
    return word;
  };
  const result = { preset };
  for (const key of wordKeys) result[key] = clean(value[key], `a name for "${key}"`, 30).toLowerCase();
  result.stages = {};
  for (const stage of fixedStages)
    result.stages[stage] = clean(value.stages[stage], `a name for "${stage}"`, 40);
  return result;
}

const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const pattern = /\b(jobs|job|services|service|materials|material)\b/gi;

/**
 * Put the business's words into an interface text. Only use on text written by the app, never on
 * records people typed (a customer called "Job" stays "Job").
 */
export function renameTerms(text, terms) {
  if (!terms || typeof text !== 'string') return text;
  return text.replace(pattern, (found) => {
    const word = terms[found.toLowerCase()];
    if (!word) return found;
    if (found === found.toUpperCase() && found.length > 1) return word.toUpperCase();
    return found[0] === found[0].toUpperCase() ? capitalise(word) : word;
  });
}

/** How a job stage is shown. Custom stages between Added and Completed keep their own names. */
export const stageName = (stage, terms) => terms?.stages?.[stage] ?? stage;

/** Menu and page names: only pages named after jobs, services or materials change. */
const renamedPages = ['Jobs', 'Services', 'Materials', 'Material Waste'];
export const pageName = (page, terms) => (renamedPages.includes(page) ? renameTerms(page, terms) : page);
