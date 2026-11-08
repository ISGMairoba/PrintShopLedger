import Icon from './Icon';
import { StepBuilder } from './StepBuilder';
import { useFeedbackMessage } from './Feedback';
import { useState, type ReactNode } from 'react';
import { defaultOptions } from './business-options.mjs';
import { useWords } from './Words';
type Options = ReturnType<typeof defaultOptions>;
export default function BusinessOptionsEditor({
  value,
  onChange,
  disabled,
  saveControl,
  section = 'workflow',
}: {
  value: Options;
  onChange: (value: Options) => void;
  disabled: boolean;
  saveControl?: ReactNode;
  section?: 'payments' | 'workflow';
}) {
  const { w, stage } = useWords();
  const [error, setError] = useFeedbackMessage('error'),
    [payment, setPayment] = useState(''),
    [kind, setKind] = useState('Transfer'),
    // Saved workflows start collapsed; one just added opens.
    [openFlows, setOpenFlows] = useState<string[]>([]);
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
          <fieldset className="stage-hours">
            <legend>{w('Workflows')}</legend>
            <p className="muted">
              {w(
                'Every job starts at Added and ends at Completed, then Collected. The steps between can differ by item: a logo (Design, Approval), a paper bag (Design, Printing, Lamination, Cutting, Gumming, Packaging). Save workflows here as starting points; an item copies one and can change its copy (Items and Pricing Templates → Production steps).',
              )}
            </p>
            <label>
              {w('Items without their own steps follow')}
              <select
                aria-label="Usual steps"
                value={value.defaultWorkflowId ?? ''}
                onChange={(e) => onChange({ ...value, defaultWorkflowId: e.target.value || null })}
              >
                <option value="">
                  {stage('Added')} → {stage('Processing')} → {stage('Completed')}
                </option>
                {(value.workflows ?? []).map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name || 'Unnamed workflow'}
                  </option>
                ))}
              </select>
              <small>
                {w(
                  'A step without a time shares the time to the due date evenly; jobs without a due date are then not checked.',
                )}
              </small>
            </label>
            {(value.workflows ?? []).map((wf, i) => {
              const setWf = (patch: Partial<typeof wf>) =>
                onChange({
                  ...value,
                  workflows: value.workflows.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                });
              const open = openFlows.includes(wf.id);
              return (
                <details
                  key={wf.id}
                  className="workflow-row"
                  open={open}
                  onToggle={(e) => {
                    const now = e.currentTarget.open;
                    if (now !== open)
                      setOpenFlows((ids) => (now ? [...ids, wf.id] : ids.filter((x) => x !== wf.id)));
                  }}
                >
                  <summary>
                    <strong>{wf.name || `Workflow ${i + 1}`}</strong>
                    <span className="muted">
                      {' '}
                      · {wf.steps.length} {wf.steps.length === 1 ? 'step' : 'steps'}
                      {value.defaultWorkflowId === wf.id ? ' · usual steps' : ''}
                    </span>
                  </summary>
                  <div className="workflow-body">
                  <label>
                    {w('Workflow name')}
                    <input
                      aria-label={`Workflow ${i + 1} name`}
                      maxLength={60}
                      value={wf.name}
                      onChange={(e) => setWf({ name: e.target.value })}
                    />
                  </label>
                  <StepBuilder
                    steps={wf.steps}
                    onChange={(steps) => setWf({ steps })}
                    label={wf.name || `Workflow ${i + 1}`}
                  />
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
                    Remove workflow
                  </button>
                  </div>
                </details>
              );
            })}
            <button
              type="button"
              className="secondary"
              disabled={(value.workflows?.length ?? 0) >= 30}
              onClick={() => {
                const id = crypto.randomUUID();
                setOpenFlows((ids) => [...ids, id]);
                onChange({
                  ...value,
                  workflows: [...(value.workflows ?? []), { id, name: '', steps: [{ name: 'Design' }, { name: 'Approval' }] }],
                });
              }}
            >
              <Icon name="add" /> {w('Add workflow')}
            </button>
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
