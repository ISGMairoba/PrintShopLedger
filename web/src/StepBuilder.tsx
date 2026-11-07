import Icon from './Icon';
import { useWords } from './Words';
import { useBusinessOptions } from './BusinessOptionsContext';
import { FIXED_END, FIXED_START, UNITS, fallbackSteps, stepAmount } from './workflow-steps.mjs';
import type { Step } from './types';

const unitNames = { m: 'minutes', h: 'hours', d: 'days' } as const;
type Unit = keyof typeof unitNames;

/**
 * A workflow drawn as boxes stacked from top to bottom: Added first, Completed then Collected last
 * (locked), and the steps between, each with a name and an optional time. An empty time shares
 * the time to the due date evenly.
 */
export function StepBuilder({
  steps,
  onChange,
  label,
  disabled,
}: {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  label: string;
  disabled?: boolean;
}) {
  const { stage } = useWords();
  const set = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const time = (i: number, amount: string, unit: Unit) => {
    const n = Number(amount);
    set(i, amount === '' || !(n > 0) ? { minutes: undefined, unit } : { minutes: Math.max(1, Math.round(n * UNITS[unit])), unit });
  };
  const fixed = (name: string) => (
    <li key={name} className="step-box step-fixed">
      <span className="step-name">{stage(name)}</span>
      <small className="muted">Always</small>
    </li>
  );
  return (
    <ol className="step-builder" aria-label={label}>
      {FIXED_START.map(fixed)}
      {steps.map((step, i) => {
        const unit = (step.unit ?? 'h') as Unit;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps are edited in place and have no ids
          <li key={i} className="step-box">
            <input
              aria-label={`${label}: step ${i + 1} name`}
              className="step-name"
              maxLength={40}
              placeholder="Step name"
              value={step.name}
              disabled={disabled}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <span className="step-time">
              <input
                aria-label={`${label}: ${step.name || `step ${i + 1}`} time`}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="Auto"
                value={stepAmount(step)}
                disabled={disabled}
                onChange={(e) => time(i, e.target.value, unit)}
              />
              <select
                aria-label={`${label}: ${step.name || `step ${i + 1}`} unit`}
                value={unit}
                disabled={disabled}
                onChange={(e) => time(i, String(stepAmount(step)), e.target.value as Unit)}
              >
                {(Object.keys(unitNames) as Unit[]).map((u) => (
                  <option key={u} value={u}>
                    {unitNames[u]}
                  </option>
                ))}
              </select>
            </span>
            <span className="step-actions">
              <button
                type="button"
                className="step-button"
                aria-label={`Move ${step.name || `step ${i + 1}`} up`}
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="step-button"
                aria-label={`Move ${step.name || `step ${i + 1}`} down`}
                disabled={disabled || i === steps.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="step-button"
                aria-label={`Remove ${step.name || `step ${i + 1}`}`}
                disabled={disabled || steps.length < 2}
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              >
                <Icon name="close" />
              </button>
            </span>
          </li>
        );
      })}
      <li className="step-add">
        <button
          type="button"
          className="text-button"
          disabled={disabled || steps.length >= 20}
          onClick={() => onChange([...steps, { name: '' }])}
        >
          <Icon name="add" /> Add step
        </button>
      </li>
      {FIXED_END.map(fixed)}
    </ol>
  );
}

/**
 * An item's steps: the business's usual ones until changed here. "Start from" copies a saved
 * workflow, which the item then keeps as its own (later changes to the saved one don't reach it).
 */
export function ItemSteps({
  value,
  onChange,
  disabled,
}: {
  value: Step[] | undefined;
  onChange: (steps: Step[] | undefined) => void;
  disabled?: boolean;
}) {
  const options = useBusinessOptions();
  const { w, stage } = useWords();
  const saved = options.workflows ?? [];
  const usual = saved.find((wf) => wf.id === options.defaultWorkflowId);
  return (
    <fieldset className="stage-hours">
      <legend>{w('Production steps')}</legend>
      <label>
        {value ? 'Start again from' : 'Steps'}
        <select
          aria-label="Start from"
          value=""
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value;
            if (id === 'usual') onChange(undefined);
            else if (id === 'own') onChange(fallbackSteps(options).map((s) => ({ ...s })));
            else {
              const wf = saved.find((x) => x.id === id);
              if (wf) onChange(wf.steps.map((s) => ({ ...s })));
            }
            e.target.value = '';
          }}
        >
          <option value="">{value ? 'Choose…' : `The usual steps (${usual?.name ?? 'Processing'})`}</option>
          {value && <option value="usual">The usual steps ({usual?.name ?? 'Processing'})</option>}
          {!value && <option value="own">Change the steps for this item</option>}
          {saved.map((wf) => (
            <option key={wf.id} value={wf.id}>
              Copy “{wf.name}”
            </option>
          ))}
        </select>
      </label>
      {value ? (
        <StepBuilder steps={value} onChange={onChange} label="Production steps" disabled={disabled} />
      ) : (
        <p className="muted">
          {w('Jobs for this item follow the usual steps')}:{' '}
          {fallbackSteps(options)
            .map((s) => stage(s.name))
            .join(', ')}
          . {w('Change them here to give this item its own.')}
        </p>
      )}
    </fieldset>
  );
}
