import { useTeam } from './TeamContext';
import { equalShares, sharesProblem, teamPeople } from './team.mjs';
import type { Job, WorkShare } from './types';

/** What the "Done by" step records for a stage move (team.mjs workEvents). */
export interface WorkDraft {
  personIds: string[];
  unit: 'percent' | 'quantity';
  /** Each person's share as typed (percent or quantity); empty: split equally (percent). */
  shares: Record<string, string>;
  /** Done at, as a datetime-local value; empty: now. */
  doneAt: string;
  redo: boolean;
  redoBy: string;
  redoNote: string;
  vendor: boolean;
  vendorName: string;
  vendorCost: string;
}
export const workDraft = (personIds: string[]): WorkDraft => ({
  personIds,
  unit: 'percent',
  shares: {},
  doneAt: '',
  redo: false,
  redoBy: '',
  redoNote: '',
  vendor: false,
  vendorName: '',
  vendorCost: '',
});
const localInput = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
/** The shares a draft gives (equal percents when none are typed). */
export function draftShares(draft: WorkDraft): WorkShare[] {
  if (draft.vendor) return [];
  const typed = draft.personIds.some((id) => (draft.shares[id] ?? '').trim());
  if (draft.unit === 'percent' && !typed) return equalShares(draft.personIds);
  return draft.personIds.map((personId) => ({ personId, share: Number(draft.shares[personId] || 0) }));
}
/**
 * The work to record from a draft, or a problem with it. stageStart: when the job entered the
 * stage being finished (Done at cannot be before it).
 */
export function draftWork(
  draft: WorkDraft,
  job: Job,
  stageStart: string | undefined,
  days: number,
): { work?: Record<string, any>; problem?: string } {
  const shares = draftShares(draft);
  if (draft.vendor) {
    if (!draft.vendorName.trim()) return { problem: "Enter the outside vendor's name." };
    if (!(Number(draft.vendorCost) >= 0) || draft.vendorCost.trim() === '')
      return { problem: "Enter the vendor's cost (0 when none)." };
  } else {
    const problem = sharesProblem(shares, draft.unit, job.quantity ?? 0);
    if (problem) return { problem };
  }
  let doneAt = new Date().toISOString();
  if (draft.doneAt) {
    const at = new Date(draft.doneAt);
    if (Number.isNaN(at.getTime())) return { problem: 'Enter when the work was done.' };
    if (at.getTime() > Date.now() + 5 * 60000) return { problem: 'Done at cannot be in the future.' };
    if (at.getTime() < Date.now() - days * 86400000)
      return { problem: `Done at can be at most ${days} days back.` };
    if (stageStart && at.getTime() < Date.parse(stageStart) - 60000)
      return { problem: 'Done at cannot be before the stage started.' };
    doneAt = at.toISOString();
  }
  return {
    work: {
      unit: draft.vendor ? 'percent' : draft.unit,
      shares,
      doneAt,
      ...(draft.redo ? { redo: { responsibleId: draft.redoBy || null, note: draft.redoNote.trim() } } : {}),
      ...(draft.vendor
        ? { vendor: { name: draft.vendorName.trim(), cost: Math.round(Number(draft.vendorCost) * 100) } }
        : {}),
    },
  };
}

/** The "Done by" step of a stage move: who did it (with shares), when, redo and outside work. */
export default function DoneByFields({
  job,
  stage,
  value,
  onChange,
}: {
  job: Job;
  /** The stage being finished. */
  stage: string;
  value: WorkDraft;
  onChange: (next: WorkDraft) => void;
}) {
  const team = useTeam();
  if (!team) return null;
  const people = teamPeople(team.ledger);
  const level = team.actor.level;
  const othersAllowed = level >= team.settings.othersRank;
  const earlierAllowed = level >= team.settings.earlierRank;
  const set = (patch: Partial<WorkDraft>) => onChange({ ...value, ...patch });
  const choosable = othersAllowed ? people : people.filter((p) => p.id === team.actor.id);
  const toggle = (id: string, on: boolean) =>
    set({ personIds: on ? [...value.personIds, id] : value.personIds.filter((p) => p !== id) });
  const shown = draftShares(value);
  return (
    <fieldset className="done-by">
      <legend>Done by ({stage})</legend>
      <label className="check-label">
        <input type="checkbox" checked={value.vendor} onChange={(e) => set({ vendor: e.target.checked })} />
        <span>Done by an outside vendor</span>
      </label>
      {value.vendor ? (
        <>
          <label>
            Vendor
            <input
              aria-label="Vendor"
              maxLength={120}
              value={value.vendorName}
              onChange={(e) => set({ vendorName: e.target.value })}
            />
          </label>
          <label>
            Vendor&apos;s cost (₦)
            <input
              aria-label="Vendor's cost"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={value.vendorCost}
              onChange={(e) => set({ vendorCost: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <div className="page-limit-list">
            {choosable.map((p) => (
              <label key={p.id} className="check-label">
                <input
                  type="checkbox"
                  aria-label={`Done by ${p.name}`}
                  checked={value.personIds.includes(p.id)}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                />
                {p.name}
                {p.role ? <small className="muted"> {p.role}</small> : null}
              </label>
            ))}
          </div>
          {!othersAllowed && (
            <p className="muted">You record your own work; an Admin can record work for others.</p>
          )}
          {value.personIds.length > 1 && (
            <>
              <label>
                Shares
                <select
                  aria-label="Shares"
                  value={value.unit}
                  onChange={(e) => set({ unit: e.target.value as WorkDraft['unit'], shares: {} })}
                >
                  <option value="percent">Percent (split equally unless changed)</option>
                  <option value="quantity">Quantity{job.quantity ? ` (of ${job.quantity})` : ''}</option>
                </select>
              </label>
              {value.personIds.map((id) => (
                <label key={id}>
                  {people.find((p) => p.id === id)?.name ?? 'Someone'} (
                  {value.unit === 'percent' ? '%' : 'qty'})
                  <input
                    aria-label={`Share for ${people.find((p) => p.id === id)?.name ?? 'someone'}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder={
                      value.unit === 'percent'
                        ? String(shown.find((s) => s.personId === id)?.share ?? '')
                        : ''
                    }
                    value={value.shares[id] ?? ''}
                    onChange={(e) => set({ shares: { ...value.shares, [id]: e.target.value } })}
                  />
                </label>
              ))}
            </>
          )}
        </>
      )}
      <label>
        Done at
        <input
          aria-label="Done at"
          type="datetime-local"
          disabled={!earlierAllowed}
          max={localInput(new Date())}
          min={localInput(new Date(Date.now() - team.settings.doneAtDays * 86400000))}
          value={value.doneAt}
          onChange={(e) => set({ doneAt: e.target.value })}
        />
        <small className="muted">
          {earlierAllowed ? 'Leave empty for now. ' : 'Now. '}It is recorded at the time you save, whatever
          you enter here.
        </small>
      </label>
      <label className="check-label">
        <input type="checkbox" checked={value.redo} onChange={(e) => set({ redo: e.target.checked })} />
        <span>This is a redo</span>
      </label>
      {value.redo && (
        <>
          <label>
            Who was responsible
            <select
              aria-label="Who was responsible"
              value={value.redoBy}
              onChange={(e) => set({ redoBy: e.target.value })}
            >
              <option value="">Not known</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            What went wrong (optional)
            <input
              aria-label="What went wrong"
              maxLength={300}
              value={value.redoNote}
              onChange={(e) => set({ redoNote: e.target.value })}
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
