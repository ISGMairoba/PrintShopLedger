import { useContext, useMemo, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import DialogActions from './DialogActions';
import MaterialCheckFields, { checkDraftFor, checkUsagesFrom, type CheckDraft } from './MaterialCheckFields';
import {
  canDecide,
  countedSince,
  entryOwner,
  materialCorrectionEvent,
  materialDecisionEvent,
  materialRoute,
  usagesText,
} from './material-corrections.mjs';
import { TeamContext } from './TeamContext';
import { TEAM_DEFAULTS } from './team.mjs';
import type { Job, JobMaterialCorrectionEvent, Ledger } from './types';
import { useWords } from './Words';

type Actor = { id: string; label: string; level: number };
const RANKS: Record<number, string> = { 1: 'Cashier', 2: 'Admin', 3: 'Manager', 4: 'General Manager', 5: 'Developer' };
const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** The business's correction rules (Team work settings; their defaults when Team work is off). */
export function useCorrectionSettings() {
  const team = useContext(TeamContext);
  return { teamWork: team?.settings ?? TEAM_DEFAULTS };
}

/** Correcting confirmed materials: the new amounts and a reason; saved, or sent for approval. */
export function MaterialCorrectionDialog({
  ledger,
  job,
  busy,
  actor,
  onSave,
  onClose,
}: {
  ledger: Ledger;
  job: Job;
  busy: boolean;
  actor: Actor;
  onSave: (event: JobMaterialCorrectionEvent) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const settings = useCorrectionSettings();
  const [draft, setDraft] = useState<CheckDraft>(() => checkDraftFor(ledger, job));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const formId = `material-correct-${job.id}`;
  const usages = useMemo(() => {
    try {
      return checkUsagesFrom(draft);
    } catch {
      return null;
    }
  }, [draft]);
  const counted = usages ? countedSince(ledger, job, usages) : false;
  const route = materialRoute(ledger, job, actor, settings, counted);
  const owner = entryOwner(ledger, job);
  const ownerName = ledger.teamPeople?.find((p) => p.id === owner.id)?.name ?? w('whoever entered them');
  const approver = Math.max(settings.teamWork.correctRank, owner.rank);
  const routeText =
    route === 'direct'
      ? w('Saved at once. Stock moves by the difference, dated today.')
      : route === 'alert'
        ? `${w('Saved at once, and')} ${ownerName} ${w('is told, because the entry is theirs.')}`
        : counted
          ? `${w('Stock was counted since these were confirmed, so someone else approves it')} (${RANKS[approver] ?? 'Admin'} ${w('or above')}).`
          : `${w('Goes for approval by a')} ${RANKS[approver] ?? 'Admin'} ${w('or above. Nothing moves until then.')}`;
  return (
    <Modal
      title={w('Correct materials used')}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {route === 'request' ? 'Send for approval' : 'Save correction'}
        </DialogActions>
      }
    >
      <p>
        <strong>{job.service}</strong> · {job.description}
      </p>
      <p className="muted">
        {w('Confirmed now')}: {usagesText(ledger, job.materialCheck?.usages)}
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          try {
            await onSave(
              materialCorrectionEvent(
                ledger,
                job,
                checkUsagesFrom(draft),
                reason,
                actor,
                settings,
              ) as JobMaterialCorrectionEvent,
            );
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <MaterialCheckFields ledger={ledger} job={job} value={draft} onChange={setDraft} confirms compact />
        <label>
          {w('Why')}
          <textarea
            required
            minLength={3}
            maxLength={300}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={w('e.g. Two sheets spoiled and reprinted')}
          />
        </label>
        <p className={route === 'request' ? 'notice' : 'muted'} role="status">
          {routeText}
        </p>
      </form>
    </Modal>
  );
}

/** A correction waiting for approval: what changes, why, and (for those who decide) the decision. */
export function MaterialCorrectionRequest({
  ledger,
  job,
  busy,
  actor,
  onSave,
  showJob = false,
}: {
  ledger: Ledger;
  job: Job;
  busy: boolean;
  actor?: Actor;
  onSave?: (event: JobMaterialCorrectionEvent) => Promise<void>;
  showJob?: boolean;
}) {
  const { w } = useWords();
  const [error, setError] = useState('');
  const req = job.materialCorrection;
  if (!req) return null;
  const may = !!actor && !!onSave && canDecide(req, actor);
  const decide = async (approve: boolean) => {
    if (!actor || !onSave) return;
    setError('');
    try {
      await onSave(materialDecisionEvent(ledger, job, approve, '', actor) as JobMaterialCorrectionEvent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="request-item pending">
      <div>
        {showJob && (
          <>
            <strong>{job.service}</strong> · {job.description} ·{' '}
          </>
        )}
        <strong>{w('Materials correction')}</strong> · {w('asked by')} {req.requestedByLabel} {w('on')}{' '}
        {when(req.requestedAt)}
        <br />
        <small>
          {usagesText(ledger, req.before)} → {usagesText(ledger, req.usages)}
        </small>
        <br />
        <small className="muted">
          {w('Why')}: {req.reason}
          {req.counted ? ` · ${w('stock was counted since')}` : ''}
          {may ? '' : ` · ${w('needs a')} ${RANKS[req.approverRank] ?? 'higher rank'} ${w('or above')}`}
        </small>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {may && (
        <div className="material-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => void decide(false)}>
            <Icon name="close" /> {w('Decline')}
          </button>
          <button type="button" disabled={busy} onClick={() => void decide(true)}>
            <Icon name="complete" /> {w('Approve')}
          </button>
        </div>
      )}
    </div>
  );
}

/** The audit: every correction of a job's materials, applied or declined. */
export function MaterialCorrectionHistory({ ledger, job }: { ledger: Ledger; job: Job }) {
  const { w } = useWords();
  const list = job.materialCheck?.corrections ?? [];
  if (!list.length) return null;
  return (
    <details>
      <summary>
        {w('Corrections')} ({list.length})
      </summary>
      {list.map((c) => (
        <p key={c.id}>
          {when(c.at)} · {c.byLabel}: {usagesText(ledger, c.before)} → {usagesText(ledger, c.after)} ·{' '}
          {w('Why')}: {c.reason}
          {c.status === 'declined'
            ? ` · ${w('declined by')} ${c.decidedByLabel}${c.note ? ` (${c.note})` : ''}`
            : c.approvedByLabel
              ? ` · ${w('approved by')} ${c.approvedByLabel}`
              : ''}
          {c.alert ? ` · ${w('the person who entered it was told')}` : ''}
          {c.counted ? ` · ${w('after a stock count')}` : ''}
        </p>
      ))}
    </details>
  );
}
