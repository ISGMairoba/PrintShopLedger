import { useState } from 'react';
import Icon from './Icon';
import { useWords } from './Words';
import { useBusinessOptions } from './BusinessOptionsContext';
import {
  FIXED_END,
  FIXED_START,
  UNITS,
  byRatio,
  fallbackName,
  fallbackSteps,
  shareSteps,
  sharesFromWeights,
  stepAmount,
  turnaroundMinutes,
} from './workflow-steps.mjs';
import type { Step } from './types';

const unitNames = { m: 'minutes', h: 'hours', d: 'days' } as const;
type Unit = keyof typeof unitNames;

/**
 * A workflow drawn as boxes stacked from top to bottom: Added first, Completed then Collected last
 * (locked), and the steps between, each with a name and an optional time. An empty time shares
 * the time to the due date evenly. Or timed by ratio: each step gets a share (%) of the time to the
 * due date, else of the usual turnaround.
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
  const ratio = byRatio(steps);
  // The usual turnaround, kept while shares are typed (the steps' minutes follow it).
  const [turn, setTurn] = useState(() => {
    const minutes = turnaroundMinutes(steps);
    const unit = (steps[0]?.unit ?? 'd') as Unit;
    return { amount: minutes ? String(minutes / UNITS[unit]) : '', unit };
  });
  const turnMinutes = (t: { amount: string; unit: Unit }) => {
    const n = Number(t.amount);
    return t.amount !== '' && n > 0 ? n * UNITS[t.unit] : 0;
  };
  const spread = (next: Step[], t = turn) => onChange(shareSteps(next, turnMinutes(t), t.unit) as Step[]);
  const setMode = (mode: string) => {
    if (mode === 'ratio') {
      // Shares start from the step times when every step has one, else even shares.
      const times = steps.map((s) => s.minutes ?? 0);
      const timed = times.every((m) => m > 0);
      const start = sharesFromWeights(timed ? times : steps.map(() => 1));
      const total = timed ? times.reduce((a, b) => a + b, 0) : 0;
      const t = { amount: total ? String(total / UNITS.d) : '', unit: 'd' as Unit };
      setTurn(t);
      spread(
        steps.map((s, i) => ({ ...s, share: start[i] })),
        t,
      );
    } else onChange(steps.map(({ share: _s, minutes: _m, unit: _u, ...s }) => s));
  };
  const share = (i: number, typed: string) =>
    spread(steps.map((s, j) => (j === i ? { ...s, share: Number(typed) || 0.01 } : s)));
  const totalShare = Math.round(steps.reduce((sum, s) => sum + (Number(s.share) || 0), 0) * 100) / 100;
  const set = (i: number, patch: Partial<Step>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const time = (i: number, amount: string, unit: Unit) => {
    const n = Number(amount);
    set(
      i,
      amount === '' || !(n > 0)
        ? { minutes: undefined, unit }
        : { minutes: Math.max(1, Math.round(n * UNITS[unit])), unit },
    );
  };
  const fixed = (name: string) => (
    <li key={name} className="step-box step-fixed">
      <span className="step-name">{stage(name)}</span>
      <small className="muted">Always</small>
    </li>
  );
  return (
    <>
      <div className="step-timing">
        <label>
          Time each step by
          <select
            aria-label={`${label}: time each step by`}
            value={ratio ? 'ratio' : 'time'}
            disabled={disabled}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="time">Its own time</option>
            <option value="ratio">Ratio (a share of the job's time)</option>
          </select>
        </label>
        {ratio && (
          <>
            <label>
              Usual turnaround
              <span className="step-time">
                <input
                  aria-label={`${label}: usual turnaround`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="None"
                  value={turn.amount}
                  disabled={disabled}
                  onChange={(e) => {
                    const t = { ...turn, amount: e.target.value };
                    setTurn(t);
                    spread(steps, t);
                  }}
                />
                <select
                  aria-label={`${label}: usual turnaround unit`}
                  value={turn.unit}
                  disabled={disabled}
                  onChange={(e) => {
                    const t = { ...turn, unit: e.target.value as Unit };
                    setTurn(t);
                    spread(steps, t);
                  }}
                >
                  {(Object.keys(unitNames) as Unit[]).map((u) => (
                    <option key={u} value={u}>
                      {unitNames[u]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <small className={totalShare === 100 ? 'muted' : 'notice'} role="status">
              Shares add up to {totalShare}%.
              {totalShare !== 100 && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      const shares = sharesFromWeights(steps.map((s) => Number(s.share) || 0));
                      spread(steps.map((s, i) => ({ ...s, share: shares[i] ?? 0.01 })));
                    }}
                  >
                    Make them 100%
                  </button>
                </>
              )}{' '}
              Each step gets its share of the time to the due date, else of the usual turnaround (none: no
              time limit). Typing 1, 2, 1 then “Make them 100%” gives 25%, 50%, 25%.
            </small>
          </>
        )}
      </div>
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
              {ratio ? (
                <span className="step-time">
                  <input
                    aria-label={`${label}: ${step.name || `step ${i + 1}`} share`}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={step.share ?? ''}
                    disabled={disabled}
                    onChange={(e) => share(i, e.target.value)}
                  />
                  <span className="muted">%</span>
                </span>
              ) : (
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
              )}
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
                  onClick={() => (ratio ? spread : onChange)(steps.filter((_, j) => j !== i))}
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
            onClick={() =>
              ratio ? spread([...steps, { name: '', share: 0.01 }]) : onChange([...steps, { name: '' }])
            }
          >
            <Icon name="add" /> Add step
          </button>
        </li>
        {FIXED_END.map(fixed)}
      </ol>
    </>
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
  kind = '',
}: {
  value: Step[] | undefined;
  onChange: (steps: Step[] | undefined) => void;
  disabled?: boolean;
  /** 'service' or 'shelf': which of the business's usual steps this item follows. */
  kind?: '' | 'service' | 'shelf';
}) {
  const options = useBusinessOptions();
  const { w, stage } = useWords();
  const saved = options.workflows ?? [];
  const usual = { name: fallbackName(options, kind) || undefined };
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
            else if (id === 'own') onChange(fallbackSteps(options, kind).map((s) => ({ ...s })));
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
          {fallbackSteps(options, kind)
            .map((s) => stage(s.name))
            .join(', ')}
          . {w('Change them here to give this item its own.')}
        </p>
      )}
    </fieldset>
  );
}
