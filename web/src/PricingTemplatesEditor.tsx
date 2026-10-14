import { useRef, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { TemplateAudit } from './TemplateFields';
import {
  consumptionUnit,
  costRate,
  hasCost,
  canonical,
  expenseControls,
  formulaFromControls,
  formulaFunctions,
  keyPattern,
  parseFormula,
  policyDiscountLimit,
  priceTemplate,
  roundingChoices,
  templateDefaults,
  validateTemplate,
} from './pricing-templates.mjs';
import { currency } from './receipts.mjs';
import type {
  ExpenseCalculation,
  Ledger,
  PricingTemplate,
  Service,
  TemplateComputed,
  TemplateExpense,
  TemplateVariable,
} from './types';
import { useWords } from './Words';

type Draft = Omit<PricingTemplate, 'variables' | 'computed' | 'expenses'> & {
  variables: (Omit<TemplateVariable, 'default' | 'min' | 'max'> & {
    default: number | string;
    min: number | string;
    max: number | string;
  })[];
  computed: TemplateComputed[];
  expenses: TemplateExpense[];
};
const tabs = ['Details & variables', 'Computed variables', 'Expenses', 'Pricing & preview'] as const;
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
const kindLabels: Record<TemplateVariable['kind'], string> = {
  number: 'Number',
  options: 'Named options',
  material: 'Choice of items',
  yesno: 'Yes / No',
};
const methodLabels: Record<string, string> = {
  fixed: 'Fixed per order',
  perItem: 'Per item',
  perInput: 'Per variable unit × quantity',
  orderInput: 'Order-level variable (no quantity multiplier)',
  batch: 'Per batch',
  custom: 'Custom formula',
};

/** Numbers typed in the editor stay text until saved. */
function toTemplate(d: Draft): PricingTemplate {
  return {
    ...d,
    variables: d.variables.map((v) => ({
      ...v,
      default: Number(v.default),
      min: Number(v.min),
      max: Number(v.max),
      ...(v.options ? { options: v.options.map((o) => ({ ...o, value: Number(o.value) })) } : {}),
    })),
    pricing: {
      ...d.pricing,
      rate: Number(d.pricing.rate),
      floor: Number(d.pricing.floor),
      maxDiscount: Number(d.pricing.maxDiscount),
      rounding: Number(d.pricing.rounding),
    },
  };
}

/** Insert pickers and method controls for one formula (Costora's formula editor). */
function FormulaEditor({
  label,
  value,
  calculation,
  customOnly = false,
  draft,
  costs,
  exclude,
  onChange,
}: {
  label: string;
  value: string;
  calculation?: ExpenseCalculation;
  customOnly?: boolean;
  draft: Draft;
  costs: Service[];
  /** This formula's own name, so it is not offered to itself. */
  exclude: string;
  onChange: (formula: string, calculation?: ExpenseCalculation) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef({ start: value.length, end: value.length });
  const variableKeys = draft.variables.map((v) => v.key);
  const inferred = expenseControls(value, variableKeys);
  const c: ExpenseCalculation = customOnly ? { ...inferred, method: 'custom' } : (calculation ?? inferred);
  const custom = c.method === 'custom';
  const rates = [
    ...costs
      .filter((s) => hasCost(s.costing))
      .map((s) => [s.costing!.key, `${s.description} · cost · ${s.costing!.key}`]),
    ...costs
      .filter((s) => !s.private)
      .map((s) => [`${s.costing!.key}_price`, `${s.description} · selling price · ${s.costing!.key}_price`]),
    ...draft.variables
      .filter((v) => v.kind === 'material')
      .map((v) => [v.key + '_rate', `${v.label} · selected item's cost (${v.key}_rate)`]),
  ];
  const rateSource = rates.find(([key]) => key === c.rate.trim())?.[0] ?? '';
  let syntax = '';
  try {
    parseFormula(value);
  } catch (cause) {
    syntax = cause instanceof Error ? cause.message : String(cause);
  }
  function update(patch: Partial<ExpenseCalculation>) {
    const next = { ...c, ...patch };
    if (next.method === 'perInput' && (!next.input || next.input === 'quantity'))
      next.input = variableKeys.find((k) => k !== 'quantity') ?? '';
    if (next.method === 'custom') return onChange(value, next);
    try {
      onChange(formulaFromControls(next), next);
    } catch {
      onChange(value, next);
    }
  }
  const direct = (text: string) => onChange(text, customOnly ? undefined : { ...c, method: 'custom' });
  const remember = () => {
    if (box.current) caret.current = { start: box.current.selectionStart, end: box.current.selectionEnd };
  };
  function insert(token: string) {
    if (!token) return;
    const start = Math.min(caret.current.start, value.length),
      end = Math.min(caret.current.end, value.length),
      selected = value.slice(start, end);
    const text = ['CEILING', 'FLOOR', 'ABS', 'SUM'].includes(token)
      ? `${token}(${selected || '0'})`
      : ['MIN', 'MAX', 'ROUNDUP', 'ROUND'].includes(token)
        ? `${token}(${selected || '0'}, 0)`
        : token === 'IF'
          ? `IF(${selected || 'quantity > 0'}, 0, 0)`
          : token;
    const next = value.slice(0, start) + text + value.slice(end);
    direct(next);
    const pos = start + text.length;
    caret.current = { start: pos, end: pos };
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  }
  const names = [
    ['Editable variables', draft.variables.map((v) => [v.key, `${v.label} · ${v.key}`])],
    [
      'Computed variables',
      draft.computed.filter((x) => x.key !== exclude).map((x) => [x.key, `${x.label} · ${x.key}`]),
    ],
    ['Costs', rates],
  ] as const;
  return (
    <div className="formula-field">
      {!customOnly && (
        <div className="form-grid">
          <label>
            Calculation method
            <select
              aria-label="Calculation method"
              value={c.method}
              onChange={(e) => update({ method: e.target.value })}
            >
              {Object.entries(methodLabels).map(([key, text]) => (
                <option key={key} value={key} disabled={key === 'perInput' && variableKeys.length < 2}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          {!custom && (
            <label>
              Rate source
              <select
                aria-label="Rate source"
                value={rateSource}
                onChange={(e) => update({ rate: e.target.value || '0' })}
              >
                <option value="">Enter a value</option>
                {rates.map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!custom && !rateSource && (
            <label>
              Rate / value (₦)
              <input
                aria-label="Rate / value"
                value={c.rate}
                onChange={(e) => update({ rate: e.target.value })}
              />
            </label>
          )}
          {!custom && (c.method === 'perInput' || c.method === 'orderInput') && (
            <label>
              Variable
              <select
                aria-label="Expense variable"
                value={c.input}
                onChange={(e) => update({ input: e.target.value })}
              >
                {(c.method === 'perInput'
                  ? draft.variables.filter((v) => v.key !== 'quantity').map((v) => [v.key, v.label])
                  : [
                      ...draft.variables.map((v) => [v.key, v.label]),
                      ...draft.computed.map((x) => [x.key, x.label]),
                    ]
                ).map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!custom && c.method === 'batch' && (
            <label>
              Batch size
              <input
                aria-label="Batch size"
                value={c.capacity}
                onChange={(e) => update({ capacity: e.target.value })}
              />
            </label>
          )}
        </div>
      )}
      {!custom && (
        <small>
          {c.method === 'perInput'
            ? 'Rate × the chosen variable × quantity.'
            : c.method === 'orderInput'
              ? 'Rate × an order-level value. Quantity is not multiplied again.'
              : c.method === 'batch'
                ? 'Rate × the number of batches needed for the quantity.'
                : 'Changes update the formula automatically.'}
        </small>
      )}
      {custom && (
        <div className="formula-tokens">
          <select aria-label="Insert value" value="" onChange={(e) => insert(e.target.value)}>
            <option value="">Insert value…</option>
            {names.map(([group, items]) =>
              items.length ? (
                <optgroup key={group} label={group}>
                  {items.map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
          <select aria-label="Operator" value="" onChange={(e) => insert(e.target.value)}>
            <option value="">Operator…</option>
            <optgroup label="Arithmetic">
              <option value=" + ">+ Add</option>
              <option value=" - ">− Subtract</option>
              <option value=" * ">× Multiply</option>
              <option value=" / ">÷ Divide</option>
              <option value="(">( Open bracket</option>
              <option value=")">) Close bracket</option>
            </optgroup>
            <optgroup label="Comparison">
              <option value=" > ">&gt; Greater than</option>
              <option value=" < ">&lt; Less than</option>
              <option value=" >= ">≥ At least</option>
              <option value=" <= ">≤ At most</option>
              <option value=" == ">= Equals</option>
              <option value=" != ">≠ Not equal</option>
            </optgroup>
          </select>
          <select aria-label="Function" value="" onChange={(e) => insert(e.target.value)}>
            <option value="">Function…</option>
            {[
              ['CEILING', 'CEILING · Round up (to a step)'],
              ['FLOOR', 'FLOOR · Round down (to a step)'],
              ['ROUNDUP', 'ROUNDUP · Up to decimal places'],
              ['ROUND', 'ROUND · To decimal places'],
              ['SUM', 'SUM · Add values'],
              ['MIN', 'MIN · Smallest value'],
              ['MAX', 'MAX · Largest value'],
              ['ABS', 'ABS · Without sign'],
              ['IF', 'IF · condition, then, otherwise'],
            ]
              .filter(([f]) => f in formulaFunctions)
              .map(([f, text]) => (
                <option key={f} value={f}>
                  {text}
                </option>
              ))}
          </select>
        </div>
      )}
      <label>
        {label}
        {custom ? ' · edit directly' : ' · generated'}
        <textarea
          ref={box}
          rows={2}
          readOnly={!custom}
          className="formula-input"
          aria-label={label}
          aria-invalid={!!syntax}
          spellCheck={false}
          value={value}
          onSelect={remember}
          onBlur={remember}
          onChange={(e) => {
            direct(e.target.value);
            caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
          }}
        />
        {syntax ? (
          <small className="danger-text" role="status">
            {syntax}
          </small>
        ) : (
          <small>
            {custom ? 'Type, or insert values at the cursor.' : 'Choose Custom formula to edit it directly.'}
          </small>
        )}
      </label>
    </div>
  );
}

/** A name field that renames the name in every formula when you leave it. */
function KeyField({
  value,
  disabled,
  onChange,
  onRename,
}: {
  value: string;
  disabled?: boolean;
  onChange: (key: string) => void;
  onRename: (from: string, to: string) => void;
}) {
  const start = useRef(value);
  return (
    <label>
      Name in formulas
      <input
        value={value}
        disabled={disabled}
        spellCheck={false}
        onFocus={() => {
          start.current = value;
        }}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
        onBlur={() => {
          if (start.current !== value && keyPattern.test(value)) onRename(start.current, value);
        }}
      />
      {!keyPattern.test(value) && (
        <small className="danger-text">Lowercase letters, numbers and _ only.</small>
      )}
    </label>
  );
}

export default function TemplateEditor({
  initial,
  ledger,
  busy,
  onClose,
  onSave,
}: {
  initial: PricingTemplate;
  ledger: Ledger;
  busy: boolean;
  onClose: () => void;
  onSave: (template: PricingTemplate) => Promise<void>;
}) {
  const { w } = useWords();
  const [d, setD] = useState<Draft>(() => structuredClone(initial) as Draft);
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const step = tabs.indexOf(tab);
  const actions = useRef<HTMLDivElement>(null);
  /** Move to another section and show it from the top. */
  const go = (n: number) => {
    setTab(tabs[n]);
    requestAnimationFrame(() => actions.current?.closest('dialog')?.scrollTo({ top: 0 }));
  };
  const [error, setError] = useState('');
  const costs = ledger.services.filter((s) => !s.archived && s.costing);
  const stockItems = ledger.services.filter((s) => !s.archived && s.materialId);
  const change = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  // New names avoid the template's own names and every cost's formula name.
  const used = () =>
    new Set(
      [...d.variables, ...d.computed, ...d.expenses]
        .map((x) => x.key)
        .concat(costs.map((s) => s.costing!.key)),
    );
  const unique = (base: string) => {
    const taken = used();
    let key = base || 'value',
      n = 2;
    while (taken.has(key)) key = `${base}_${n++}`;
    return key;
  };
  const setVariable = (i: number, patch: Partial<Draft['variables'][number]>) =>
    change({ variables: d.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const setComputed = (i: number, patch: Partial<TemplateComputed>) =>
    change({ computed: d.computed.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const setExpense = (i: number, patch: Partial<TemplateExpense>) =>
    change({ expenses: d.expenses.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  function rename(from: string, to: string) {
    if (!from || from === to) return;
    const word = new RegExp(`\\b${from}(_rate)?\\b`, 'g');
    const swap = (text: string) => text.replace(word, (_m, rate) => to + (rate ?? ''));
    setD((x) => ({
      ...x,
      computed: x.computed.map((c) => ({
        ...c,
        formula: swap(c.formula),
        stock: c.stock && 'variable' in c.stock && c.stock.variable === from ? { variable: to } : c.stock,
      })),
      expenses: x.expenses.map((e) => ({
        ...e,
        formula: swap(e.formula),
        ...(e.calculation
          ? {
              calculation: {
                ...e.calculation,
                rate: swap(e.calculation.rate),
                input: e.calculation.input === from ? to : e.calculation.input,
              },
            }
          : {}),
      })),
    }));
  }
  // Label changes carry the formula name along while it still matches the old label.
  const relabel = (key: string, oldLabel: string, label: string) =>
    key === slug(oldLabel) || /^(variable|computed|expense)_\d+$/.test(key) ? unique(slug(label)) : key;
  let preview: ReturnType<typeof priceTemplate> | null = null,
    problem = '';
  let checked: PricingTemplate | null = null;
  try {
    checked = validateTemplate(toTemplate(d)) as PricingTemplate;
    const q = checked.variables.find((v) => v.key === 'quantity')!.default;
    preview = priceTemplate(ledger, checked, templateDefaults(checked), q);
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : String(cause);
  }
  let limit = 0;
  try {
    limit = policyDiscountLimit(toTemplate(d).pricing);
  } catch {
    limit = 0;
  }
  async function save() {
    setError('');
    try {
      if (!checked || problem) throw Error(problem || 'Check the template.');
      await onSave(checked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const p = d.pricing;
  return (
    <Modal
      title={initial.name ? `Edit ${initial.name}` : 'New pricing template'}
      wide
      busy={busy}
      onClose={onClose}
    >
      <p className="muted">
        Define editable and computed variables and expenses, then preview the price. Costs come from{' '}
        {w('services')} with a template cost.
      </p>
      <div className="settings-tabs" role="tablist" aria-label="Template sections">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? 'active' : 'secondary'}
            onClick={() => setTab(name)}
          >
            {name}
            {name === 'Computed variables'
              ? ` (${d.computed.length})`
              : name === 'Expenses'
                ? ` (${d.expenses.length})`
                : ''}
          </button>
        ))}
      </div>
      <fieldset disabled={busy}>
        {tab === 'Details & variables' && (
          <>
            <div className="form-grid">
              <label>
                Template name
                <input
                  value={d.name}
                  maxLength={100}
                  onChange={(e) => change({ name: e.target.value })}
                  required
                />
              </label>
              <label>
                Category
                <input
                  value={d.category}
                  maxLength={50}
                  onChange={(e) => change({ category: e.target.value })}
                />
              </label>
              <label>
                Description
                <input
                  value={d.description}
                  maxLength={200}
                  onChange={(e) => change({ description: e.target.value })}
                />
              </label>
            </div>
            <h4>Editable variables</h4>
            <p className="muted">What staff enter for each order. Quantity is always there.</p>
            {d.variables.map((v, i) => {
              const quantity = v.key === 'quantity';
              const materialUnit = v.options?.length
                ? (() => {
                    const first = costs.find((s) => s.id === v.options![0].serviceId);
                    return first ? consumptionUnit(first, ledger.materials) : '';
                  })()
                : '';
              return (
                <div className="template-section" key={i}>
                  <div className="form-grid">
                    <label>
                      Label
                      <input
                        value={v.label}
                        onChange={(e) =>
                          setVariable(i, {
                            label: e.target.value,
                            ...(quantity ? {} : { key: relabel(v.key, v.label, e.target.value) }),
                          })
                        }
                      />
                    </label>
                    <KeyField
                      value={v.key}
                      disabled={quantity}
                      onChange={(key) => setVariable(i, { key })}
                      onRename={rename}
                    />
                    <label>
                      Variable type
                      <select
                        aria-label="Variable type"
                        value={v.kind}
                        disabled={quantity}
                        onChange={(e) => {
                          const kind = e.target.value as TemplateVariable['kind'];
                          setVariable(
                            i,
                            kind === 'yesno'
                              ? {
                                  kind,
                                  options: undefined,
                                  default: 0,
                                  min: 0,
                                  max: 1,
                                  integer: true,
                                  unit: '',
                                }
                              : kind === 'options'
                                ? {
                                    kind,
                                    options: [
                                      { value: 1, label: 'Option 1' },
                                      { value: 2, label: 'Option 2' },
                                    ],
                                    default: 1,
                                    integer: true,
                                  }
                                : kind === 'material'
                                  ? { kind, options: [], default: 1, integer: true, unit: '' }
                                  : { kind, options: undefined, default: 1, min: 0, max: 10000 },
                          );
                        }}
                      >
                        {Object.entries(kindLabels).map(([key, text]) => (
                          <option key={key} value={key}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(v.kind === 'number' || v.kind === 'options') && (
                      <label>
                        Unit
                        <input
                          value={v.unit}
                          maxLength={40}
                          placeholder="e.g. sheets per book"
                          onChange={(e) => setVariable(i, { unit: e.target.value })}
                        />
                      </label>
                    )}
                    {v.kind === 'number' && (
                      <>
                        <label>
                          Default value
                          <input
                            inputMode="decimal"
                            value={v.default}
                            onChange={(e) => setVariable(i, { default: e.target.value })}
                          />
                        </label>
                        <label>
                          Minimum
                          <input
                            inputMode="decimal"
                            value={v.min}
                            onChange={(e) => setVariable(i, { min: e.target.value })}
                          />
                        </label>
                        <label>
                          Maximum
                          <input
                            inputMode="decimal"
                            value={v.max}
                            onChange={(e) => setVariable(i, { max: e.target.value })}
                          />
                        </label>
                      </>
                    )}
                    {v.kind === 'yesno' && (
                      <label>
                        Default
                        <select
                          aria-label="Default"
                          value={String(v.default)}
                          onChange={(e) => setVariable(i, { default: Number(e.target.value) })}
                        >
                          <option value="0">No</option>
                          <option value="1">Yes</option>
                        </select>
                      </label>
                    )}
                    {(v.kind === 'options' || v.kind === 'material') && (v.options?.length ?? 0) > 0 && (
                      <label>
                        Default
                        <select
                          aria-label="Default"
                          value={String(v.default)}
                          onChange={(e) => setVariable(i, { default: Number(e.target.value) })}
                        >
                          {v.options!.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {v.kind === 'options' && (
                    <div className="template-options">
                      <p className="muted">
                        The number is used in formulas; the label is shown to staff and on quotes.
                      </p>
                      {v.options!.map((o, j) => (
                        <div className="form-grid" key={j}>
                          <label>
                            Value
                            <input
                              inputMode="decimal"
                              value={o.value}
                              onChange={(e) =>
                                setVariable(i, {
                                  options: v.options!.map((x, k) =>
                                    k === j ? { ...x, value: e.target.value as unknown as number } : x,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Label
                            <input
                              value={o.label}
                              placeholder="e.g. Full colour"
                              onChange={(e) =>
                                setVariable(i, {
                                  options: v.options!.map((x, k) =>
                                    k === j ? { ...x, label: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="text-button danger-text"
                            onClick={() => setVariable(i, { options: v.options!.filter((_, k) => k !== j) })}
                          >
                            Remove option
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setVariable(i, {
                            options: [
                              ...v.options!,
                              {
                                value: Math.max(0, ...v.options!.map((o) => Number(o.value) || 0)) + 1,
                                label: '',
                              },
                            ],
                          })
                        }
                      >
                        <Icon name="add" /> Add option
                      </button>
                    </div>
                  )}
                  {v.kind === 'material' && (
                    <div className="template-options">
                      <p className="muted">
                        Staff pick one of these when pricing (e.g. Basic, Premium or Luxury shirt). Any{' '}
                        {w('service')}, product or private cost with a template cost can be a choice. In
                        formulas, <code>{v.key}_rate</code> is the chosen item's cost per{' '}
                        {materialUnit || 'unit'}. All choices must use the same unit. To take the chosen item
                        out of stock, link a computed variable to this choice.
                      </p>
                      {!costs.some((s) => hasCost(s.costing)) && (
                        <p className="notice">
                          Give {w('services')} a template cost first (on the {w('Services')} page or with Add
                          private cost).
                        </p>
                      )}
                      {costs
                        .filter((s) => hasCost(s.costing))
                        .map((s) => {
                          const unit = consumptionUnit(s, ledger.materials);
                          const chosen = v.options?.find((o) => o.serviceId === s.id);
                          return (
                            <label className="check-label" key={s.id}>
                              <input
                                type="checkbox"
                                checked={!!chosen}
                                disabled={!chosen && !!materialUnit && unit !== materialUnit}
                                onChange={(e) => {
                                  const options = e.target.checked
                                    ? [
                                        ...(v.options ?? []),
                                        {
                                          value:
                                            Math.max(0, ...(v.options ?? []).map((o) => Number(o.value))) + 1,
                                          label: s.description.slice(0, 80),
                                          serviceId: s.id,
                                        },
                                      ]
                                    : (v.options ?? []).filter((o) => o.serviceId !== s.id);
                                  setVariable(i, {
                                    options,
                                    default: options.some((o) => o.value === Number(v.default))
                                      ? v.default
                                      : (options[0]?.value ?? 1),
                                  });
                                }}
                              />
                              {s.description}
                              <small>
                                {' '}
                                {canonical(costRate(s.costing!))} per {unit}
                                {s.materialId ? ' · stock item' : ''}
                                {s.private ? ' · private' : ''}
                              </small>
                            </label>
                          );
                        })}
                    </div>
                  )}
                  <div className="material-actions">
                    {v.kind === 'number' && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={v.integer}
                          onChange={(e) => setVariable(i, { integer: e.target.checked })}
                        />
                        Whole numbers only
                      </label>
                    )}
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={v.clientVisible !== false}
                        onChange={(e) => setVariable(i, { clientVisible: e.target.checked })}
                      />
                      Show on client quote
                    </label>
                    {!quantity && (
                      <button
                        type="button"
                        className="text-button danger-text"
                        onClick={() => change({ variables: d.variables.filter((_, j) => j !== i) })}
                      >
                        Remove {v.label || 'variable'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="secondary"
              disabled={d.variables.length >= 30}
              onClick={() =>
                change({
                  variables: [
                    ...d.variables,
                    {
                      key: unique('variable_' + d.variables.length),
                      label: 'New variable',
                      kind: 'number',
                      unit: '',
                      default: 1,
                      min: 0,
                      max: 10000,
                      integer: false,
                      clientVisible: true,
                    },
                  ],
                })
              }
            >
              <Icon name="add" /> Add editable variable
            </button>
          </>
        )}
        {tab === 'Computed variables' && (
          <>
            <p className="muted">
              Work out paper, cards, impressions or other quantities. They appear on the internal job report
              and can be used in expenses; they are not added to the cost. Link one to stock to take that
              quantity out of a material when the order is saved.
            </p>
            {d.computed.map((c, i) => (
              <div className="template-section" key={i}>
                <div className="form-grid">
                  <label>
                    Name
                    <input
                      value={c.label}
                      onChange={(e) =>
                        setComputed(i, {
                          label: e.target.value,
                          key: relabel(c.key, c.label, e.target.value),
                        })
                      }
                    />
                  </label>
                  <KeyField value={c.key} onChange={(key) => setComputed(i, { key })} onRename={rename} />
                  <label>
                    Unit
                    <input
                      value={c.unit}
                      placeholder="e.g. A4 sheets"
                      onChange={(e) => setComputed(i, { unit: e.target.value })}
                    />
                  </label>
                  <label>
                    Take from stock
                    <select
                      aria-label="Take from stock"
                      value={
                        !c.stock
                          ? ''
                          : 'variable' in c.stock
                            ? 'v:' + c.stock.variable
                            : 's:' + c.stock.serviceId
                      }
                      onChange={(e) => {
                        const x = e.target.value;
                        setComputed(i, {
                          stock: !x
                            ? null
                            : x.startsWith('v:')
                              ? { variable: x.slice(2) }
                              : { serviceId: x.slice(2) },
                        });
                      }}
                    >
                      <option value="">No stock change</option>
                      {d.variables.some((v) => v.kind === 'material') && (
                        <optgroup label="The item chosen in">
                          {d.variables
                            .filter((v) => v.kind === 'material')
                            .map((v) => (
                              <option key={v.key} value={'v:' + v.key}>
                                {v.label}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {stockItems.length > 0 && (
                        <optgroup label={w('Material')}>
                          {stockItems.map((s) => (
                            <option key={s.id} value={'s:' + s.id}>
                              {ledger.materials.find((m) => m.id === s.materialId)?.name} (via {s.description}
                              )
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </label>
                </div>
                <FormulaEditor
                  customOnly
                  label={`${c.label || 'Computed variable'} formula`}
                  value={c.formula}
                  draft={d}
                  costs={costs}
                  exclude={c.key}
                  onChange={(formula) => setComputed(i, { formula })}
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={c.clientVisible === true}
                    onChange={(e) => setComputed(i, { clientVisible: e.target.checked })}
                  />
                  Show on client quote
                </label>
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => change({ computed: d.computed.filter((_, j) => j !== i) })}
                >
                  Remove {c.label || 'computed variable'}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={d.computed.length >= 100}
              onClick={() =>
                change({
                  computed: [
                    ...d.computed,
                    {
                      key: unique('computed_' + (d.computed.length + 1)),
                      label: 'New computed variable',
                      unit: 'units',
                      formula: 'quantity',
                      stock: null,
                    },
                  ],
                })
              }
            >
              <Icon name="add" /> Add computed variable
            </button>
          </>
        )}
        {tab === 'Expenses' && (
          <>
            <p className="muted">
              Every expense is added to the cost. Per variable unit includes the quantity; use Order-level
              variable for a value that already covers the whole order (such as a computed paper count).
            </p>
            {d.expenses.map((e, i) => (
              <div className="template-section" key={i}>
                <div className="form-grid">
                  <label>
                    Expense name
                    <input
                      value={e.label}
                      onChange={(x) =>
                        setExpense(i, { label: x.target.value, key: relabel(e.key, e.label, x.target.value) })
                      }
                    />
                  </label>
                  <KeyField value={e.key} onChange={(key) => setExpense(i, { key })} onRename={rename} />
                </div>
                <FormulaEditor
                  label={`Formula · ${e.key}`}
                  value={e.formula}
                  calculation={e.calculation}
                  draft={d}
                  costs={costs}
                  exclude={e.key}
                  onChange={(formula, calculation) => setExpense(i, { formula, calculation })}
                />
                {d.expenses.length > 1 && (
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() => change({ expenses: d.expenses.filter((_, j) => j !== i) })}
                  >
                    Remove {e.label || 'expense'}
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={d.expenses.length >= 100}
              onClick={() =>
                change({
                  expenses: [
                    ...d.expenses,
                    {
                      key: unique('expense_' + (d.expenses.length + 1)),
                      label: '',
                      formula: 'quantity * (100)',
                      calculation: { method: 'perItem', rate: '100', input: 'quantity', capacity: '25' },
                    },
                  ],
                })
              }
            >
              <Icon name="add" /> Add an expense
            </button>
          </>
        )}
        {tab === 'Pricing & preview' && (
          <>
            <div className="form-grid">
              <label>
                Profit method
                <select
                  aria-label="Profit method"
                  value={p.method}
                  onChange={(e) =>
                    change({ pricing: { ...p, method: e.target.value as 'markup' | 'margin' } })
                  }
                >
                  <option value="markup">Markup on cost</option>
                  <option value="margin">Gross profit margin</option>
                </select>
              </label>
              <label>
                Default profit rate (%)
                <input
                  inputMode="decimal"
                  value={p.rate}
                  onChange={(e) => change({ pricing: { ...p, rate: e.target.value as unknown as number } })}
                />
              </label>
              <label>
                Minimum profit rate (%)
                <input
                  inputMode="decimal"
                  value={p.floor}
                  onChange={(e) => change({ pricing: { ...p, floor: e.target.value as unknown as number } })}
                />
              </label>
              <label>
                Maximum discount (%)
                <input
                  inputMode="decimal"
                  value={p.maxDiscount}
                  onChange={(e) =>
                    change({ pricing: { ...p, maxDiscount: e.target.value as unknown as number } })
                  }
                />
              </label>
              <label>
                Round price up to
                <select
                  aria-label="Round price up to"
                  value={String(p.rounding)}
                  onChange={(e) => change({ pricing: { ...p, rounding: Number(e.target.value) } })}
                >
                  {[...new Set([...roundingChoices, Number(p.rounding)])].map((r) => (
                    <option key={r} value={r}>
                      {r === 0.01 ? 'The nearest kobo (₦0.01)' : currency(r * 100)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {Number(p.maxDiscount) > limit && !problem && (
              <p className="notice notice-warning" role="status">
                With a {p.rate}% {p.method} and a {p.floor}% minimum, the deepest discount that keeps the
                minimum is <strong>{limit}%</strong>. Staff will be limited to {limit}%, not {p.maxDiscount}%.
              </p>
            )}
            <h4>Preview with the default values</h4>
            {preview ? (
              <TemplateAudit
                snapshot={preview}
                quantity={checked!.variables.find((v) => v.key === 'quantity')!.default}
              />
            ) : (
              <p className="danger-text" role="alert">
                {problem}
              </p>
            )}
          </>
        )}
      </fieldset>
      {problem && tab !== 'Pricing & preview' && (
        <p className="danger-text" role="status">
          {problem}
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="material-actions" ref={actions}>
        {step > 0 && (
          <button type="button" className="secondary" disabled={busy} onClick={() => go(step - 1)}>
            Back
          </button>
        )}
        {step < tabs.length - 1 ? (
          <button type="button" disabled={busy} onClick={() => go(step + 1)}>
            Next: {tabs[step + 1]}
          </button>
        ) : (
          <button type="button" disabled={busy || !!problem} onClick={() => void save()}>
            <Icon name="save" /> {busy ? 'Saving...' : 'Check & save template'}
          </button>
        )}
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
