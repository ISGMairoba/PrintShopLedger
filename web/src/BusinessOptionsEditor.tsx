import { PERIOD_CHOICES } from './expense-periods.mjs';
import SearchSelect from './SearchSelect';
import Icon from './Icon';
import { StepsDialog, StepsSummary } from './StepBuilder';
import { useFeedbackMessage } from './Feedback';
import { useState, type ReactNode } from 'react';
import { defaultOptions, methodKey, orderMethods } from './business-options.mjs';
import { useWords } from './Words';
type Options = ReturnType<typeof defaultOptions>;
export default function BusinessOptionsEditor({
  value,
  onChange,
  disabled,
  saveControl,
  section = 'workflow',
  methods = [],
}: {
  value: Options;
  onChange: (value: Options) => void;
  disabled: boolean;
  saveControl?: ReactNode;
  section?: 'payments' | 'workflow';
  /** Payment methods as sales offer them: put in order, choose the usual ones. */
  methods?: { label: string; kind: string; accountId?: string; displayLabel?: string }[];
}) {
  const { w, stage } = useWords();
  const [error, setError] = useFeedbackMessage('error'),
    [payment, setPayment] = useState(''),
    [kind, setKind] = useState('Transfer'),
    // The workflow open in the Steps window: an index, or 'new' for one being added.
    [flowOpen, setFlowOpen] = useState<number | 'new' | null>(null);
  function update(key: keyof Options, next: unknown) {
    onChange({ ...value, [key]: next });
    setError('');
  }
  return (
    <fieldset disabled={disabled}>
      <legend>{w(section === 'payments' ? 'Payment methods' : 'Dropdowns & job workflow')}</legend>
      <p>
        {w(
          'Changes apply to new entries. Saved payments and existing jobs keep their original details and stage order.',
        )}
      </p>
      {section === 'payments' && (
        <>
          <h3>Payment methods</h3>
          <p>
            Choose where each method belongs in drawer totals. Cash contributes to the cash handover; POS and
            Transfer contribute to their respective totals.
          </p>
          <div className="business-option-list">
            {value.paymentMethods.map((item, index) => (
              <div className="business-payment-option" key={index}>
                <label>
                  Method name
                  <input
                    aria-label={`Payment method name ${index + 1}`}
                    maxLength={80}
                    required
                    value={item.label}
                    onChange={(e) =>
                      update(
                        'paymentMethods',
                        value.paymentMethods.map((row, i) =>
                          i === index ? { ...row, label: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Accounting type
                  <select
                    aria-label={`Payment accounting type ${index + 1}`}
                    value={item.kind}
                    onChange={(e) =>
                      update(
                        'paymentMethods',
                        value.paymentMethods.map((row, i) =>
                          i === index ? { ...row, kind: e.target.value } : row,
                        ),
                      )
                    }
                  >
                    {['Cash', 'POS', 'Transfer'].map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="check-label">
                  <input
                    aria-label={`Enable payment method ${index + 1}`}
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) =>
                      update(
                        'paymentMethods',
                        value.paymentMethods.map((row, i) =>
                          i === index ? { ...row, enabled: e.target.checked } : row,
                        ),
                      )
                    }
                  />
                  Enabled
                </label>
                <button
                  className="secondary"
                  type="button"
                  aria-label={`Remove payment method ${index + 1}`}
                  disabled={value.paymentMethods.length === 1}
                  onClick={() =>
                    update(
                      'paymentMethods',
                      value.paymentMethods.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Icon name="close" /> Remove
                </button>
              </div>
            ))}
          </div>
          <div className="business-payment-option">
            <label>
              New payment method
              <input
                aria-label="New payment method"
                maxLength={80}
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              />
            </label>
            <label>
              Accounting type
              <select
                aria-label="New payment accounting type"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {['Cash', 'POS', 'Transfer'].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={value.paymentMethods.length >= 30}
              onClick={() => {
                const label = payment.trim();
                if (
                  !label ||
                  value.paymentMethods.some((item) => item.label.toLowerCase() === label.toLowerCase())
                ) {
                  setError('Enter a unique payment method name.');
                  return;
                }
                update('paymentMethods', [...value.paymentMethods, { label, kind, enabled: true }]);
                setPayment('');
              }}
            >
              <Icon name="add" /> Add payment method
            </button>
          </div>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
        </>
      )}
      {section === 'workflow' && (
        <>
          <div className="form-grid">
            {(
              [
                ['expenseCategories', 'Expense categories', 80],
                ['jobSources', 'Job sources', 80],
                ['stockReasons', 'Stock reasons', 200],
                ['materialUnits', 'Material units', 40],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key}>
                {w(label)}
                <textarea
                  aria-label={w(label)}
                  rows={5}
                  value={value[key].join('\n')}
                  onChange={(e) => update(key, e.target.value.split('\n'))}
                />
                <small>
                  One option per line, up to {max} characters each. Blank lines and duplicate names must be
                  removed before saving.
                </small>
              </label>
            ))}
          </div>
          <fieldset className="category-periods">
            <legend>{w('Usual period each expense category covers')}</legend>
            <p className="muted">
              Profit spreads an expense evenly, day by day, over the period it covers (rent for a year,
              salaries for a month). New expenses start with their category's period; it can be changed on
              each expense.
            </p>
            <div className="form-grid">
              {value.expenseCategories
                .filter((c) => c.trim())
                .map((c) => (
                  <label key={c}>
                    {c}
                    <select
                      aria-label={`${c}: usually covers`}
                      value={String(value.categoryPeriods?.[c] ?? 0)}
                      onChange={(e) => {
                        const months = Number(e.target.value);
                        const next: Record<string, number> = { ...(value.categoryPeriods ?? {}) };
                        if (months > 0) next[c] = months;
                        else delete next[c];
                        update('categoryPeriods', next);
                      }}
                    >
                      {PERIOD_CHOICES.map(([n, text]) => (
                        <option key={n} value={String(n)}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </div>
          </fieldset>
          <label>
            {w('New jobs come in through')}
            <SearchSelect
              label="Usual sales channel"
              value={value.defaultJobSource ?? ''}
              onChange={(next) => update('defaultJobSource', next)}
              pinned={[{ value: '', label: `The first in the list (${value.jobSources[0] ?? '—'})` }]}
              options={value.jobSources.filter((s) => s.trim()).map((s) => ({ value: s, label: s }))}
            />
            <small>{w('The sales channel each new job starts with; staff can still change it.')}</small>
          </label>
          <label>
            {w('Handing over part of a job')}
            <select
              aria-label="Part handover payment rule"
              value={value.handoverPayment ?? 'warn'}
              onChange={(e) => update('handoverPayment', e.target.value)}
            >
              <option value="warn">Warn when that part is not paid for</option>
              <option value="require">Only when that part is paid for</option>
            </select>
            <small>
              {w(
                'For big orders collected in batches (200 jotters, 100 now): a part counts as paid when the job’s payments cover its share of the price.',
              )}
            </small>
          </label>
          {methods.length > 0 && (
            <fieldset className="method-order">
              <legend>{w('Payment methods: order and usual choice')}</legend>
              <p className="muted">
                {w(
                  'The order sales, payments and expenses list them in. The usual choice is selected when the form opens.',
                )}
              </p>
              <ol className="method-order-list">
                {orderMethods(methods, value.methodOrder).map((m, i, list) => {
                  const move = (to: number) => {
                    const keys = list.map(methodKey);
                    const [k] = keys.splice(i, 1);
                    keys.splice(to, 0, k);
                    update('methodOrder', keys);
                  };
                  return (
                    <li key={methodKey(m)}>
                      <span>{m.displayLabel || m.label}</span>
                      <button
                        type="button"
                        className="secondary icon-button"
                        aria-label={`Move ${m.displayLabel || m.label} up`}
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => move(i - 1)}
                      >
                        <Icon name="up" />
                      </button>
                      <button
                        type="button"
                        className="secondary icon-button"
                        aria-label={`Move ${m.displayLabel || m.label} down`}
                        title="Move down"
                        disabled={i === list.length - 1}
                        onClick={() => move(i + 1)}
                      >
                        <Icon name="down" />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="form-grid">
                <label>
                  {w('Money received: usual method')}
                  <SearchSelect
                    label="Usual method for money received"
                    value={value.defaultIncomeMethod ?? ''}
                    onChange={(next) => update('defaultIncomeMethod', next)}
                    pinned={[{ value: '', label: 'The first in the list' }]}
                    options={methods.map((m) => ({ value: methodKey(m), label: m.displayLabel || m.label }))}
                  />
                </label>
                <label>
                  {w('Expenses: usual "paid from"')}
                  <SearchSelect
                    label="Usual method for expenses"
                    value={value.defaultExpenseMethod ?? ''}
                    onChange={(next) => update('defaultExpenseMethod', next)}
                    pinned={[{ value: '', label: 'The first in the list' }]}
                    options={methods.map((m) => ({ value: methodKey(m), label: m.displayLabel || m.label }))}
                  />
                </label>
              </div>
            </fieldset>
          )}
          <fieldset className="stage-hours">
            <legend>{w('Workflows')}</legend>
            <p className="muted">
              {w(
                'Every job starts at Added and ends at Completed, then Collected. The steps between can differ by item: a logo (Design, Approval), a paper bag (Design, Printing, Lamination, Cutting, Gumming, Packaging). Save workflows here as starting points; an item copies one and can change its copy (Items and Pricing Templates → Production steps).',
              )}
            </p>
            <label>
              {w('Items without their own steps follow')}
              <SearchSelect
                label="Usual steps"
                value={value.defaultWorkflowId ?? ''}
                onChange={(next) => onChange({ ...value, defaultWorkflowId: next || null })}
                pinned={[
                  { value: '', label: `${stage('Added')} → ${stage('Processing')} → ${stage('Completed')}` },
                ]}
                options={(value.workflows ?? []).map((wf) => ({
                  value: wf.id,
                  label: wf.name || 'Unnamed workflow',
                }))}
              />
              <small>
                {w(
                  'A step without a time shares the time to the due date evenly; jobs without a due date are then not checked.',
                )}
              </small>
            </label>
            <div className="form-grid">
              {(
                [
                  ['defaultServiceWorkflowId', 'Services follow'],
                  ['defaultShelfWorkflowId', 'Shelf items follow'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {w(label)}
                  <SearchSelect
                    label={label}
                    value={value[key] ?? ''}
                    onChange={(next) => onChange({ ...value, [key]: next || null })}
                    pinned={[{ value: '', label: 'The usual steps above' }]}
                    options={(value.workflows ?? []).map((wf) => ({
                      value: wf.id,
                      label: wf.name || 'Unnamed workflow',
                    }))}
                  />
                </label>
              ))}
            </div>
            <ul className="workflow-list">
              {(value.workflows ?? []).map((wf, i) => (
                <li key={wf.id} className="workflow-row">
                  <div>
                    <strong>{wf.name || `Workflow ${i + 1}`}</strong>
                    {value.defaultWorkflowId === wf.id && <span className="badge">usual steps</span>}
                    <br />
                    <StepsSummary steps={wf.steps} />
                  </div>
                  <div className="material-actions">
                    <button type="button" className="text-button" data-opens-dialog onClick={() => setFlowOpen(i)}>
                      <Icon name="edit" /> Edit
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={(value.workflows?.length ?? 0) >= 30}
                      onClick={() =>
                        onChange({
                          ...value,
                          workflows: [
                            ...value.workflows.slice(0, i + 1),
                            {
                              id: crypto.randomUUID(),
                              name: `${wf.name || `Workflow ${i + 1}`} (copy)`.slice(0, 60),
                              steps: wf.steps.map((s) => ({ ...s })),
                            },
                            ...value.workflows.slice(i + 1),
                          ],
                        })
                      }
                    >
                      <Icon name="add" /> Duplicate
                    </button>
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() =>
                        onChange({
                          ...value,
                          workflows: value.workflows.filter((_, j) => j !== i),
                          defaultWorkflowId: value.defaultWorkflowId === wf.id ? null : value.defaultWorkflowId,
                        })
                      }
                    >
                      <Icon name="close" /> Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="secondary"
              disabled={(value.workflows?.length ?? 0) >= 30}
              data-opens-dialog
              onClick={() => setFlowOpen('new')}
            >
              <Icon name="add" /> {w('Add workflow')}
            </button>
            {flowOpen !== null && (
              <StepsDialog
                title={flowOpen === 'new' ? w('Add workflow') : w('Edit workflow')}
                name={flowOpen === 'new' ? '' : value.workflows[flowOpen].name}
                steps={
                  flowOpen === 'new' ? [{ name: 'Design' }, { name: 'Approval' }] : value.workflows[flowOpen].steps
                }
                onSave={(steps, name) =>
                  onChange({
                    ...value,
                    workflows:
                      flowOpen === 'new'
                        ? [...(value.workflows ?? []), { id: crypto.randomUUID(), name, steps }]
                        : value.workflows.map((x, j) => (j === flowOpen ? { ...x, name, steps } : x)),
                  })
                }
                onClose={() => setFlowOpen(null)}
              />
            )}
            <small className="muted">
              {w(
                'Jobs keep the steps they were sold with, and items keep their copies: changes here apply to new jobs of items that follow the usual steps.',
              )}
            </small>
          </fieldset>
        </>
      )}
      {saveControl}
    </fieldset>
  );
}
