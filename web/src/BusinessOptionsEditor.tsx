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
}: {
  value: Options;
  onChange: (value: Options) => void;
  disabled: boolean;
  saveControl?: ReactNode;
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
      <legend>{w('Dropdowns & job workflow')}</legend>
      <p>
        {w(
          'Changes apply to new entries. Saved payments and existing jobs keep their original details and stage order.',
        )}
      </p>
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
      {saveControl}
    </fieldset>
  );
}
