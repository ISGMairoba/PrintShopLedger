import {
  consumptionUnit,
  formulaNames,
  formulaText,
  hasCost,
  parseFormula,
  productName,
  variantMembers,
  templateProblem,
  validatePricingSettings,
  validateTemplate,
} from './pricing-templates.mjs';

export const TEMPLATE_FILE_FORMAT = 'printshopledger.pricing-templates';
export const TEMPLATE_FILE_VERSION = 1;
export const MAX_TEMPLATE_FILE_BYTES = 2 * 1024 * 1024;

const localNames = (t) =>
  new Set([
    ...t.variables.flatMap((v) => (v.kind === 'material' ? [v.key, v.key + '_rate'] : [v.key])),
    ...t.computed.map((v) => v.key),
    ...t.expenses.map((v) => v.key),
  ]);

/** Resolve every reference, including costs in unselected material options and IF branches. */
function dependencies(templates, items) {
  const found = new Map();
  const add = (id, use) => {
    const item = items.find((s) => s.id === id);
    if (!item) throw Error('A referenced catalogue item is missing. Repair the template before exporting.');
    const entry = found.get(id) ?? { item, uses: new Set() };
    entry.uses.add(use);
    found.set(id, entry);
  };
  for (const t of templates) {
    const locals = localNames(t);
    for (const v of t.variables)
      if (v.kind === 'material')
        for (const option of v.options) {
          add(option.serviceId, 'cost');
          if (t.computed.some((c) => c.stock?.variable === v.key)) add(option.serviceId, 'stock');
        }
    for (const c of t.computed) if (c.stock?.serviceId) add(c.stock.serviceId, 'stock');
    // A product with variants is referenced by its group: the file names the product, and the
    // importing business maps it to one of its own products.
    for (const c of t.computed)
      if (c.stock?.variantGroup) {
        const id = c.stock.variantGroup;
        const member =
          items.find((s) => s.id === id && s.variantsRef) ?? items.find((s) => s.variantGroup === id);
        if (!member) throw Error('A referenced product is missing. Repair the template before exporting.');
        const entry = found.get(id) ?? {
          item: member.variantsRef
            ? member
            : { ...member, id, description: productName(member), costing: null },
          uses: new Set(),
        };
        entry.uses.add('variants');
        found.set(id, entry);
      }
    for (const f of [...t.computed, ...t.expenses])
      for (const name of formulaNames(parseFormula(f.formula))) {
        if (locals.has(name)) continue;
        const cost = items.find((s) => s.costing?.key === name);
        const item =
          cost ?? (name.endsWith('_price') ? items.find((s) => s.costing?.key === name.slice(0, -6)) : null);
        if (!item) throw Error(`Unknown formula value "${name}". Repair the template before exporting.`);
        add(item.id, cost ? 'cost' : 'price');
      }
  }
  return [...found.values()];
}

/** No customer data, stock balances or catalogue prices are included. Fixed formula amounts remain. */
export function exportTemplateFile(templates, ledger) {
  if (!Array.isArray(templates) || !templates.length || templates.length > 500)
    throw Error('Choose 1 to 500 templates to export.');
  const canonical = templates.map(validateTemplate);
  const items = dependencies(canonical, ledger.services).map(({ item, uses }) => ({
    id: item.id,
    name: item.description,
    key: item.costing?.key ?? '',
    unit: consumptionUnit(item, ledger.materials),
    stock: item.materialId !== null && item.materialId !== undefined,
    uses: [...uses].sort(),
  }));
  if (items.length > 1000)
    throw Error('Export fewer templates: at most 1,000 item references fit in a transfer.');
  const file = {
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    templates: canonical.map((t) => ({
      ...t,
      computed: t.computed.map(({ expression, ...c }) => c),
      expenses: t.expenses.map(({ expression, ...e }) => e),
    })),
    items,
  };
  const text = JSON.stringify(file, null, 2);
  if (new TextEncoder().encode(text).length > MAX_TEMPLATE_FILE_BYTES)
    throw Error('Export is larger than 2 MB. Export fewer templates at a time.');
  return text;
}

export function readTemplateFile(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_TEMPLATE_FILE_BYTES)
    throw Error('Choose a template JSON file no larger than 2 MB.');
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw Error('This is not a valid template JSON file.');
  }
  if (file?.format !== TEMPLATE_FILE_FORMAT || file.version !== TEMPLATE_FILE_VERSION)
    throw Error('Unsupported template file format or version.');
  if (
    !Array.isArray(file.templates) ||
    !file.templates.length ||
    file.templates.length > 500 ||
    !Array.isArray(file.items) ||
    file.items.length > 1000
  )
    throw Error('Invalid template file contents.');
  const templates = file.templates.map(validateTemplate);
  if (new Set(templates.map((t) => t.id)).size !== templates.length)
    throw Error('The file contains duplicate template identities.');
  const ids = new Set();
  const keys = new Set();
  const items = file.items.map((s) => {
    if (
      !s ||
      typeof s.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(s.id) ||
      ids.has(s.id) ||
      typeof s.name !== 'string' ||
      !s.name.trim() ||
      s.name.length > 200 ||
      typeof s.key !== 'string' ||
      (s.key && !/^[a-z][a-z0-9_]{0,39}$/.test(s.key)) ||
      (s.key && keys.has(s.key)) ||
      typeof s.stock !== 'boolean' ||
      typeof s.unit !== 'string' ||
      s.unit.length > 80 ||
      !Array.isArray(s.uses) ||
      !s.uses.length ||
      s.uses.some((u) => !['cost', 'price', 'stock', 'variants'].includes(u)) ||
      (s.uses.includes('variants') && s.uses.length > 1)
    )
      throw Error('Invalid catalogue references in template file.');
    ids.add(s.id);
    if (s.key) keys.add(s.key);
    return { id: s.id, name: s.name, key: s.key, unit: s.unit, stock: s.stock, uses: [...new Set(s.uses)] };
  });
  // Derive dependencies again: reject omitted and forged manifests before displaying a review.
  const actual = dependencies(
    templates,
    items.map((s) => ({
      id: s.id,
      description: s.name,
      costing: s.key ? { key: s.key } : null,
      variantsRef: s.uses.includes('variants'),
    })),
  );
  if (
    actual.length !== items.length ||
    actual.some(({ item, uses }) => {
      const entry = items.find((s) => s.id === item.id);
      return uses.size !== entry.uses.length || [...uses].some((u) => !entry.uses.includes(u));
    })
  )
    throw Error('The catalogue references do not match the templates.');
  return { templates, items };
}

/** Local products with variants that can take a template's stock (for a "variants" reference). */
export function variantProducts(ledger) {
  const ids = [
    ...new Set(ledger.services.filter((s) => s.variantGroup && !s.archived).map((s) => s.variantGroup)),
  ];
  return ids
    .map((id) => ({ id, members: variantMembers(ledger, id) }))
    .filter((g) => g.members.length)
    .map((g) => ({
      id: g.id,
      name: productName(g.members[0]),
      unit: consumptionUnit(g.members[0], ledger.materials),
    }));
}
export function compatibleTemplateItem(source, target, materials) {
  if (source.uses.includes('variants')) return false;
  return (
    !!target &&
    !target.archived &&
    (target.materialId === null || materials.some((m) => m.id === target.materialId && !m.archived)) &&
    consumptionUnit(target, materials) === source.unit &&
    (!source.uses.includes('stock') || source.stock === (target.materialId !== null)) &&
    (!source.uses.includes('cost') || hasCost(target.costing)) &&
    (!source.uses.includes('price') || (!!target.costing?.key && !target.private))
  );
}

/** Suggestions require a unique matching formula name and unit; the user reviews every mapping. */
export function suggestTemplateMappings(file, ledger) {
  const products = variantProducts(ledger);
  return Object.fromEntries(
    file.items.map((s) => {
      if (s.uses.includes('variants')) {
        const matches = products.filter((g) => g.name === s.name && g.unit === s.unit);
        return [s.id, matches.length === 1 ? matches[0].id : ''];
      }
      const candidates = ledger.services.filter(
        (target) =>
          compatibleTemplateItem(s, target, ledger.materials) &&
          (s.key ? target.costing?.key === s.key : target.description === s.name),
      );
      return [s.id, candidates.length === 1 ? candidates[0].id : ''];
    }),
  );
}

export function importedTemplateNames(file, existing) {
  const names = new Set(existing.filter((t) => !t.archived).map((t) => t.name.toLowerCase()));
  return file.templates.map((t) => {
    let name = t.name,
      suffix = 1;
    while (names.has(name.toLowerCase())) {
      const ending = ` (import ${suffix++})`;
      name = t.name.slice(0, 100 - ending.length) + ending;
    }
    names.add(name.toLowerCase());
    return name;
  });
}

/** Build new copies only. Existing templates, catalogue items and stock are never overwritten. */
export function importTemplateFile(
  file,
  ledger,
  pricing,
  mapping,
  names,
  makeId = () => crypto.randomUUID(),
) {
  const targets = new Map();
  const products = variantProducts(ledger);
  for (const source of file.items) {
    if (source.uses.includes('variants')) {
      const product = products.find((g) => g.id === mapping[source.id] && g.unit === source.unit);
      if (!product) throw Error(`Choose a local product with variants for ${source.name} (${source.unit}).`);
      targets.set(source.id, product);
      continue;
    }
    const target = ledger.services.find((s) => s.id === mapping[source.id]);
    if (!compatibleTemplateItem(source, target, ledger.materials))
      throw Error(`Choose a compatible local item for ${source.name} (${source.unit}).`);
    targets.set(source.id, target);
  }
  const templates = file.templates.map((source, index) => {
    const locals = localNames(source);
    const replacements = new Map();
    for (const item of file.items) {
      const target = targets.get(item.id);
      if (item.key && target.costing?.key) {
        if (item.uses.includes('cost')) replacements.set(item.key, target.costing.key);
        if (item.uses.includes('price')) replacements.set(item.key + '_price', target.costing.key + '_price');
      }
    }
    const formula = (text) => {
      const tree = parseFormula(text);
      const walk = (node) => {
        if (node.op === 'name' && !locals.has(node.args[0]) && replacements.has(node.args[0])) {
          const name = replacements.get(node.args[0]);
          if (locals.has(name))
            throw Error(
              `The local formula name "${name}" conflicts with a variable. Rename that local item's formula name first.`,
            );
          node.args[0] = name;
        } else if (node.op !== 'number' && node.op !== 'name') node.args.forEach(walk);
      };
      walk(tree);
      return formulaText(tree);
    };
    const t = validateTemplate({
      ...source,
      id: makeId(),
      name: names[index],
      version: 1,
      archived: false,
      variables: source.variables.map((v) => ({
        ...v,
        ...(v.kind === 'material'
          ? { options: v.options.map((o) => ({ ...o, serviceId: targets.get(o.serviceId).id })) }
          : {}),
      })),
      computed: source.computed.map((c) => ({
        ...c,
        formula: formula(c.formula),
        stock: c.stock?.serviceId
          ? { serviceId: targets.get(c.stock.serviceId).id }
          : c.stock?.variantGroup
            ? { variantGroup: targets.get(c.stock.variantGroup).id }
            : c.stock,
      })),
      expenses: source.expenses.map((e) => ({
        key: e.key,
        label: e.label,
        formula: formula(e.formula),
        ...(e.calculation
          ? {
              calculation:
                e.calculation.method === 'custom'
                  ? { ...e.calculation }
                  : {
                      ...e.calculation,
                      rate: e.calculation.rate ? formula(e.calculation.rate) : '',
                      capacity: e.calculation.capacity ? formula(e.calculation.capacity) : '',
                    },
            }
          : {}),
      })),
    });
    const problem = templateProblem(ledger, t);
    if (problem) throw Error(`${t.name}: ${problem}`);
    return t;
  });
  return validatePricingSettings({ ...pricing, templates: [...pricing.templates, ...templates] }).templates;
}
