import Icon from './Icon';
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
    [kind, setKind] = useState('Transfer');
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
          <label>
            {w('Job stages')}
            <textarea
              aria-label={w('Job stages')}
              rows={7}
              value={value.jobStages.join('\n')}
              onChange={(e) => update('jobStages', e.target.value.split('\n'))}
            />
            <small>
              {w(
                'One stage per line, in production order. Keep Added first, and Completed then Collected last. Add steps such as Design, Approval, Finishing or Packing in between. Existing jobs retain their saved workflow.',
              )}
              {['Added', 'Completed', 'Collected'].some((s) => stage(s) !== s) &&
                ` Screens show them as ${stage('Added')}, ${stage('Completed')} and ${stage('Collected')} (Words).`}
            </small>
          </label>
          <fieldset className="stage-hours">
            <legend>{w('Time per stage')}</legend>
            <p className="muted">
              {w(
                'A job at a stage longer than this is marked "Too long at this stage". Leave a stage empty to share the time to the due date evenly across the stages before Completed (jobs without a due date are then not checked).',
              )}
            </p>
            <div className="form-grid">
              {value.jobStages
                .map((s) => s.trim())
                .filter((s) => s && !['Completed', 'Collected'].includes(s))
                .map((s) => (
                  <label key={s}>
                    {stage(s)} (hours)
                    <input
                      aria-label={`${stage(s)} hours`}
                      type="number"
                      min="0.25"
                      max="2160"
                      step="0.25"
                      placeholder="Automatic"
                      value={value.stageHours?.[s] ?? ''}
                      onChange={(e) => {
                        const next = { ...(value.stageHours ?? {}) };
                        if (e.target.value === '') delete next[s];
                        else next[s] = Number(e.target.value);
                        onChange({ ...value, stageHours: next });
                      }}
                    />
                  </label>
                ))}
            </div>
          </fieldset>
          <fieldset className="stage-hours">
            <legend>{w('Workflows')}</legend>
            <p className="muted">
              {w(
                'Different kinds of work can follow their own stages, each with its own time: a logo (Design, Approval, Delivered), a paper bag (Design, Printing, Lamination, Cutting, Gumming, Packaging). Choose a workflow on each item; everything else uses the stages above.',
              )}
            </p>
            {(value.workflows ?? []).map((wf, i) => {
              const setWf = (patch: Partial<typeof wf>) =>
                onChange({
                  ...value,
                  workflows: value.workflows.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                });
              const stages = wf.stages.map((st) => st.trim()).filter(Boolean);
              return (
                <div key={wf.id} className="workflow-row">
                  <div className="form-grid">
                    <label>
                      {w('Workflow name')}
                      <input
                        aria-label={`Workflow ${i + 1} name`}
                        maxLength={60}
                        value={wf.name}
                        onChange={(e) => setWf({ name: e.target.value })}
                      />
                    </label>
                    <label>
                      {w('Stages')}
                      <textarea
                        aria-label={`Workflow ${i + 1} stages`}
                        rows={Math.max(5, wf.stages.length + 1)}
                        value={wf.stages.join('\n')}
                        onChange={(e) => setWf({ stages: e.target.value.split('\n') })}
                      />
                      <small>{w('One per line. Keep Added first, and Completed then Collected last.')}</small>
                    </label>
                  </div>
                  <div className="form-grid">
                    {stages
                      .filter((st) => !['Completed', 'Collected'].includes(st))
                      .map((st) => (
                        <label key={st}>
                          {stage(st)} (hours)
                          <input
                            aria-label={`${wf.name || 'Workflow'} ${stage(st)} hours`}
                            type="number"
                            min="0.25"
                            max="2160"
                            step="0.25"
                            placeholder="Automatic"
                            value={wf.hours?.[st] ?? ''}
                            onChange={(e) => {
                              const hours = { ...(wf.hours ?? {}) };
                              if (e.target.value === '') delete hours[st];
                              else hours[st] = Number(e.target.value);
                              setWf({ hours });
                            }}
                          />
                        </label>
                      ))}
                  </div>
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() =>
                      onChange({ ...value, workflows: value.workflows.filter((_, j) => j !== i) })
                    }
                  >
                    Remove workflow
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="secondary"
              disabled={(value.workflows?.length ?? 0) >= 30}
              onClick={() =>
                onChange({
                  ...value,
                  workflows: [
                    ...(value.workflows ?? []),
                    {
                      id: crypto.randomUUID(),
                      name: '',
                      stages: ['Added', 'Design', 'Approval', 'Completed', 'Collected'],
                      hours: {},
                    },
                  ],
                })
              }
            >
              <Icon name="add" /> {w('Add workflow')}
            </button>
            <small className="muted">
              {w('Jobs keep the workflow they were sold with; changes apply to new jobs.')}
            </small>
          </fieldset>
        </>
      )}
      {saveControl}
    </fieldset>
  );
}
