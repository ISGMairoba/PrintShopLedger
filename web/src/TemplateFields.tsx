import { Fragment, createContext, useContext, useState, type ReactNode } from 'react';
import {
  FieldError,
  canonical,
  clientSpecs,
  discountCeiling,
  explainFormula,
  groupRows,
  quoteTemplate,
  scenarioInputs,
  snapshotValue,
  valueLabel,
} from './pricing-templates.mjs';
import { currency } from './receipts.mjs';
import type { Ledger, PricingTemplate, TemplateSnapshot, TemplateVariable } from './types';

/** Whether this person may see costs and the internal job & audit view. */
export const TemplateAuditContext = createContext(false);
export const useTemplateAudit = () => useContext(TemplateAuditContext);

const naira = (value: string | number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(
    Number(value),
  );
const number = (value: string | number) =>
  new Intl.NumberFormat('en-NG', { maximumFractionDigits: 6 }).format(Number(value));

/** Price a template line without throwing: the snapshot, or the error and the field it is about. */
export function tryTemplate(
  ledger: Ledger,
  template: PricingTemplate,
  inputs: Record<string, number | string>,
  quantity: number | string,
) {
  try {
    const q = quoteTemplate(ledger, { serviceId: template.id, templateInputs: inputs, quantity }) as {
      amount: number;
      unitPrice: number;
      templateSnapshot: TemplateSnapshot;
    };
    return { quote: q, error: '', field: '' };
  } catch (cause) {
    return {
      quote: null,
      error: cause instanceof Error ? cause.message : String(cause),
      field: cause instanceof FieldError ? (cause as FieldError & { field: string }).field : '',
    };
  }
}

function VariableField({
  variable: v,
  value,
  error,
  onChange,
}: {
  variable: TemplateVariable;
  value: number | string;
  error?: string;
  onChange: (value: number | string) => void;
}) {
  const hint = error ? (
    <small className="danger-text" role="alert">
      {error}
    </small>
  ) : v.unit && v.kind === 'number' ? (
    <small>
      {v.unit} · {number(v.min)} to {number(v.max)}
    </small>
  ) : null;
  if (v.kind === 'yesno')
    return (
      <label className="check-label">
        <input
          type="checkbox"
          checked={Number(value) === 1}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        />
        {v.label}
      </label>
    );
  if (v.options)
    return (
      <label>
        {v.label}
        <select aria-label={v.label} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {v.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint}
      </label>
    );
  return (
    <label className={error ? 'has-error' : undefined}>
      {v.label}
      <input
        aria-label={v.label}
        aria-invalid={!!error}
        inputMode={v.integer ? 'numeric' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint}
    </label>
  );
}

/** The editable variables of a template (quantity is the line's own field). */
export function TemplateInputs({
  template,
  value,
  errorField = '',
  error = '',
  onChange,
}: {
  template: PricingTemplate;
  value: Record<string, number | string>;
  errorField?: string;
  error?: string;
  onChange: (value: Record<string, number | string>) => void;
}) {
  return (
    <>
      {template.variables
        .filter((v) => v.key !== 'quantity')
        .map((v) => (
          <VariableField
            key={v.key}
            variable={v}
            value={value[v.key] ?? v.default}
            error={errorField === v.key ? error : undefined}
            onChange={(next) => onChange({ ...value, [v.key]: next })}
          />
        ))}
    </>
  );
}

export function ViewSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="settings-tabs template-views" role="group" aria-label="Template view">
      {[
        ['client', 'Staff / client view'],
        ['internal', 'Internal job & audit'],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          className={value === key ? 'active' : 'secondary'}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** What the customer may see: the client-visible variables. Never costs. */
export function ClientSpecs({
  snapshot,
  quantity,
}: {
  snapshot: TemplateSnapshot;
  quantity: number | string;
}) {
  const specs = clientSpecs(snapshot, quantity);
  if (!specs.length) return null;
  return (
    <dl className="template-specs">
      {specs.map((s: { label: string; value: string }) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The internal job & calculation report (Costora's audit view). */
export function TemplateAudit({
  snapshot: s,
  quantity,
  amount,
}: {
  snapshot: TemplateSnapshot;
  quantity: number | string;
  /** The line's price after discounts (kobo); defaults to the template price. */
  amount?: number;
}) {
  const t = s.template,
    p = t.pricing;
  const valueOf = (name: string) => snapshotValue(s, quantity, name);
  const total = amount ?? s.price.amount;
  const discount = s.price.amount - total;
  const cost = Number(s.price.cost);
  const profit = total / 100 - cost;
  const markup = cost ? (profit / cost) * 100 : null;
  const margin = total ? (profit / (total / 100)) * 100 : null;
  return (
    <section className="template-audit" aria-label="Internal job and calculation report">
      <div className="row-between">
        <h4>Job & calculation report</h4>
        <span className="badge unpaid">Internal · not for clients</span>
      </div>
      <p className="muted">
        {t.name} · Template version {t.version}
      </p>
      <h5>Job specifications</h5>
      <dl className="template-specs">
        {t.variables.map((v) => (
          <div key={v.key}>
            <dt>{v.label}</dt>
            <dd>
              {valueLabel(v, v.key === 'quantity' ? quantity : s.inputs[v.key])}
              {v.options ? <small> ({v.key === 'quantity' ? quantity : s.inputs[v.key]})</small> : null}
              {v.clientVisible === false && <small> · hidden from client</small>}
            </dd>
          </div>
        ))}
      </dl>
      {s.outputs.length > 0 && (
        <>
          <h5>Materials & production</h5>
          <ul className="template-lines">
            {s.outputs.map((o) => {
              const c = t.computed.find((x) => x.key === o.key);
              return (
                <li key={o.key}>
                  <span>
                    <strong>{o.label}</strong>
                    <code>{c?.formula}</code>
                    <small>
                      {c ? explainFormula(c.formula, valueOf) : ''} = {o.value}
                    </small>
                  </span>
                  <strong>
                    {number(o.value)} {o.unit}
                  </strong>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {s.stock.length > 0 && (
        <>
          <h5>Stock taken at checkout</h5>
          <ul className="template-lines">
            {s.stock.map((m) => (
              <li key={m.materialId}>
                <span>
                  <strong>{m.name}</strong>
                  <small>Taken out of stock when the order is saved. Quotations never move stock.</small>
                </span>
                <strong>
                  {number(m.quantity)} {m.unit}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <h5>Expense calculations</h5>
      <ul className="template-lines">
        {s.expenses.map((e) => {
          const x = t.expenses.find((y) => y.key === e.key);
          return (
            <li key={e.key}>
              <span>
                <strong>{e.label}</strong>
                <code>{x?.formula}</code>
                <small>
                  {x ? explainFormula(x.formula, valueOf) : ''} = {e.amount}
                </small>
              </span>
              <strong>{naira(e.amount)}</strong>
            </li>
          );
        })}
      </ul>
      <h5>Price calculation</h5>
      <dl className="template-price">
        <div>
          <dt>Total expense · sum of expenses</dt>
          <dd>{naira(s.price.cost)}</dd>
        </div>
        <div>
          <dt>Profit rule</dt>
          <dd>
            {p.rate}% {p.method}
          </dd>
        </div>
        <div>
          <dt>Base price formula</dt>
          <dd>
            <code>
              {p.method === 'markup'
                ? `${s.price.cost} × (1 + ${p.rate}/100)`
                : `${s.price.cost} ÷ (1 − ${p.rate}/100)`}
            </code>
          </dd>
        </div>
        <div>
          <dt>Before rounding</dt>
          <dd>{number(s.price.raw)}</dd>
        </div>
        <div>
          <dt>Round up to</dt>
          <dd>{naira(p.rounding)}</dd>
        </div>
        <div>
          <dt>Template price</dt>
          <dd>{currency(s.price.amount)}</dd>
        </div>
        <div>
          <dt>Discount given</dt>
          <dd>{currency(discount)}</dd>
        </div>
        <div>
          <dt>Final selling price</dt>
          <dd>
            <strong>{currency(total)}</strong>
          </dd>
        </div>
        <div>
          <dt>Estimated profit · price less expense</dt>
          <dd>{naira(profit)}</dd>
        </div>
        <div>
          <dt>Effective markup / margin</dt>
          <dd>
            {markup === null ? 'N/A' : markup.toFixed(2) + '%'} /{' '}
            {margin === null ? 'N/A' : margin.toFixed(2) + '%'}
          </dd>
        </div>
        <div>
          <dt>Minimum {p.method}</dt>
          <dd>{p.floor}%</dd>
        </div>
        <div>
          <dt>Lowest price allowed</dt>
          <dd>{currency(s.price.minimum)}</dd>
        </div>
        <div>
          <dt>Most discount allowed</dt>
          <dd>{discountCeiling(p)}%</dd>
        </div>
        <div>
          <dt>Unit price · final price ÷ {number(quantity)}</dt>
          <dd>{currency(Math.round(total / Number(quantity)))} (rounded)</dd>
        </div>
      </dl>
      {s.references.length > 0 && (
        <details open>
          <summary>Costs used</summary>
          <ul className="template-lines">
            {s.references.map((r) => (
              <li key={r.key}>
                <span>
                  <strong>
                    {r.name} · v{r.version}
                  </strong>
                  <small>
                    {r.key} · {currency(r.amount)} for {number(r.per)} {r.unit}
                    {r.purchaseUnit ? ` (bought as ${r.purchaseUnit})` : ''}
                  </small>
                </span>
                <strong>
                  {naira(r.rate)} / {r.unit}
                </strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A saved template line (order details, quotations): client specs, and the audit view if allowed. */
export function TemplateSummary({
  snapshot,
  quantity,
  amount,
}: {
  snapshot: TemplateSnapshot;
  quantity: number | string;
  amount?: number;
}) {
  const audit = useTemplateAudit();
  const [view, setView] = useState('client');
  return (
    <div className="template-breakdown">
      <p className="muted">
        {snapshot.template.name} · Template version {snapshot.template.version}
      </p>
      {audit && <ViewSelector value={view} onChange={setView} />}
      {audit && view === 'internal' ? (
        <TemplateAudit snapshot={snapshot} quantity={quantity} amount={amount} />
      ) : (
        <ClientSpecs snapshot={snapshot} quantity={quantity} />
      )}
    </div>
  );
}

/** Live estimate for a template line being entered, with views and option comparison. */
export function TemplateEstimate({
  ledger,
  template,
  inputs,
  quantity,
  amount,
  error,
  onUse,
}: {
  ledger: Ledger;
  template: PricingTemplate;
  inputs: Record<string, number | string>;
  quantity: string;
  /** Price after this line's discounts, when known. */
  amount?: number;
  error: string;
  onUse: (inputs: Record<string, number | string>, quantity: string) => void;
}) {
  const audit = useTemplateAudit();
  const [view, setView] = useState('client');
  const [compare, setCompare] = useState(false);
  const priced = tryTemplate(ledger, template, inputs, quantity);
  const snapshot = priced.quote?.templateSnapshot;
  const q = template.variables.find((v) => v.key === 'quantity');
  return (
    <div className="template-breakdown">
      <div className="row-between">
        <span>
          <strong>{priced.quote ? currency(amount ?? priced.quote.amount) : '—'}</strong>
          {priced.quote && (
            <small>
              {' '}
              {currency(priced.quote.unitPrice)} per {q?.unit || 'item'}
            </small>
          )}
        </span>
        <small>
          Discount up to {discountCeiling(template.pricing)}%
          {discountCeiling(template.pricing) < template.pricing.maxDiscount
            ? ` (keeps the minimum ${template.pricing.floor}% ${template.pricing.method})`
            : ''}
        </small>
      </div>
      {error || priced.error ? (
        <p className="danger-text" role="alert">
          {error || priced.error}
        </p>
      ) : (
        <p className="muted">Within your pricing limits.</p>
      )}
      {audit && <ViewSelector value={view} onChange={setView} />}
      {snapshot &&
        (audit && view === 'internal' ? (
          <TemplateAudit snapshot={snapshot} quantity={quantity} amount={amount} />
        ) : (
          <ClientSpecs snapshot={snapshot} quantity={quantity} />
        ))}
      <label className="check-label">
        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
        Compare options
      </label>
      {compare && (
        <CompareOptions
          ledger={ledger}
          template={template}
          inputs={inputs}
          quantity={quantity}
          onUse={onUse}
        />
      )}
    </div>
  );
}

type OptionSet = { key: string; values: string };
type Scenario = { inputs: Record<string, number>; amount?: number; unit?: number; error?: string };

/** Costora's comparison: several quantities and option sets, each combination priced separately. */
export function CompareOptions({
  ledger,
  template,
  inputs,
  quantity,
  onUse,
}: {
  ledger: Ledger;
  template: PricingTemplate;
  inputs: Record<string, number | string>;
  quantity: string;
  onUse: (inputs: Record<string, number | string>, quantity: string) => void;
}) {
  const choices = template.variables.filter((v) => v.key !== 'quantity');
  const [quantities, setQuantities] = useState(() => [quantity, '50', '100'].filter(Boolean).join(', '));
  const [sets, setSets] = useState<OptionSet[]>([]);
  const [groupBy, setGroupBy] = useState('quantity');
  const [rows, setRows] = useState<Scenario[]>([]);
  const [error, setError] = useState('');
  const available = choices.filter((v) => !sets.some((s) => s.key === v.key));
  const vary = () => {
    const out: Record<string, string[]> = { quantity: quantities.split(',') };
    for (const s of sets) out[s.key] = s.values.split(',');
    return out;
  };
  function run() {
    try {
      const base = Object.fromEntries(choices.map((v) => [v.key, Number(inputs[v.key] ?? v.default)]));
      const combos = scenarioInputs(template, { ...base, quantity: Number(quantity) || 1 }, vary()) as Record<
        string,
        number
      >[];
      setRows(
        combos.map((combo) => {
          const { quantity: qty, ...rest } = combo;
          const priced = tryTemplate(ledger, template, rest, qty);
          return priced.quote
            ? { inputs: combo, amount: priced.quote.amount, unit: priced.quote.unitPrice }
            : { inputs: combo, error: priced.error };
        }),
      );
      setError('');
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const varied = [
    template.variables.find((v) => v.key === 'quantity')!,
    ...sets.map((s) => choices.find((v) => v.key === s.key)!),
  ];
  const grouping = varied.find((v) => v.key === groupBy);
  const groups = groupRows(rows, grouping ? (r: Scenario) => String(r.inputs[grouping.key]) : undefined) as {
    key: string;
    rows: Scenario[];
  }[];
  const headings = !!grouping && groups.some((g) => g.rows.length > 1);
  function printComparison() {
    const visible = varied.filter((v) => v.clientVisible !== false);
    const esc = (t: string) =>
      t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const body = rows
      .map(
        (r) =>
          `<tr><td>${visible.map((v) => `<b>${esc(v.label)}:</b> ${esc(valueLabel(v, r.inputs[v.key]))}`).join('<br>')}</td><td>${currency(r.amount ?? 0)}</td><td>${currency(r.unit ?? 0)}</td></tr>`,
      )
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!doctype html><meta charset="utf-8"><title>${esc(template.name)} options</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}</style><h2>${esc(template.name)} — quotation options</h2><p>Choose one option. Prices are not added together.</p><table><tr><th>Specifications</th><th>Total price</th><th>Unit price</th></tr>${body}</table><p><small>${new Date().toLocaleString('en-GB')} · Unit prices rounded for display.</small></p>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }
  return (
    <div className="template-compare">
      <p className="muted">
        Every value is combined with every value in the other sets (at most 100). These are alternatives, not
        items added together.
      </p>
      <label>
        Quantities
        <input aria-label="Quantities" value={quantities} onChange={(e) => setQuantities(e.target.value)} />
        <small>Separate values with commas</small>
      </label>
      {sets.map((set, index) => {
        const v = choices.find((x) => x.key === set.key)!;
        const options =
          v.options ??
          (v.kind === 'yesno'
            ? [
                { value: 0, label: 'No' },
                { value: 1, label: 'Yes' },
              ]
            : null);
        const chosen = set.values
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        const update = (values: string) => setSets(sets.map((s, i) => (i === index ? { ...s, values } : s)));
        return (
          <fieldset key={set.key} className="template-option-set">
            <legend>
              Option set {index + 1}: {v.label}{' '}
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => setSets(sets.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </legend>
            {options ? (
              options.map((o) => (
                <label className="check-label" key={o.value}>
                  <input
                    type="checkbox"
                    checked={chosen.some((c) => Number(c) === o.value)}
                    onChange={(e) =>
                      update(
                        (e.target.checked
                          ? [...chosen, String(o.value)]
                          : chosen.filter((c) => Number(c) !== o.value)
                        ).join(', '),
                      )
                    }
                  />
                  {o.label}
                </label>
              ))
            ) : (
              <label>
                {v.label} values
                <input
                  aria-label={`${v.label} values`}
                  value={set.values}
                  onChange={(e) => update(e.target.value)}
                />
                <small>Separate values with commas{v.unit ? ` · ${v.unit}` : ''}</small>
              </label>
            )}
          </fieldset>
        );
      })}
      <div className="material-actions">
        {available.length > 0 && (
          <select
            aria-label="Add an option set"
            value=""
            onChange={(e) => {
              const v = choices.find((x) => x.key === e.target.value);
              if (v) setSets([...sets, { key: v.key, values: String(inputs[v.key] ?? v.default) }]);
            }}
          >
            <option value="">Add an option set…</option>
            {available.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="secondary" onClick={run}>
          Compare prices
        </button>
      </div>
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <div className="material-actions">
            <label>
              Group by
              <select
                aria-label="Group by"
                value={grouping?.key ?? 'none'}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="none">No grouping</option>
                {varied.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={rows.some((r) => r.error)}
              onClick={printComparison}
            >
              Print client comparison
            </button>
          </div>
          <div className="table-wrap">
            <table aria-label="Compared options">
              <thead>
                <tr>
                  {varied.map((v) => (
                    <th key={v.key}>{v.label}</th>
                  ))}
                  <th className="numeric">Total price</th>
                  <th className="numeric">Unit price</th>
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {headings && grouping && (
                      <tr>
                        <td colSpan={varied.length + 3}>
                          <strong>
                            {grouping.label}: {valueLabel(grouping, g.key)}
                          </strong>{' '}
                          <small>
                            {g.rows.length} option{g.rows.length === 1 ? '' : 's'}
                          </small>
                        </td>
                      </tr>
                    )}
                    {g.rows.map((r) => (
                      <tr key={JSON.stringify(r.inputs)}>
                        {varied.map((v) => (
                          <td key={v.key}>{valueLabel(v, r.inputs[v.key])}</td>
                        ))}
                        <td className="numeric">
                          {r.error ? <span className="danger-text">{r.error}</span> : currency(r.amount!)}
                        </td>
                        <td className="numeric">{r.unit === undefined ? '—' : currency(r.unit)}</td>
                        <td>
                          {!r.error && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                const { quantity: qty, ...rest } = r.inputs;
                                onUse({ ...inputs, ...rest }, canonical(qty));
                              }}
                            >
                              Use option
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="template-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}
