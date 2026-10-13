// Selling-price bundles. Formula evaluation is a small arithmetic grammar, never JavaScript/eval.
/** @returns {import('./types').PricingSettings} */
export const pricingDefaults = () => ({ enabled: false, templates: [] });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const functions = { ceil: Math.ceil, floor: Math.floor, round: Math.round, min: Math.min, max: Math.max };
export function parseFormula(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 200)
    throw Error('Enter a formula up to 200 characters.');
  const tokens = text.match(/\d+(?:\.\d+)?|[a-zA-Z][a-zA-Z0-9_]*|[()+*/,-]|\S/g) ?? [];
  let at = 0,
    nodes = 0;
  const node = (op, args) => {
    if (++nodes > 80) throw Error('Formula is too complex.');
    return { op, args };
  };
  function atom(depth) {
    if (depth > 12) throw Error('Formula is nested too deeply.');
    const t = tokens[at++];
    if (t === '-') return node('*', [node('number', [-1]), atom(depth + 1)]);
    if (t === '(') {
      const n = expression(depth + 1);
      if (tokens[at++] !== ')') throw Error('Close the formula bracket.');
      return n;
    }
    if (/^\d+(\.\d+)?$/.test(t ?? '')) {
      if ((t.split('.')[1]?.length ?? 0) > 12)
        throw Error('Formula numbers allow up to twelve decimal places.');
      const n = Number(t);
      if (!Number.isFinite(n) || n > 1000000000000) throw Error('Formula number is too large.');
      return node('number', [n]);
    }
    if (!keyPattern.test(t ?? ''))
      throw Error('Use numbers, variables, arithmetic and ceil/floor/round/min/max.');
    if (tokens[at] !== '(') return node('variable', [t]);
    if (!Object.hasOwn(functions, t)) throw Error('Unknown formula function: ' + t);
    at++;
    const args = [expression(depth + 1)];
    while (tokens[at] === ',') {
      at++;
      args.push(expression(depth + 1));
    }
    if (tokens[at++] !== ')' || args.length !== (['min', 'max'].includes(t) ? 2 : 1))
      throw Error('Check the function brackets and arguments.');
    return node(t, args);
  }
  function product(depth) {
    let a = atom(depth);
    while (['*', '/'].includes(tokens[at])) {
      const op = tokens[at++];
      a = node(op, [a, atom(depth)]);
    }
    return a;
  }
  function expression(depth) {
    let a = product(depth);
    while (['+', '-'].includes(tokens[at])) {
      const op = tokens[at++];
      a = node(op, [a, product(depth)]);
    }
    return a;
  }
  const result = expression(0);
  if (at !== tokens.length) throw Error('Check the formula near ' + tokens[at] + '.');
  return result;
}
// Decimal arithmetic is rounded to 12 places after each operation on both client and server.
// Keep the fraction until the final quantity rounding, avoiding binary half-cent/half-unit drift.
const scale = 1000000000000n;
const decimal = (value) => {
  if (value && typeof value === 'object' && 'n' in value) return value;
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  let n = BigInt(whole + fraction),
    d = 10n ** BigInt(fraction.length);
  const e = Number(exponent);
  if (e >= 0) n *= 10n ** BigInt(e);
  else d *= 10n ** BigInt(-e);
  return { n, d };
};
const floorDivide = (n, d) => (n >= 0n ? n / d : -((-n + d - 1n) / d));
const rounded = (r, s) => floorDivide(2n * r.n * s + r.d, 2n * r.d);
function exactFormula(expression, resolve, depth = 0) {
  if (depth > 80) throw Error('Formula is too complex.');
  const { op, args } = expression;
  if (op === 'number') return decimal(args[0]);
  if (op === 'variable') return decimal(resolve(args[0]));
  const v = args.map((a) => exactFormula(a, resolve, depth + 1));
  const a = v[0],
    b = v[1];
  let result;
  switch (op) {
    case '+':
      result = { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
      break;
    case '-':
      result = { n: a.n * b.d - b.n * a.d, d: a.d * b.d };
      break;
    case '*':
      result = { n: a.n * b.n, d: a.d * b.d };
      break;
    case '/':
      if (!b.n) throw Error('A formula divides by zero.');
      result = { n: a.n * b.d, d: a.d * b.n };
      if (result.d < 0n) {
        result.n = -result.n;
        result.d = -result.d;
      }
      break;
    case 'ceil':
      result = { n: -floorDivide(-a.n, a.d), d: 1n };
      break;
    case 'floor':
      result = { n: floorDivide(a.n, a.d), d: 1n };
      break;
    case 'round':
      result = { n: rounded(a, 1n), d: 1n };
      break;
    case 'min':
      result = a.n * b.d <= b.n * a.d ? a : b;
      break;
    case 'max':
      result = a.n * b.d >= b.n * a.d ? a : b;
      break;
    default:
      throw Error('Unsupported formula.');
  }
  if (result.n > 1000000000000n * result.d || result.n < -1000000000000n * result.d)
    throw Error('Formula result is outside the supported range.');
  return { n: rounded(result, scale), d: scale };
}
export function evaluateFormula(expression, resolve) {
  const r = exactFormula(expression, resolve);
  return Number(r.n) / Number(r.d);
}
const formulaUnits = (expression, resolve) =>
  Number(rounded(exactFormula(expression, resolve), 1000n)) / 1000;

const numeric = (v, label, min = 0, max = 1000000) => {
  if (
    v === '' ||
    v === null ||
    typeof v === 'boolean' ||
    !Number.isFinite(Number(v)) ||
    Number(v) < min ||
    Number(v) > max ||
    Math.round(Number(v) * 1000) / 1000 !== Number(v)
  )
    throw Error(label + ' must be a number in range, with up to three decimal places.');
  return Number(v);
};
const text = (v, label, max = 80) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error('Enter ' + label + '.');
  return v.trim();
};
export function validatePricingSettings(input = pricingDefaults()) {
  if (
    !input ||
    typeof input.enabled !== 'boolean' ||
    !Array.isArray(input.templates) ||
    input.templates.length > 30
  )
    throw Error('Pricing needs a switch and at most 30 templates.');
  const ids = new Set();
  const templates = input.templates.map((t) => {
    if (
      !uuid.test(t.id) ||
      ids.has(t.id) ||
      !Number.isSafeInteger(t.version) ||
      t.version < 1 ||
      typeof t.archived !== 'boolean'
    )
      throw Error('Invalid template identity or version.');
    ids.add(t.id);
    if (
      !Array.isArray(t.inputs) ||
      t.inputs.length > 20 ||
      !Array.isArray(t.derived) ||
      t.derived.length > 20 ||
      !Array.isArray(t.components) ||
      t.components.length < 1 ||
      t.components.length > 20
    )
      throw Error('Use at most 20 inputs, calculations and components. Add at least one component.');
    const keys = new Set(['quantity']);
    const named = (key) => {
      if (!keyPattern.test(key) || keys.has(key) || Object.hasOwn(functions, key))
        throw Error('Use a unique variable name; quantity is reserved.');
      keys.add(key);
      return key;
    };
    const inputs = t.inputs.map((i) => {
      const key = named(i.key),
        label = text(i.label, 'an input label');
      const min = numeric(i.min, label + ' minimum'),
        max = numeric(i.max, label + ' maximum', min);
      const value = numeric(i.default, label + ' default', min, max);
      if (!['number', 'choice'].includes(i.kind)) throw Error('Choose number or options for each input.');
      const options =
        i.kind === 'choice'
          ? (i.options ?? []).map((o) => ({
              label: text(o.label, 'an option label'),
              value: numeric(o.value, label, min, max),
            }))
          : [];
      if (
        i.kind === 'choice' &&
        (!options.length ||
          options.length > 20 ||
          !options.some((o) => o.value === value) ||
          new Set(options.map((o) => o.value)).size !== options.length)
      )
        throw Error('Add unique numeric options and choose one as the default.');
      return { key, label, kind: i.kind, min, max, default: value, options };
    });
    const derived = t.derived.map((d) => ({
      key: named(d.key),
      label: text(d.label, 'a calculation label'),
      formula: d.formula,
      expression: parseFormula(d.formula),
    }));
    const componentIds = new Set();
    const components = t.components.map((c) => {
      if (!uuid.test(c.id) || componentIds.has(c.id) || !uuid.test(c.serviceId))
        throw Error('Choose an item or service for every component.');
      componentIds.add(c.id);
      const out = {
        id: c.id,
        label: text(c.label, 'a component label'),
        serviceId: c.serviceId,
        quantityFormula: c.quantityFormula,
        quantityExpression: parseFormula(c.quantityFormula),
      };
      for (const dimension of ['width', 'height'])
        if (c[dimension + 'Formula']) {
          out[dimension + 'Formula'] = c[dimension + 'Formula'];
          out[dimension + 'Expression'] = parseFormula(c[dimension + 'Formula']);
        }
      return out;
    });
    const check = (n) => {
      if (n.op === 'variable' && !keys.has(n.args[0])) throw Error('Unknown variable: ' + n.args[0]);
      if (!['number', 'variable'].includes(n.op)) n.args.forEach(check);
    };
    derived.forEach((d) => check(d.expression));
    components.forEach((c) => {
      check(c.quantityExpression);
      if (c.widthExpression) check(c.widthExpression);
      if (c.heightExpression) check(c.heightExpression);
    });
    const template = {
      id: t.id,
      name: text(t.name, 'a template name', 160),
      version: t.version,
      archived: t.archived,
      inputs,
      derived,
      components,
    };
    templateValues(template, {}, 1); // Resolve every derived variable to detect cycles/default division by zero.
    return template;
  });
  return { enabled: input.enabled, templates };
}
export function templateValues(template, supplied, quantity) {
  const values = Object.create(null),
    visiting = new Set();
  values.quantity = numeric(quantity, 'Quantity', 0.001);
  const inputs = {};
  for (const i of template.inputs) {
    const value = numeric(supplied?.[i.key] ?? i.default, i.label, i.min, i.max);
    if (i.kind === 'choice' && !i.options.some((o) => o.value === value))
      throw Error('Choose a valid ' + i.label + '.');
    values[i.key] = inputs[i.key] = value;
  }
  if (Object.keys(supplied ?? {}).some((key) => !template.inputs.some((i) => i.key === key)))
    throw Error('Template inputs changed. Review the job.');
  const resolve = (key) => {
    if (Object.hasOwn(values, key)) return values[key];
    const d = template.derived.find((d) => d.key === key);
    if (!d) throw Error('Unknown variable: ' + key);
    if (visiting.has(key)) throw Error('Circular calculation: ' + key);
    visiting.add(key);
    values[key] = exactFormula(d.expression, resolve);
    visiting.delete(key);
    return values[key];
  };
  template.derived.forEach((d) => resolve(d.key));
  return { inputs, values, resolve };
}
/** Template components price through the normal service rules, including size and materialless items. */
export function quoteTemplate(ledger, line, quoteService) {
  const pricing = ledger.pricing;
  const raw = pricing
    ? pricing.templates.find((t) => t.id === line.serviceId && !t.archived)
    : line.templateSnapshot?.template;
  if (!raw || (pricing && !pricing.enabled))
    throw Error('This pricing template is unavailable. Review the job.');
  const template = validatePricingSettings({ enabled: true, templates: [raw] }).templates[0];
  const { inputs, resolve } = templateValues(
    template,
    line.templateInputs ?? line.templateSnapshot?.inputs ?? {},
    line.quantity,
  );
  const components = template.components.map((c) => {
    if (c.serviceId === template.id || ledger.pricing?.templates.some((t) => t.id === c.serviceId))
      throw Error('Choose catalogue items or services as components; nested templates are not supported.');
    const roundUnits = (expression, min = 0.001) => {
      const n = formulaUnits(expression, resolve);
      return numeric(n, c.label, min);
    };
    const quantity = roundUnits(c.quantityExpression, 0);
    const q = quoteService(ledger, {
      serviceId: c.serviceId,
      description: c.label,
      quantity: quantity || 1,
      width: c.widthExpression ? roundUnits(c.widthExpression) : '',
      height: c.heightExpression ? roundUnits(c.heightExpression) : '',
      source: 'Template',
      sourceNote: '',
    });
    if (quantity === 0) {
      q.quantity = 0;
      q.amount = 0;
      q.materialNeeded = 0;
    }
    const stockEventId =
      line.templateStockIds?.[c.id] ??
      line.templateSnapshot?.components.find((s) => s.id === c.id)?.stockEventId ??
      crypto.randomUUID();
    if (!uuid.test(stockEventId)) throw Error('Invalid component stock identity.');
    return {
      id: c.id,
      label: c.label,
      stockEventId,
      serviceId: c.serviceId,
      service: q.service,
      serviceVersion: q.serviceVersion,
      unitPrice: q.unitPrice,
      quantity: q.quantity,
      width: q.width,
      height: q.height,
      amount: q.amount,
      materialId: q.materialId,
      materialNeeded: q.materialNeeded,
      requireSize: q.requireSize,
      measurementUnit: q.measurementUnit,
      stockCountEventId: q.stockCountEventId,
    };
  });
  const amount = components.reduce((n, c) => n + c.amount, 0);
  if (!Number.isSafeInteger(amount) || amount > 100000000000)
    throw Error('Template price exceeds the supported range.');
  const qUnits = BigInt(Math.round(Number(line.quantity) * 1000));
  const unitPrice = Number((BigInt(amount) * 1000n + qUnits / 2n) / qUnits);
  if (unitPrice > 100000000000) throw Error('Template price per item exceeds the supported range.');
  return {
    amount,
    service: template.name,
    serviceVersion: template.version,
    unitPrice,
    materialId: null,
    materialNeeded: 0,
    requireSize: false,
    measurementUnit: 'item',
    width: null,
    height: null,
    templateInputs: inputs,
    templateSnapshot: { template, inputs, components },
  };
}
export const templateDefaults = (t) => Object.fromEntries(t.inputs.map((i) => [i.key, i.default]));
export function bookTemplate() {
  return {
    id: crypto.randomUUID(),
    version: 1,
    archived: false,
    name: 'Book',
    inputs: [
      {
        key: 'pages',
        label: 'Pages per book',
        kind: 'number',
        min: 1,
        max: 1000000,
        default: 40,
        options: [],
      },
      {
        key: 'pagesPerSheet',
        label: 'Pages per paper sheet (including both sides)',
        kind: 'number',
        min: 1,
        max: 1000,
        default: 4,
        options: [],
      },
      {
        key: 'coversPerCard',
        label: 'Complete book covers per card',
        kind: 'number',
        min: 0.001,
        max: 1000,
        default: 1,
        options: [],
      },
    ],
    derived: [
      { key: 'cards', label: 'Cover cards', formula: 'ceil(quantity / coversPerCard)' },
      { key: 'sheets', label: 'Inner paper sheets', formula: 'quantity * ceil(pages / pagesPerSheet)' },
    ],
    components: [
      { id: crypto.randomUUID(), label: 'Cover cards', serviceId: '', quantityFormula: 'cards' },
      { id: crypto.randomUUID(), label: 'Cover printing', serviceId: '', quantityFormula: 'cards' },
      { id: crypto.randomUUID(), label: 'Inner paper printing', serviceId: '', quantityFormula: 'sheets' },
      { id: crypto.randomUUID(), label: 'Binding', serviceId: '', quantityFormula: 'quantity' },
    ],
  };
}
