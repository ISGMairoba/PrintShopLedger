import Icon from './Icon';
import { useWords } from './Words';
import { suggestedUsage } from './material-choice.mjs';
import type { Job, Ledger } from './types';

export type UsageDraft = { materialId: string; quantity: string }[];

/** A first suggestion: the planned (or first) material, and the job's size in material units. */
export function usageDraft(job: Job): UsageDraft {
  const choice = job.materialChoice!;
  return [
    { materialId: choice.plannedMaterialId ?? choice.options[0], quantity: String(suggestedUsage(job)) },
  ];
}

/** The usages to save, or an error for the person to fix. */
export function usagesFrom(draft: UsageDraft) {
  const usages = draft.map((row) => ({ materialId: row.materialId, quantity: Number(row.quantity) }));
  if (!usages.length || usages.some((u) => !u.materialId || !(u.quantity > 0)))
    throw Error('Enter how much of each material was used.');
  if (new Set(usages.map((u) => u.materialId)).size !== usages.length)
    throw Error('Choose each material once. To use more of one, raise its amount.');
  return usages;
}

/**
 * "What was used?" for a job with a choice of materials: one or more of its linked materials and
 * how much of each. Stock is taken when the move is saved.
 */
export default function MaterialUsedFields({
  ledger,
  job,
  value,
  onChange,
  compact = false,
}: {
  ledger: Ledger;
  job: Job;
  value: UsageDraft;
  onChange: (next: UsageDraft) => void;
  compact?: boolean;
}) {
  const { w } = useWords();
  const choice = job.materialChoice!;
  const options = choice.options.map((id) => ledger.materials.find((m) => m.id === id)).filter(Boolean);
  const unit = options[0]?.measurementUnit ?? '';
  const set = (index: number, patch: Partial<UsageDraft[number]>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className={`material-used${compact ? ' compact' : ''}`}>
      <legend>{w('Material used')}</legend>
      {!compact && (
        <p className="muted">
          {w('No stock was taken at the sale. Choose what was really used and how much.')} {w('The job is')}{' '}
          {choice.work} {unit}
          {'; '}
          {w('if one material ran out, add the other.')}
        </p>
      )}
      {value.map((row, index) => {
        const material = ledger.materials.find((m) => m.id === row.materialId);
        return (
          <div className="material-used-row" key={index}>
            <label>
              {w('Material')}
              <select
                aria-label={`Material used ${index + 1}`}
                value={row.materialId}
                onChange={(e) => set(index, { materialId: e.target.value })}
              >
                {options.map((m) => (
                  <option key={m!.id} value={m!.id}>
                    {m!.name} · {m!.available} {m!.measurementUnit} in stock
                  </option>
                ))}
              </select>
            </label>
            <label>
              {w('Amount used')} ({material?.measurementUnit ?? unit})
              <input
                aria-label={`Amount used ${index + 1}`}
                type="number"
                min="0.001"
                step="0.001"
                required
                value={row.quantity}
                onChange={(e) => set(index, { quantity: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="secondary"
              aria-label={`Remove material ${index + 1}`}
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
      {value.length < options.length && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange([
              ...value,
              {
                materialId: options.find((m) => !value.some((r) => r.materialId === m!.id))!.id,
                quantity: '',
              },
            ])
          }
        >
          <Icon name="add" /> {w('Add another material')}
        </button>
      )}
    </fieldset>
  );
}
