import Icon from './Icon';
import { useWords } from './Words';
import { choiceGroups, suggestedUsage } from './material-choice.mjs';
import type { Job, Ledger } from './types';

/** group: which item the row is for (a template job with several items with a choice of materials). */
export type UsageDraft = { materialId: string; quantity: string; group?: number }[];

/** A first suggestion: the planned (or first) material of each item, and its size in material units. */
export function usageDraft(job: Job): UsageDraft {
  const choice = job.materialChoice!;
  if (!choice.groups)
    return [
      { materialId: choice.plannedMaterialId ?? choice.options[0], quantity: String(suggestedUsage(job)) },
    ];
  return choice.groups.map((g, group) => ({ materialId: g.options[0], quantity: String(g.work), group }));
}

/** The usages to save, or an error for the person to fix. */
export function usagesFrom(draft: UsageDraft) {
  const usages = draft.map((row) => ({
    materialId: row.materialId,
    quantity: Number(row.quantity),
    ...(row.group !== undefined ? { group: row.group } : {}),
  }));
  if (!usages.length || usages.some((u) => !u.materialId || !(u.quantity > 0)))
    throw Error('Enter how much of each material was used.');
  if (new Set(usages.map((u) => `${u.group ?? ''}:${u.materialId}`)).size !== usages.length)
    throw Error('Choose each material once. To use more of one, raise its amount.');
  return usages;
}

/**
 * "What was used?" for a job with a choice of materials: one or more of its linked materials and
 * how much of each. A template job using several such items asks for each item separately.
 * Stock is taken when the move is saved.
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
  const groups = choiceGroups(job);
  const several = groups.length > 1;
  const set = (index: number, patch: Partial<UsageDraft[number]>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  let row = 0; // numbers the rows across items, for labels
  return (
    <fieldset className={`material-used${compact ? ' compact' : ''}`}>
      <legend>{w('Material used')}</legend>
      {!compact && (
        <p className="muted">
          {w('No stock was taken at the sale. Choose what was really used and how much.')}{' '}
          {several
            ? w('Confirm each item below; ')
            : `${w('The job is')} ${groups[0]?.work} ${groupUnit(ledger, groups[0])}; `}
          {w('if one material ran out, add the other.')}
        </p>
      )}
      {groups.map((group, g) => {
        const options = group.options.map((id) => ledger.materials.find((m) => m.id === id)).filter(Boolean);
        const unit = groupUnit(ledger, group);
        const rows = value
          .map((r, index) => ({ r, index }))
          .filter(({ r }) => (several ? r.group === g : true));
        return (
          <div className="material-used-group" key={g}>
            {several && (
              <p className="material-used-item">
                <strong>{group.name}</strong> · {w('about')} {group.work} {unit}
              </p>
            )}
            {rows.map(({ r, index }) => {
              const n = ++row;
              const material = ledger.materials.find((m) => m.id === r.materialId);
              return (
                <div className="material-used-row" key={index}>
                  <label>
                    {w('Material')}
                    <select
                      aria-label={`Material used ${n}`}
                      value={r.materialId}
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
                      aria-label={`Amount used ${n}`}
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                      value={r.quantity}
                      onChange={(e) => set(index, { quantity: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Remove material ${n}`}
                    disabled={rows.length <= 1}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              );
            })}
            {rows.length < options.length && (
              <button
                type="button"
                className="secondary"
                aria-label={several ? `Add another material for ${group.name}` : undefined}
                onClick={() =>
                  onChange([
                    ...value,
                    {
                      materialId: options.find((m) => !rows.some(({ r }) => r.materialId === m!.id))!.id,
                      quantity: '',
                      ...(several ? { group: g } : {}),
                    },
                  ])
                }
              >
                <Icon name="add" /> {w('Add another material')}
              </button>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** The unit an item's materials are measured in. */
function groupUnit(ledger: Ledger, group: { options: string[]; unit: string | null } | undefined) {
  if (!group) return '';
  return group.unit ?? ledger.materials.find((m) => m.id === group.options[0])?.measurementUnit ?? '';
}
