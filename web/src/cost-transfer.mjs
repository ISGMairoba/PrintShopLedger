import { validCosting, hasCost } from './pricing-templates.mjs';

export const COST_FILE_FORMAT = 'printshopledger.pricing-costs';
export const MAX_COST_FILE_BYTES = 2 * 1024 * 1024;

export function readCostFile(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_COST_FILE_BYTES)
    throw Error('Choose a cost JSON file no larger than 2 MB.');
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw Error('This is not a valid cost JSON file.');
  }
  if (
    file?.format !== COST_FILE_FORMAT ||
    file.version !== 1 ||
    !Array.isArray(file.costs) ||
    file.costs.length < 1 ||
    file.costs.length > 500
  )
    throw Error('Unsupported cost file. Use a version 1 pricing-costs file with 1 to 500 costs.');
  const keys = new Set();
  return file.costs.map((entry) => {
    if (
      typeof entry?.description !== 'string' ||
      !entry.description.trim() ||
      entry.description.trim().length > 200 ||
      /[\x00-\x1f\x7f]/.test(entry.description)
    )
      throw Error('Each cost needs a name of up to 200 characters.');
    const costing = validCosting(entry.costing);
    if (!hasCost(costing)) throw Error('Each imported item needs a template cost amount.');
    if (keys.has(costing.key)) throw Error(`The formula name "${costing.key}" is repeated in the file.`);
    keys.add(costing.key);
    return { description: entry.description.trim(), costing };
  });
}

/** Existing active formula names are kept, never repriced or relinked by an import. */
export function reviewCostImport(costs, ledger) {
  return costs.map((cost) => {
    const matches = ledger.services.filter((s) => !s.archived && s.costing?.key === cost.costing.key);
    if (matches.length > 1)
      throw Error(`More than one active item uses "${cost.costing.key}". Repair the catalogue first.`);
    const existing = matches[0] ?? null;
    if (existing && (!hasCost(existing.costing) || existing.materialId !== null))
      throw Error(
        `"${cost.costing.key}" belongs to an incompatible item. Rename the imported formula name and its template references, or match your existing item in template import.`,
      );
    return { ...cost, existing };
  });
}

export function costImportEvents(
  costs,
  ledger,
  actor,
  makeId = () => crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  return reviewCostImport(costs, ledger)
    .filter((row) => !row.existing)
    .map((row) => ({
      id: makeId(),
      kind: 'service.created',
      data: {
        id: makeId(),
        description: row.description,
        price: 0,
        materialId: null,
        shelfItem: false,
        private: true,
        costing: row.costing,
        modifiedBy: actor.id,
        modifiedByLabel: actor.label,
        modifiedAt: now,
      },
    }));
}
