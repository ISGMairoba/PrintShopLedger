import { useTeam } from './TeamContext';
import { equalShares, sharesProblem, teamPeople } from './team.mjs';
import { usePaidFromOptions } from './paid-from';

/** The payee a vendor name means (same name, ignoring case). */
export const vendorPayee = (ledger: Ledger, name: string) =>
  (ledger.payees ?? []).find((p) => !p.archived && p.name.trim().toLowerCase() === name.trim().toLowerCase());
import type { Job, Ledger, WorkRecord, WorkShare } from './types';

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
  /** The vendor's share next to the Team's (percent or quantity); empty: the rest. */
  vendorShare: string;
  /** Paying the vendor: '' not paid yet (owed), else a Paid from key (paid-from.ts). */
  vendorPaidFrom: string;
  /** A corrected record keeps its vendor's payee and expense. */
  vendorLink?: { payeeId?: string; expenseId?: string };
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
  vendorShare: '',
  vendorPaidFrom: '',
});
/** A draft holding a work record's Done by, to correct it. */
export function draftFrom(record: WorkRecord): WorkDraft {
  return {
    personIds: record.shares.map((s) => s.personId),
    unit: record.unit,
    shares: Object.fromEntries(record.shares.map((s) => [s.personId, String(s.share)])),
    doneAt: localInput(new Date(record.doneAt)),
    redo: !!record.redo,
    redoBy: record.redo?.responsibleId ?? '',
    redoNote: record.redo?.note ?? '',
    vendor: !!record.vendor,
    vendorName: record.vendor?.name ?? '',
    vendorCost: record.vendor ? String(record.vendor.cost / 100) : '',
    vendorShare: record.vendor?.share !== undefined ? String(record.vendor.share) : '',
    vendorPaidFrom: '',
    vendorLink: { payeeId: record.vendor?.payeeId, expenseId: record.vendor?.expenseId },
  };
}
const localInput = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
const VENDOR = '__vendor';
/** The shares a draft gives (equal percents when none are typed; a vendor next to the Team counts too). */
export function draftShares(draft: WorkDraft): WorkShare[] {
  const typed =
    draft.personIds.some((id) => (draft.shares[id] ?? '').trim()) || (draft.vendor && draft.vendorShare.trim());
  if (draft.unit === 'percent' && !typed)
    return equalShares([...draft.personIds, ...(draft.vendor && draft.personIds.length ? [VENDOR] : [])]).filter(
      (s: WorkShare) => s.personId !== VENDOR,
    );
  return draft.personIds.map((personId) => ({ personId, share: Number(draft.shares[personId] || 0) }));
}
/** The vendor's share when it works next to the Team (undefined: it did the whole stage). */
export function draftVendorShare(draft: WorkDraft, quantity: number): number | undefined {
  if (!draft.vendor || !draft.personIds.length) return undefined;
  if (draft.vendorShare.trim()) return Number(draft.vendorShare);
  const team = draftShares(draft).reduce((n, s) => n + Number(s.share), 0);
  const rest = draft.unit === 'percent' ? Math.round((100 - team) * 100) / 100 : quantity - team;
  return rest > 0 ? rest : 0;
}
/**
 * The work to record from a draft, or a problem with it. stageStart: when the job was taken (Done at
 * cannot be before it; the app is often updated after the work, so not the stage's own start).
 */
export function draftWork(
  draft: WorkDraft,
  job: Job,
  stageStart: string | undefined,
  days: number,
): { work?: Record<string, any>; problem?: string } {
  const shares = draftShares(draft);
  const vendorShare = draftVendorShare(draft, job.quantity ?? 0);
  if (draft.vendor) {
    if (!draft.vendorName.trim()) return { problem: "Enter the outside vendor's name." };
    if (!(Number(draft.vendorCost) >= 0) || draft.vendorCost.trim() === '')
      return { problem: "Enter the vendor's cost (0 when none)." };
  }
  if (!draft.vendor || shares.length) {
    const problem = sharesProblem(
      [...shares, ...(vendorShare !== undefined ? [{ personId: VENDOR, share: vendorShare }] : [])],
      draft.unit,
      job.quantity ?? 0,
    );
    if (problem) return { problem };
  }
  let doneAt = new Date().toISOString();
  if (draft.doneAt) {
    const at = new Date(draft.doneAt);
    if (Number.isNaN(at.getTime())) return { problem: 'Enter when the work was done.' };
    if (at.getTime() > Date.now() + 5 * 60000) return { problem: 'Done at cannot be in the future.' };
    if (at.getTime() < Date.now() - days * 86400000)
      return { problem: `Done at can be at most ${days} days back.` };
    // The app is often brought up to date after the work: only the job itself must be older.
    if (stageStart && at.getTime() < Date.parse(stageStart) - 60000)
      return { problem: 'Done at cannot be before the job was taken.' };
    doneAt = at.toISOString();
  }
  return {
    work: {
      unit: draft.vendor && !shares.length ? 'percent' : draft.unit,
      shares,
      doneAt,
      ...(draft.redo ? { redo: { responsibleId: draft.redoBy || null, note: draft.redoNote.trim() } } : {}),
      ...(draft.vendor
        ? {
            vendor: {
              name: draft.vendorName.trim(),
              cost: Math.round(Number(draft.vendorCost) * 100),
              ...(vendorShare !== undefined ? { share: vendorShare } : {}),
              ...(draft.vendorLink?.payeeId ? { payeeId: draft.vendorLink.payeeId } : {}),
              ...(draft.vendorLink?.expenseId ? { expenseId: draft.vendorLink.expenseId } : {}),
            },
          }
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
  correcting = false,
  expense = false,
}: {
  /** The vendor's cost is saved as an expense for the job (whoever moves the stage can record expenses). */
  expense?: boolean;
  /** Correcting a record: anyone on the Team can be chosen and any Done at entered (the server decides). */
  correcting?: boolean;
  job: Job;
  /** The stage being finished. */
  stage: string;
  value: WorkDraft;
  onChange: (next: WorkDraft) => void;
}) {
  const team = useTeam();
  const paidFrom = usePaidFromOptions(team?.ledger.moneyAccounts ?? []);
  if (!team) return null;
  const people = teamPeople(team.ledger);
  const level = team.actor.level;
  const othersAllowed = correcting || level >= team.settings.othersRank;
  const earlierAllowed = correcting || level >= team.settings.earlierRank;
  const set = (patch: Partial<WorkDraft>) => onChange({ ...value, ...patch });
  const choosable = othersAllowed ? people : people.filter((p) => p.id === team.actor.id);
  const toggle = (id: string, on: boolean) =>
    set({ personIds: on ? [...value.personIds, id] : value.personIds.filter((p) => p !== id) });
  const shown = draftShares(value);
  const payees = (team.ledger.payees ?? []).filter((p) => !p.archived);
  return (
    <fieldset className="done-by">
      <legend>Done by ({stage})</legend>
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
      <label className="check-label">
        <input type="checkbox" checked={value.vendor} onChange={(e) => set({ vendor: e.target.checked })} />
        <span>An outside vendor did this stage, or part of it</span>
      </label>
      {value.vendor && (
        <>
          <label>
            Vendor
            <input
              aria-label="Vendor"
              list={`vendors-${job.id}`}
              maxLength={120}
              placeholder="Choose from Payees, or type a new name"
              value={value.vendorName}
              onChange={(e) => set({ vendorName: e.target.value })}
            />
            <datalist id={`vendors-${job.id}`}>
              {payees.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            {value.vendorName.trim() && !vendorPayee(team.ledger, value.vendorName) && (
              <small className="muted">New: added to Payees when saved.</small>
            )}
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
          {value.personIds.length > 0 && (
            <label>
              Vendor&apos;s share ({value.unit === 'percent' ? '%' : 'qty'})
              <input
                aria-label="Vendor's share"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder={String(draftVendorShare({ ...value, vendorShare: '' }, job.quantity ?? 0) ?? '')}
                value={value.vendorShare}
                onChange={(e) => set({ vendorShare: e.target.value })}
              />
            </label>
          )}
          {expense && Number(value.vendorCost) > 0 && (
            <label>
              Paid from
              <select
                aria-label="Vendor paid from"
                value={value.vendorPaidFrom}
                onChange={(e) => set({ vendorPaidFrom: e.target.value })}
              >
                <option value="">Not paid yet (owed to the vendor)</option>
                {paidFrom.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.text}
                  </option>
                ))}
              </select>
              <small className="muted">
                Recorded as an expense for this job, so it counts in the job&apos;s profit.
              </small>
            </label>
          )}
        </>
      )}
      {(value.personIds.length > 0 || !value.vendor) && (
        <>
          {!othersAllowed && (
            <p className="muted">You record your own work; an Admin can record work for others.</p>
          )}
          {(value.personIds.length > 1 || (value.vendor && value.personIds.length > 0)) && (
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
      <small className="muted">
        Tick when this stage was done again because something went wrong. It counts as rework for whoever was
        responsible, and is not credited as new work.
      </small>
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
