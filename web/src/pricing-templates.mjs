import {
  floorDiv,
  keyPattern,
  formulaFunctions,
  parseFormula,
  formulaNames,
  formulaText,
  decimal,
  canonical,
  toNumber,
  evaluate,
  round12,
  add,
  sub,
  mul,
  div,
  toStep,
  ZERO,
  ONE,
  HUNDRED,
} from './pricing-formulas.mjs';
// Keep existing imports working while callers migrate to the formula module.
export {
  keyPattern,
  formulaFunctions,
  parseFormula,
  formulaNames,
  formulaText,
  decimal,
  canonical,
  toNumber,
  evaluate,
} from './pricing-formulas.mjs';

// Pricing templates, modelled on Costora. A template has editable variables (what staff enter),
// computed variables (paper, cards, impressions...), expenses (what the job costs) and a pricing
// rule (markup or margin, a minimum, a maximum discount and rounding). Costs come from services and
// products that have a template cost; private ones exist only for templates and are never sold.
//
// Formulas are a small arithmetic grammar evaluated with exact decimals, never JavaScript. Every
// operation is rounded to 12 decimal places, exactly as the server does when it checks the price.

/** @returns {import('./types').PricingSettings} */
export const pricingDefaults = () => ({
  enabled: false,
  maxTemplates: 100,
  auditRanks: [2, 3],
  templates: [],
});
/** The most active templates a business may choose to allow. */
export const TEMPLATE_LIMIT = 500;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reservedNames = new Set(Object.keys(formulaFunctions).map((f) => f.toLowerCase()));
export const variableKinds = ['number', 'options', 'material', 'yesno'];
export const expenseMethods = ['fixed', 'perItem', 'perInput', 'orderInput', 'batch', 'custom'];
export const roundingChoices = [0.01, 1, 5, 10, 50, 100, 500, 1000];

/** An error about one field, so forms can highlight it. `field` is a variable key or 'discount'. */
export class FieldError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'FieldError';
    this.field = field;
  }
}

// ---------------------------------------------------------------- expense methods (Costora)

/** Read a standard method back from a formula without changing it; otherwise 'custom'. */
export function expenseControls(source, variableKeys) {
  const fallback = { method: 'custom', rate: '100', input: 'quantity', capacity: '25' };
  const keys = new Set(variableKeys);
  try {
    const tree = parseFormula(source);
    const factors = (n) => (n.op === '*' ? [...factors(n.args[0]), ...factors(n.args[1])] : [n]);
    const render = (n) => formulaText(n).replace(/^\((.*)\)$/, '$1');
    const parts = factors(tree);
    const batch = parts.findIndex(
      (n) =>
        n.op === 'CEILING' &&
        n.args.length === 1 &&
        n.args[0].op === '/' &&
        n.args[0].args[0].op === 'name' &&
        n.args[0].args[0].args[0] === 'quantity',
    );
    if (batch >= 0)
      return {
        ...fallback,
        method: 'batch',
        capacity: render(parts[batch].args[0].args[1]),
        rate:
          parts
            .filter((_, i) => i !== batch)
            .map(render)
            .join(' * ') || '1',
      };
    const q = parts.findIndex((n) => n.op === 'name' && n.args[0] === 'quantity');
    const v = parts.findIndex((n) => n.op === 'name' && n.args[0] !== 'quantity' && keys.has(n.args[0]));
    if (q >= 0 && v >= 0)
      return {
        ...fallback,
        method: 'perInput',
        input: parts[v].args[0],
        rate:
          parts
            .filter((_, i) => i !== q && i !== v)
            .map(render)
            .join(' * ') || '1',
      };
    if (q >= 0 && parts.length > 1)
      return {
        ...fallback,
        method: 'perItem',
        rate: parts
          .filter((_, i) => i !== q)
          .map(render)
          .join(' * '),
      };
    if (v >= 0 && parts.length > 1)
      return {
        ...fallback,
        method: 'orderInput',
        input: parts[v].args[0],
        rate: parts
          .filter((_, i) => i !== v)
          .map(render)
          .join(' * '),
      };
    if (!formulaNames(tree).some((name) => keys.has(name) || name === 'quantity'))
      return { ...fallback, method: 'fixed', rate: source.trim() };
  } catch {
    /* fall through */
  }
  return fallback;
}
/** The formula a standard method stands for. */
export function formulaFromControls(c) {
  if (c.method === 'custom') throw Error('Custom formulas are edited directly.');
  if (c.method === 'fixed') return c.rate;
  if (c.method === 'perItem') return `quantity * (${c.rate})`;
  if (c.method === 'perInput') {
    if (!c.input || c.input === 'quantity') throw Error('Choose a variable other than quantity.');
    return `quantity * ${c.input} * (${c.rate})`;
  }
  if (c.method === 'orderInput') return `${c.input} * (${c.rate})`;
  return `CEILING(quantity / (${c.capacity})) * (${c.rate})`;
}

// ---------------------------------------------------------------- validation

const plain = (v, label, max) => {
  if (typeof v !== 'string' || v.trim().length > max || /[\x00-\x1f\x7f]/.test(v))
    throw Error(`${label} must be up to ${max} characters.`);
  return v.trim();
};
const required = (v, label, max) => {
  const t = plain(v ?? '', label, max);
  if (!t) throw Error('Enter ' + label.toLowerCase() + '.');
  return t;
};
/** A variable value: 0 to 1,000,000,000 with up to 6 decimal places. */
const amountOf = (v, label) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9 || Math.round(n * 1e6) / 1e6 !== n)
    throw Error(`${label} must be a number from 0 to 1,000,000,000 with up to 6 decimal places.`);
  return n;
};
const percent = (v, label, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max || Math.round(n * 100) / 100 !== n)
    throw Error(`${label} must be from 0 to ${max}, with up to 2 decimal places.`);
  return n;
};

/** Structural checks for one template (no service costs needed). Returns the canonical template. */
export function validateTemplate(t) {
  if (!t || typeof t !== 'object') throw Error('Invalid template.');
  if (
    !uuid.test(t.id) ||
    !Number.isSafeInteger(t.version) ||
    t.version < 1 ||
    typeof t.archived !== 'boolean'
  )
    throw Error('Invalid template identity or version.');
  const name = required(t.name, 'A template name', 100);
  const category = plain(t.category ?? '', 'Category', 50);
  const description = plain(t.description ?? '', 'Description', 200);
  if (!Array.isArray(t.variables) || t.variables.length < 1 || t.variables.length > 30)
    throw Error('Use 1 to 30 editable variables.');
  if (!Array.isArray(t.computed) || t.computed.length > 100)
    throw Error('Use at most 100 computed variables.');
  if (!Array.isArray(t.expenses) || t.expenses.length < 1 || t.expenses.length > 100)
    throw Error('Add 1 to 100 expenses.');
  const names = new Set();
  const claim = (key, what) => {
    if (typeof key !== 'string' || !keyPattern.test(key))
      throw Error(`${what}: use a name of lowercase letters, numbers and _ (starting with a letter).`);
    if (reservedNames.has(key)) throw Error(`${what}: "${key}" is a formula function name.`);
    if (names.has(key)) throw Error(`The name "${key}" is used twice in this template.`);
    names.add(key);
    return key;
  };
  const variables = t.variables.map((v) => {
    const label = required(v.label, 'A variable label', 80);
    const key = claim(v.key, label);
    if (!variableKinds.includes(v.kind)) throw Error(label + ': choose a variable type.');
    if (key === 'quantity' && v.kind !== 'number') throw Error('Quantity must stay a number.');
    const unit = plain(v.unit ?? '', label + ' unit', 40);
    const clientVisible = v.clientVisible !== false;
    let integer = !!v.integer,
      options = [],
      min,
      max;
    if (v.kind === 'yesno') {
      min = 0;
      max = 1;
      integer = true;
    } else if (v.kind === 'number') {
      min = amountOf(v.min, label + ' minimum');
      max = amountOf(v.max, label + ' maximum');
      if (max < min) throw Error(label + ': the maximum must be at least the minimum.');
    } else {
      if (!Array.isArray(v.options) || !v.options.length || v.options.length > 100)
        throw Error(label + ': add 1 to 100 options.');
      const seen = new Set(),
        services = new Set();
      options = v.options.map((o) => {
        const value = amountOf(o.value, label + ' option value');
        if (seen.has(value)) throw Error(label + ': each option needs its own value.');
        seen.add(value);
        const option = { value, label: required(o.label, label + ' option label', 80) };
        if (v.kind === 'material') {
          if (!uuid.test(o.serviceId ?? '') || services.has(o.serviceId))
            throw Error(label + ': choose a different costed item for each option.');
          if (!Number.isInteger(value) || value < 1)
            throw Error(label + ': option values must be whole numbers.');
          services.add(o.serviceId);
          option.serviceId = o.serviceId;
        }
        return option;
      });
      if (v.kind === 'material') integer = true;
      if (integer && options.some((o) => !Number.isInteger(o.value)))
        throw Error(label + ': whole numbers only, so option values must be whole.');
      min = Math.min(...options.map((o) => o.value));
      max = Math.max(...options.map((o) => o.value));
    }
    const value = amountOf(v.default, label + ' default');
    if (value < min || value > max || (integer && !Number.isInteger(value)))
      throw Error(`${label}: the default must be ${integer ? 'a whole number ' : ''}from ${min} to ${max}.`);
    if (v.kind === 'options' || v.kind === 'material')
      if (!options.some((o) => o.value === value))
        throw Error(label + ': the default must be one of the options.');
    if (key === 'quantity' && (min <= 0 || max > 1000000))
      throw Error('Quantity must be more than 0 and at most 1,000,000.');
    const out = { key, label, kind: v.kind, unit, default: value, min, max, integer, clientVisible };
    if (options.length) out.options = options;
    return out;
  });
  if (!variables.some((v) => v.key === 'quantity')) throw Error('Keep the quantity variable.');
  for (const v of variables) if (v.kind === 'material') claim(v.key + '_rate', v.label + ' rate');
  const materialKeys = variables.filter((v) => v.kind === 'material').map((v) => v.key);
  const computed = t.computed.map((c) => {
    const label = required(c.label, 'A computed variable name', 80);
    const key = claim(c.key, label);
    const unit = required(c.unit, label + ' unit', 40);
    const formula = required(c.formula, label + ' formula', 1500);
    let expression;
    try {
      expression = parseFormula(formula);
    } catch (cause) {
      throw Error(`${label}: ${cause.message}`);
    }
    // Computed values stay internal unless the owner chooses to show one on client quotes.
    const out = {
      key,
      label,
      unit,
      formula,
      expression,
      stock: null,
      clientVisible: c.clientVisible === true,
    };
    if (c.stock) {
      if (c.stock.variable !== undefined) {
        if (!materialKeys.includes(c.stock.variable))
          throw Error(label + ': choose a material selection variable to take stock from.');
        out.stock = { variable: c.stock.variable };
      } else if (uuid.test(c.stock.serviceId ?? '')) out.stock = { serviceId: c.stock.serviceId };
      else throw Error(label + ': choose where its stock comes from.');
    }
    return out;
  });
  const expenses = t.expenses.map((e) => {
    const label = required(e.label, 'An expense name', 80);
    const key = claim(e.key, label);
    const formula = required(e.formula, label + ' formula', 1500);
    let expression;
    try {
      expression = parseFormula(formula);
    } catch (cause) {
      throw Error(`${label}: ${cause.message}`);
    }
    const out = { key, label, formula, expression };
    if (e.calculation) {
      const c = e.calculation;
      if (!expenseMethods.includes(c.method)) throw Error(label + ': choose a calculation method.');
      const calculation = {
        method: c.method,
        rate: plain(String(c.rate ?? ''), label + ' rate', 200),
        input: plain(String(c.input ?? ''), label + ' variable', 40),
        capacity: plain(String(c.capacity ?? ''), label + ' batch size', 40),
      };
      if (
        c.method !== 'custom' &&
        formulaText(parseFormula(formulaFromControls(calculation))) !== formulaText(expression)
      )
        throw Error(label + ': the formula does not match its calculation method.');
      out.calculation = calculation;
    }
    return out;
  });
  // Every name must be defined here or be a service cost; template formulas must not loop.
  const formulas = new Map([...computed, ...expenses].map((x) => [x.key, x]));
  const state = new Map();
  const walk = (key, path) => {
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'active') throw Error('Circular calculation: ' + [...path, key].join(' → '));
    state.set(key, 'active');
    for (const name of formulaNames(formulas.get(key).expression))
      if (formulas.has(name)) walk(name, [...path, key]);
    state.set(key, 'done');
  };
  for (const key of formulas.keys()) walk(key, []);
  const p = t.pricing ?? {};
  if (!['markup', 'margin'].includes(p.method)) throw Error('Choose markup or margin.');
  const rate = percent(p.rate, 'Profit rate', p.method === 'margin' ? 99.99 : 1000);
  const floor = percent(p.floor, 'Minimum profit rate', rate);
  const maxDiscount = percent(p.maxDiscount, 'Maximum discount', 100);
  const rounding = Number(p.rounding);
  if (
    !Number.isFinite(rounding) ||
    rounding < 0.01 ||
    rounding > 100000 ||
    Math.round(rounding * 100) / 100 !== rounding
  )
    throw Error('Round prices to at least ₦0.01, with up to 2 decimal places.');
  return {
    id: t.id,
    name,
    category,
    description,
    version: t.version,
    archived: t.archived,
    variables,
    computed,
    expenses,
    pricing: { method: p.method, rate, floor, maxDiscount, rounding },
  };
}
export function validatePricingSettings(input = pricingDefaults()) {
  if (!input || typeof input.enabled !== 'boolean' || !Array.isArray(input.templates))
    throw Error('Pricing needs a switch and a list of templates.');
  const maxTemplates = input.maxTemplates ?? 100;
  if (!Number.isInteger(maxTemplates) || maxTemplates < 1 || maxTemplates > TEMPLATE_LIMIT)
    throw Error(`The template limit must be a whole number from 1 to ${TEMPLATE_LIMIT}.`);
  if (input.templates.length > TEMPLATE_LIMIT)
    throw Error(`A business can keep at most ${TEMPLATE_LIMIT} templates, including archived ones.`);
  if (input.templates.filter((t) => !t.archived).length > maxTemplates)
    throw Error(
      `Your limit is ${maxTemplates} active templates. Archive one or raise the limit in Business Settings.`,
    );
  const ids = new Set(),
    names = new Set();
  const templates = input.templates.map((t) => {
    const out = validateTemplate(t);
    if (ids.has(out.id)) throw Error('Invalid template identity or version.');
    if (!out.archived && names.has(out.name.toLowerCase()))
      throw Error('Use a different name for each template.');
    ids.add(out.id);
    if (!out.archived) names.add(out.name.toLowerCase());
    return out;
  });
  // Who may see costs and profit (internal audit). Developers always can.
  const auditRanks = input.auditRanks ?? [2, 3];
  if (
    !Array.isArray(auditRanks) ||
    auditRanks.some((r) => ![1, 2, 3].includes(r)) ||
    new Set(auditRanks).size !== auditRanks.length
  )
    throw Error('Choose which ranks may see template costs.');
  return { enabled: input.enabled, maxTemplates, auditRanks: [...auditRanks].sort(), templates };
}

// ---------------------------------------------------------------- service costs

const costKeyFrom = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '') || 'cost';
/** A unique formula name for a service, e.g. "Art card 300gsm" → art_card_300gsm. */
export function suggestCostKey(description, services, ownId) {
  const base = costKeyFrom(description);
  const taken = new Set(
    services.filter((s) => s.id !== ownId && !s.archived && s.costing).map((s) => s.costing.key),
  );
  let key = reservedNames.has(base) || base === 'quantity' ? base + '_cost' : base,
    n = 2;
  while (taken.has(key)) key = `${base.slice(0, 36)}_${n++}`;
  return key;
}
/**
 * A service's use in templates: none, or { key, amount (kobo), per, unit }. The formula name `key`
 * gives its cost (when it has one); `key_price` gives its selling price.
 */
export function validCosting(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object') throw Error('Enter the formula name.');
  const key = String(input.key ?? '').trim();
  if (!keyPattern.test(key) || reservedNames.has(key) || key === 'quantity' || key.endsWith('_price'))
    throw Error(
      'Formula name: use lowercase letters, numbers and _ (not quantity, a function name, or ending in _price).',
    );
  if (input.amount === undefined || input.amount === null) return { key };
  if (!Number.isSafeInteger(input.amount) || input.amount < 0 || input.amount > 100000000000)
    throw Error('Enter the cost, with at most two decimal places.');
  const per = Number(input.per);
  if (!Number.isFinite(per) || per <= 0 || per > 1000000 || Math.round(per * 1000) / 1000 !== per)
    throw Error('Units per cost must be more than 0, with up to 3 decimal places.');
  const unit = plain(String(input.unit ?? ''), 'Bought as', 40);
  return { key, amount: input.amount, per, ...(unit ? { unit } : {}) };
}
/** Whether a service's template use includes a cost (not only a formula name). */
export const hasCost = (costing) => !!costing && costing.amount !== undefined && costing.amount !== null;
/** Naira cost of one consumption unit (12 places). */
export const costRate = (costing) =>
  round12(div({ n: BigInt(costing.amount), d: 100n }, decimal(costing.per)));
/** The unit a service is consumed in: its material's unit, or 'item'. */
export const consumptionUnit = (service, materials) =>
  materials.find((m) => m.id === service.materialId)?.measurementUnit ?? 'item';

// ---------------------------------------------------------------- pricing

const stockCountOf = (ledger, materialId) =>
  ledger.materialHistory
    ?.filter((h) => h.materialId === materialId && h.action === 'material.stock_set')
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) || b.id.localeCompare(a.id))[0]?.id ??
  null;

/** Check and convert entered values (numbers or text) for every variable. */
export function templateInputs(template, supplied, quantity) {
  /** @type {Record<string, number>} */
  const inputs = {};
  if (
    Object.keys(supplied ?? {}).some(
      (key) => key === 'quantity' || !template.variables.some((v) => v.key === key),
    )
  )
    throw Error('Template variables changed. Review the line.');
  for (const v of template.variables) {
    const raw = v.key === 'quantity' ? quantity : (supplied?.[v.key] ?? v.default);
    const range = `${v.label}: enter ${v.integer ? 'a whole number' : 'a number'} from ${v.min} to ${v.max}.`;
    if (raw === '' || raw === null || raw === undefined)
      throw new FieldError(`${v.label} is required.`, v.key);
    let n;
    try {
      n = amountOf(raw, v.label);
    } catch {
      throw new FieldError(range, v.key);
    }
    if (n < v.min || n > v.max || (v.integer && !Number.isInteger(n))) throw new FieldError(range, v.key);
    if (v.options && !v.options.some((o) => o.value === n))
      throw new FieldError(`${v.label}: choose one of the options.`, v.key);
    if (v.key === 'quantity' && Math.round(n * 1000) / 1000 !== n)
      throw new FieldError('Quantity allows up to three decimal places.', v.key);
    if (v.key !== 'quantity') inputs[v.key] = n;
  }
  return inputs;
}

/**
 * Price a template. Returns the job's snapshot: { template, inputs, references, outputs, expenses,
 * price: { cost, raw, amount (kobo), minimum (kobo) }, stock }. Decimal values are exact text.
 */
export function priceTemplate(ledger, template, supplied, quantity, stockIds = {}) {
  const inputs = templateInputs(template, supplied, quantity);
  const values = new Map([['quantity', decimal(quantity)]]);
  for (const [k, n] of Object.entries(inputs)) values.set(k, decimal(n));
  const costed = new Map(
    ledger.services.filter((s) => !s.archived && s.costing).map((s) => [s.costing.key, s]),
  );
  const used = new Map();
  const reference = (service) => {
    if (!used.has(service.costing.key))
      used.set(service.costing.key, {
        serviceId: service.id,
        key: service.costing.key,
        name: service.description,
        version: service.version,
        amount: service.costing.amount,
        per: service.costing.per,
        ...(service.costing.unit ? { purchaseUnit: service.costing.unit } : {}),
        unit: consumptionUnit(service, ledger.materials),
        rate: canonical(costRate(service.costing)),
      });
    return used.get(service.costing.key);
  };
  // A service's selling price in a formula: <formula name>_price, per unit (naira).
  const priceReference = (service, name) => {
    if (!used.has(name))
      used.set(name, {
        serviceId: service.id,
        key: name,
        name: service.description,
        version: service.version,
        amount: service.price,
        per: 1,
        unit: consumptionUnit(service, ledger.materials),
        rate: canonical(div({ n: BigInt(service.price), d: 1n }, HUNDRED)),
        kind: 'price',
      });
    return used.get(name);
  };
  const selected = new Map();
  for (const v of template.variables)
    if (v.kind === 'material') {
      const option = v.options.find((o) => o.value === inputs[v.key]);
      const service = ledger.services.find(
        (s) => s.id === option.serviceId && !s.archived && hasCost(s.costing),
      );
      if (!service)
        throw new FieldError(
          `${v.label}: ${option.label} is no longer available. Review the template.`,
          v.key,
        );
      selected.set(v.key, service);
      values.set(v.key + '_rate', decimal(reference(service).rate));
    }
  const formulas = new Map([...template.computed, ...template.expenses].map((x) => [x.key, x]));
  // Every cost a formula names is looked up first (the server does the same), even in unused IF branches.
  for (const f of formulas.values())
    for (const name of formulaNames(f.expression)) {
      if (values.has(name) || formulas.has(name)) continue;
      const service = costed.get(name);
      if (service) {
        if (!hasCost(service.costing))
          throw Error(
            `${service.description} has no template cost. Use ${name}_price for its selling price.`,
          );
        values.set(name, decimal(reference(service).rate));
        continue;
      }
      const priced = name.endsWith('_price') ? costed.get(name.slice(0, -6)) : null;
      if (!priced)
        throw Error(`Unknown value "${name}". Check the template or the formula name on its item.`);
      values.set(name, decimal(priceReference(priced, name).rate));
    }
  const active = new Set();
  const resolve = (name) => {
    if (values.has(name)) return values.get(name);
    const f = formulas.get(name);
    if (f) {
      if (active.has(name)) throw Error('Circular calculation: ' + name);
      active.add(name);
      const x = evaluate(f.expression, resolve);
      active.delete(name);
      values.set(name, x);
      return x;
    }
    throw Error(`Unknown value "${name}".`);
  };
  const outputs = template.computed.map((c) => {
    const x = resolve(c.key);
    if (x.n < 0n) throw Error(c.label + ' cannot be negative.');
    return { key: c.key, label: c.label, unit: c.unit, value: canonical(x) };
  });
  const expenses = template.expenses.map((e) => {
    const x = resolve(e.key);
    if (x.n < 0n) throw Error(e.label + ' cannot be negative. Use a discount instead.');
    return { key: e.key, label: e.label, amount: canonical(x) };
  });
  const cost = template.expenses.reduce((sum, e) => add(sum, values.get(e.key)), ZERO);
  const p = template.pricing;
  const r = div(decimal(p.rate), HUNDRED),
    f = div(decimal(p.floor), HUNDRED);
  const markup = p.method === 'markup';
  const raw = round12(markup ? mul(cost, add(ONE, r)) : div(cost, sub(ONE, r)));
  const minimum = round12(markup ? mul(cost, add(ONE, f)) : div(cost, sub(ONE, f)));
  const step = decimal(p.rounding);
  const kobo = mul(toStep(raw, step, true), HUNDRED);
  const amount = Number(kobo.n / kobo.d);
  const minimumKobo = Number(toStep(mul(minimum, HUNDRED), ONE, true).n);
  if (amount > 100000000000) throw Error('Template price exceeds the supported range.');
  // Computed variables linked to stock take their quantity out of a material at checkout.
  const stock = [];
  const choices = [];
  for (const c of template.computed) {
    if (!c.stock) continue;
    const service = c.stock.variable
      ? selected.get(c.stock.variable)
      : ledger.services.find((s) => s.id === c.stock.serviceId && !s.archived);
    if (!service) throw Error(`${c.label}: its stock item is no longer available. Review the template.`);
    if (service.materialId === null) {
      // A choice of materials: nothing is taken now. The job asks which material(s) were used for
      // each such item when it passes the confirmation stage.
      if (!service.materialOptions?.length) continue;
      const x = values.get(c.key);
      const work = Number(floorDiv(2n * x.n * 1000n + x.d, 2n * x.d)) / 1000;
      if (work === 0) continue;
      const entry = choices.find((ch) => ch.serviceId === service.id);
      if (entry) {
        entry.work = Math.round((entry.work + work) * 1000) / 1000;
        continue;
      }
      if (choices.some((ch) => ch.options.some((o) => service.materialOptions.includes(o))))
        throw Error(
          `${service.description} shares a material with another item with a choice of materials in this template. Link each material to one item only.`,
        );
      const first = ledger.materials.find((m) => m.id === service.materialOptions[0]);
      choices.push({
        serviceId: service.id,
        name: service.description,
        options: [...service.materialOptions],
        confirmStage: service.confirmStage ?? 'Printing',
        unit: first?.measurementUnit ?? 'item',
        work,
      });
      continue;
    }
    const material = ledger.materials.find((m) => m.id === service.materialId && !m.archived);
    if (!material) throw Error(`${c.label}: the material for ${service.description} is unavailable.`);
    const x = values.get(c.key);
    const needed = Number(floorDiv(2n * x.n * 1000n + x.d, 2n * x.d)) / 1000;
    if (needed === 0) continue;
    const entry = stock.find((s) => s.materialId === material.id);
    if (entry) entry.quantity = Math.round((entry.quantity + needed) * 1000) / 1000;
    else {
      const stockEventId = stockIds[material.id] ?? crypto.randomUUID();
      if (!uuid.test(stockEventId)) throw Error('Invalid stock identity.');
      stock.push({
        materialId: material.id,
        serviceId: service.id,
        name: material.name,
        unit: material.measurementUnit,
        quantity: needed,
        stockEventId,
        stockCountEventId: stockCountOf(ledger, material.id),
      });
    }
  }
  if (stock.some((s) => s.quantity > 1000000000000) || choices.some((ch) => ch.work > 1000000000000))
    throw Error('Material usage is outside the supported range.');
  return {
    template,
    inputs,
    references: [...used.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    outputs,
    expenses,
    price: { cost: canonical(cost), raw: canonical(raw), amount, minimum: minimumKobo },
    stock,
    ...(choices.length ? { choices } : {}),
  };
}

/** Find an active template for a line, or the snapshot's own template when replaying history. */
function lineTemplate(ledger, line) {
  const pricing = ledger.pricing;
  const raw = pricing
    ? pricing.templates.find((t) => t.id === line.serviceId && !t.archived)
    : line.templateSnapshot?.template;
  if (!raw || (pricing && !pricing.enabled))
    throw Error('This pricing template is unavailable. Review the line.');
  return validateTemplate(raw);
}
/** Template line fields for checkout and quotations. */
export function quoteTemplate(ledger, line) {
  const template = lineTemplate(ledger, line);
  const stockIds =
    line.templateStockIds ??
    Object.fromEntries((line.templateSnapshot?.stock ?? []).map((s) => [s.materialId, s.stockEventId]));
  const snapshot = priceTemplate(
    ledger,
    template,
    line.templateInputs ?? line.templateSnapshot?.inputs ?? {},
    line.quantity,
    stockIds,
  );
  const amount = snapshot.price.amount;
  const qUnits = BigInt(Math.round(Number(line.quantity) * 1000));
  return {
    amount,
    service: template.name,
    serviceVersion: template.version,
    unitPrice: Number((BigInt(amount) * 1000n + qUnits / 2n) / qUnits),
    materialId: null,
    materialNeeded: 0,
    requireSize: false,
    measurementUnit: 'item',
    width: null,
    height: null,
    templateInputs: snapshot.inputs,
    templateSnapshot: snapshot,
    // The job confirms its material(s) in production, like a choice-of-materials item sold alone.
    ...(snapshot.choices ? { materialChoice: templateMaterialChoice(snapshot.choices) } : {}),
  };
}
/**
 * The materialChoice of a template job. One choice item: as for the item sold alone. Several:
 * every linked material, the first item's confirmation stage, and one group per item, each
 * confirmed separately. The server builds the same (apply_checkout_event).
 */
export function templateMaterialChoice(choices) {
  const [first] = choices;
  if (choices.length === 1)
    return { options: first.options, confirmStage: first.confirmStage, work: first.work };
  return {
    options: choices.flatMap((c) => c.options),
    confirmStage: first.confirmStage,
    work: Math.round(choices.reduce((n, c) => n + c.work * 1000, 0)) / 1000,
    groups: choices.map((c) => ({ name: c.name, options: c.options, unit: c.unit, work: c.work })),
  };
}
/** The deepest discount (%) the minimum profit allows, rounded down to 2 places (Costora). */
export function policyDiscountLimit(p) {
  const rate = p.rate / 100,
    floor = p.floor / 100;
  if (floor >= rate) return 0;
  const keep = p.method === 'markup' ? (1 + floor) / (1 + rate) : (1 - rate) / (1 - floor);
  return Math.floor((1 - keep) * 10000 + 1e-9) / 100;
}
/** The discount staff can actually give: the lower of the maximum and the minimum-profit limit. */
export const discountCeiling = (p) => Math.min(p.maxDiscount, policyDiscountLimit(p));
/** After discounts: a template job may not go below its minimum price or past its maximum discount. */
export function checkTemplateDiscount(job) {
  const s = job.templateSnapshot;
  if (!s) return;
  const gross = s.price.amount;
  const off = gross - job.amount;
  if (off > Math.ceil((gross * s.template.pricing.maxDiscount) / 100))
    throw Error(
      `${job.description}: the most discount allowed on ${s.template.name} is ${s.template.pricing.maxDiscount}%.`,
    );
  if (job.amount < s.price.minimum)
    throw Error(
      `${job.description}: this discount takes ${s.template.name} below its minimum ${s.template.pricing.floor}% ${s.template.pricing.method}. Reduce the discount.`,
    );
}

// ---------------------------------------------------------------- display helpers

export const templateDefaults = (t) =>
  Object.fromEntries(t.variables.filter((v) => v.key !== 'quantity').map((v) => [v.key, v.default]));
/** How a variable's value reads: its option label, Yes/No, or the number with its unit. */
export function valueLabel(v, value) {
  if (!v) return String(value);
  const n = Number(value);
  const option = v.options?.find((o) => o.value === n);
  if (option) return option.label;
  if (v.kind === 'yesno') return n ? 'Yes' : 'No';
  return `${n.toLocaleString('en-NG', { maximumFractionDigits: 6 })}${v.unit ? ' ' + v.unit : ''}`;
}
/** Customer-safe details: only variables marked to show on the client quote. Never costs. */
export function clientSpecs(snapshot, quantity) {
  return [
    ...snapshot.template.variables
      .filter((v) => v.clientVisible !== false)
      .map((v) => ({
        label: v.label,
        value: valueLabel(v, v.key === 'quantity' ? quantity : snapshot.inputs[v.key]),
      })),
    ...computedSpecs(snapshot.template, snapshot.outputs, true),
  ];
}
/** Computed values as label and value; only the client-visible ones when `clientOnly`. */
export function computedSpecs(template, outputs = [], clientOnly = false) {
  return template.computed
    .filter((c) => !clientOnly || c.clientVisible === true)
    .map((c) => {
      const o = outputs.find((x) => x.key === c.key);
      return o
        ? {
            label: c.label,
            value: `${Number(o.value).toLocaleString('en-NG', { maximumFractionDigits: 6 })} ${c.unit}`,
          }
        : null;
    })
    .filter(Boolean);
}
/** Whether this rank may see template costs and profit. Developers always can. */
export const canSeeTemplateCosts = (pricing, rank) =>
  rank >= 4 || (pricing?.auditRanks ?? [2, 3]).includes(rank);
/** A snapshot's value for a name (for showing formulas with their numbers). */
export function snapshotValue(snapshot, quantity, name) {
  if (name === 'quantity') return String(quantity);
  if (name in snapshot.inputs) return String(snapshot.inputs[name]);
  const found =
    snapshot.outputs.find((o) => o.key === name)?.value ??
    snapshot.expenses.find((e) => e.key === name)?.amount ??
    snapshot.references.find((r) => r.key === name)?.rate;
  if (found !== undefined) return found;
  if (name.endsWith('_rate')) {
    const v = snapshot.template.variables.find((x) => x.key === name.slice(0, -5) && x.kind === 'material');
    const option = v?.options?.find((o) => o.value === snapshot.inputs[v.key]);
    const ref = snapshot.references.find((r) => r.serviceId === option?.serviceId);
    if (ref) return ref.rate;
  }
  return name;
}
export const explainFormula = (formula, valueOf) =>
  formula.replace(/\b[a-z][a-z0-9_]*\b/g, (name) => valueOf(name));

/** Every combination of the chosen values (at most 100), for comparing options. */
export function scenarioInputs(template, base, vary) {
  let count = 1;
  const lists = Object.entries(vary).map(([key, items]) => {
    if (!template.variables.some((v) => v.key === key)) throw Error('Choose a variable from this template.');
    const unique = [
      ...new Set(
        items
          .map((x) => String(x).trim())
          .filter(Boolean)
          .map((x) => canonical(x)),
      ),
    ];
    if (!unique.length) throw Error('Enter at least one value for each option set.');
    count *= unique.length;
    if (count > 100) throw Error('Compare at most 100 combinations.');
    return [key, unique];
  });
  return lists.reduce(
    (rows, [key, items]) => rows.flatMap((row) => items.map((value) => ({ ...row, [key]: Number(value) }))),
    [{ ...base }],
  );
}
/** Group rows by a key, keeping the order they were asked for. */
export function groupRows(rows, keyFor) {
  if (!keyFor) return [{ key: '', rows }];
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, rows]) => ({ key, rows }));
}

/** A blank template: quantity and one expense. */
export function newTemplate() {
  return {
    id: crypto.randomUUID(),
    version: 1,
    archived: false,
    name: '',
    category: '',
    description: '',
    variables: [
      {
        key: 'quantity',
        label: 'Quantity',
        kind: 'number',
        unit: 'items',
        default: 1,
        min: 1,
        max: 100000,
        integer: true,
        clientVisible: true,
      },
    ],
    computed: [],
    expenses: [
      {
        key: 'expense_1',
        label: 'Production',
        formula: 'quantity * (100)',
        calculation: { method: 'perItem', rate: '100', input: 'quantity', capacity: '25' },
      },
    ],
    pricing: { method: 'markup', rate: 30, floor: 20, maxDiscount: 5, rounding: 100 },
  };
}
/** Warnings for a template against today's costs, by trying its default values. */
export function templateProblem(ledger, template) {
  try {
    const t = validateTemplate(template);
    const q = t.variables.find((v) => v.key === 'quantity').default;
    priceTemplate(ledger, t, templateDefaults(t), q);
    return '';
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'This template cannot be priced.';
  }
}

/** Receipt and quotation lines: the client-visible details other than quantity, e.g. "Inner paper: 80 gsm". */
export const templateSpecLines = (job) =>
  job?.templateSnapshot
    ? job.templateSnapshot.template.variables
        .filter((v) => v.clientVisible !== false && v.key !== 'quantity')
        .map((v) => `${v.label}: ${valueLabel(v, job.templateSnapshot.inputs[v.key])}`)
        .concat(
          computedSpecs(job.templateSnapshot.template, job.templateSnapshot.outputs, true).map(
            (s) => `${s.label}: ${s.value}`,
          ),
        )
    : [];
