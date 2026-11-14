import Icon from './Icon';
import { useWords } from './Words';
import { checkDraft, checkLines, lineOptions } from './material-check.mjs';
import type { Job, Ledger } from './types';

export type CheckDraft = { line: string; materialId: string; quantity: string }[];

export const checkDraftFor = (ledger: Ledger, job: Job): CheckDraft => checkDraft(ledger, job);

/** The usages to save, or an error for the person to fix. */
export function checkUsagesFrom(draft: CheckDraft) {
  const usages = draft.map((row) => ({
    line: row.line,
    materialId: row.materialId,
    quantity: Number(row.quantity),
  }));
  if (!usages.length || usages.some((u) => !u.materialId || !(u.quantity >= 0) || Number.isNaN(u.quantity)))
    throw Error('Enter how much of each material was used.');
  if (new Set(usages.map((u) => `${u.line}|${u.materialId}`)).size !== usages.length)
    throw Error('Choose each material once per line. To use more of one, raise its amount.');
  return usages;
}

/**
 * "Materials used" in production: one block per line the job took (or is to take), starting at the
 * calculated amount. Change the amount, swap the material (same unit), or split it across several.
 */
export default function MaterialCheckFields({
  ledger,
  job,
  value,
  onChange,
  level,
  compact = false,
}: {
  ledger: Ledger;
  job: Job;
  value: CheckDraft;
  onChange: (next: CheckDraft) => void;
  /** The person's access level: below Admin, the check goes for approval. */
  level: number;
  compact?: boolean;
}) {
  const { w } = useWords();
  const lines = checkLines(ledger, job);
  const set = (index: number, patch: Partial<CheckDraft[number]>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className={`material-check${compact ? ' compact' : ''}`}>
      <legend>{w('Materials used')}</legend>
      {!compact && (
        <p className="muted">
          {w(
            'Each line starts at the calculated amount. Confirm it, enter what was really used, or split it across materials.',
          )}{' '}
          {level >= 2
            ? w('Stock moves by the difference when you save.')
            : w('An Admin approves these amounts; stock moves then.')}
        </p>
      )}
      {lines.map((line) => {
        const options = lineOptions(ledger, line);
        const rows = value.map((r, index) => ({ r, index })).filter(({ r }) => r.line === line.key);
        const used = rows.reduce((n, { r }) => n + (Number(r.quantity) || 0), 0);
        return (
          <div className="material-check-line" key={line.key}>
            <p className="material-check-head">
              <strong>{line.name}</strong>
              <span>
                {w('Calculated')} {line.expected} {line.unit}
                {Math.round(used * 1000) / 1000 !== line.expected && (
                  <>
                    {' '}
                    · {w('entered')} {Math.round(used * 1000) / 1000}
                  </>
                )}
              </span>
            </p>
            {rows.map(({ r, index }) => (
              <div className="material-check-row" key={index}>
                <select
                  aria-label={`${line.name}: material`}
                  value={r.materialId}
                  onChange={(e) => set(index, { materialId: e.target.value })}
                >
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.available} in stock
                    </option>
                  ))}
                </select>
                <span className="input-with-unit">
                  <input
                    aria-label={`${line.name}: amount used`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    required
                    value={r.quantity}
                    onChange={(e) => set(index, { quantity: e.target.value })}
                  />
                  <span>{line.unit}</span>
                </span>
                <button
                  type="button"
                  className="secondary icon-button"
                  aria-label={`Remove ${options.find((m) => m.id === r.materialId)?.name ?? 'material'}`}
                  title="Remove"
                  disabled={rows.length <= 1}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
            {rows.length < options.length && (
              <button
                type="button"
                className="text-button self-start"
                onClick={() =>
                  onChange([
                    ...value,
                    {
                      line: line.key,
                      materialId: options.find((m) => !rows.some(({ r }) => r.materialId === m.id))!.id,
                      quantity: '',
                    },
                  ])
                }
              >
                <Icon name="add" /> {w('Split with another material')}
              </button>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
