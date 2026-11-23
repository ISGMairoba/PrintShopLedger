import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import DialogActions from './DialogActions';
import MaterialCheckFields, { checkDraftFor, checkUsagesFrom, type CheckDraft } from './MaterialCheckFields';
import { checkLines, checksMaterials, materialsCheckEvent, pendingChecks } from './material-check.mjs';
import { canDecide, correctionBlocked, pendingMaterialCorrections } from './material-corrections.mjs';
import {
  MaterialCorrectionDialog,
  MaterialCorrectionHistory,
  MaterialCorrectionRequest,
  useCorrectionSettings,
} from './MaterialCorrection';
import type { Job, JobMaterialCorrectionEvent, JobMaterialsCheckEvent, Ledger } from './types';

type CheckSave = (event: JobMaterialsCheckEvent | JobMaterialCorrectionEvent) => Promise<void>;
import { useWords } from './Words';

const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** The dialog to confirm (Admin+), approve, or send for approval the materials a job used. */
export function MaterialCheckDialog({
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
  actor: { id: string; label: string; level: number; confirms: boolean };
  onSave: (event: JobMaterialsCheckEvent) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const [draft, setDraft] = useState<CheckDraft>(() => checkDraftFor(ledger, job));
  const [error, setError] = useState('');
  const pending = job.materialCheck?.status === 'pending';
  const admin = actor.confirms;
  const formId = `material-check-${job.id}`;
  return (
    <Modal
      title={pending && admin ? w('Approve materials used') : w('Materials used')}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {admin ? (pending ? 'Approve' : 'Confirm') : 'Send for approval'}
        </DialogActions>
      }
    >
      <p>
        <strong>{job.service}</strong> · {job.description}
      </p>
      {pending && job.materialCheck?.requestedByLabel && (
        <p className="notice" role="status">
          {w('Entered by')} {job.materialCheck.requestedByLabel}.{' '}
          {admin ? w('Change any amount before approving.') : ''}
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          try {
            await onSave(
              materialsCheckEvent(ledger, job, checkUsagesFrom(draft), actor) as JobMaterialsCheckEvent,
            );
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <MaterialCheckFields
          ledger={ledger}
          job={job}
          value={draft}
          onChange={setDraft}
          confirms={actor.confirms}
        />
      </form>
    </Modal>
  );
}

/** Job details → Materials used: the check's state, what was entered, and confirm/approve/edit. */
export default function MaterialCheckSection({
  ledger,
  job,
  busy,
  actor,
  onSave,
}: {
  ledger: Ledger;
  job: Job;
  busy: boolean;
  actor?: { id: string; label: string; level: number; confirms: boolean };
  onSave?: CheckSave;
}) {
  const { w } = useWords();
  const settings = useCorrectionSettings();
  const [open, setOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  if (!checksMaterials(job) || !checkLines(ledger, job).length) return null;
  const check = job.materialCheck;
  const name = (id: string) => ledger.materials.find((m) => m.id === id)?.name ?? 'Material';
  const unit = (id: string) => ledger.materials.find((m) => m.id === id)?.measurementUnit ?? '';
  const cancelled = job.productionStatus === 'Cancelled';
  const admin = !!actor?.confirms;
  // Before confirming: enter, send or approve. Once confirmed: a correction, with a reason (anyone may ask).
  const canAct = !!actor && !!onSave && !cancelled && check?.status !== 'confirmed';
  const blocked = check?.status === 'confirmed' ? correctionBlocked(job, settings) : '';
  const canCorrect = !!actor && !!onSave && check?.status === 'confirmed' && !blocked;
  const label = !check
    ? job.materialUsed
      ? w('Confirmed (before materials checks)')
      : w('Not confirmed yet')
    : check.status === 'pending'
      ? `${w('Waiting for approval')} · ${w('entered by')} ${check.requestedByLabel}`
      : `${w('Confirmed by')} ${check.confirmedByLabel}${check.requestedByLabel ? ` · ${w('entered by')} ${check.requestedByLabel}` : ''}${check.correctedAt ? ` · ${w('corrected')}${check.recordedByLabel ? ` (${check.recordedByLabel})` : ''}` : ''}`;
  return (
    <section className="job-detail-stage" aria-labelledby={`check-${job.id}`}>
      <h3 id={`check-${job.id}`}>{w('Materials used')}</h3>
      <p className={check?.status === 'pending' ? 'notice notice-warning' : 'muted'}>{label}</p>
      {check?.usages
        .filter((u) => u.quantity > 0)
        .map((u) => (
          <div className="history" key={u.id}>
            <span>{name(u.materialId)}</span>
            <strong>
              {qty(u.quantity)} {unit(u.materialId)}
            </strong>
          </div>
        ))}
      {canAct && (
        <button type="button" className="secondary self-start" disabled={busy} onClick={() => setOpen(true)}>
          <Icon name={check?.status === 'pending' && admin ? 'complete' : 'edit'} />{' '}
          {!check
            ? admin
              ? w('Confirm materials used')
              : w('Enter materials used')
            : admin
              ? w('Review and approve')
              : w('Change entry')}
        </button>
      )}
      <MaterialCorrectionRequest ledger={ledger} job={job} busy={busy} actor={actor} onSave={onSave} />
      {canCorrect && (
        <button
          type="button"
          className="secondary self-start"
          disabled={busy}
          onClick={() => setCorrecting(true)}
        >
          <Icon name="edit" /> {w('Correct materials used')}
        </button>
      )}
      {check?.status === 'confirmed' && blocked && !job.materialCorrection && !cancelled && (
        <p className="muted">{w(blocked)}</p>
      )}
      <MaterialCorrectionHistory ledger={ledger} job={job} />
      {correcting && actor && onSave && (
        <MaterialCorrectionDialog
          ledger={ledger}
          job={job}
          busy={busy}
          actor={actor}
          onSave={onSave}
          onClose={() => setCorrecting(false)}
        />
      )}
      {open && actor && onSave && (
        <MaterialCheckDialog
          ledger={ledger}
          job={job}
          busy={busy}
          actor={actor}
          onSave={onSave}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** For Admins: a banner with the jobs whose materials wait for approval, each opening its review. */
export function PendingChecksBanner({
  ledger,
  busy,
  actor,
  onSave,
}: {
  ledger: Ledger;
  busy: boolean;
  actor: { id: string; label: string; level: number; confirms: boolean };
  onSave: CheckSave;
}) {
  const { w } = useWords();
  const [list, setList] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const waiting = actor.confirms ? pendingChecks(ledger) : [];
  const corrections = (pendingMaterialCorrections(ledger) as Job[]).filter((j) =>
    canDecide(j.materialCorrection, actor),
  );
  const count = waiting.length + corrections.length;
  if (!count) return null;
  const job = review ? ledger.jobs.find((j) => j.id === review) : undefined;
  return (
    <>
      <div className="notice notice-warning pending-checks" role="status">
        <span>
          <strong>{count}</strong> {w(count === 1 ? 'job has materials' : 'jobs have materials')}{' '}
          {w('waiting for your approval')}.
        </span>
        <button type="button" className="secondary" onClick={() => setList(true)}>
          {w('Review')}
        </button>
      </div>
      {list && !job && (
        <Modal title={w('Materials waiting for approval')} busy={busy} onClose={() => setList(false)}>
          <ul className="pending-check-list">
            {waiting.map((j) => (
              <li key={j.id}>
                <span>
                  <strong>{j.service}</strong> · {j.description}
                  <small>
                    {w('Entered by')} {j.materialCheck?.requestedByLabel}
                  </small>
                </span>
                <button type="button" className="secondary" onClick={() => setReview(j.id)}>
                  {w('Review')}
                </button>
              </li>
            ))}
          </ul>
          {!!corrections.length && (
            <div className="request-list">
              {corrections.map((j) => (
                <MaterialCorrectionRequest
                  key={j.id}
                  ledger={ledger}
                  job={j}
                  busy={busy}
                  actor={actor}
                  onSave={onSave}
                  showJob
                />
              ))}
            </div>
          )}
        </Modal>
      )}
      {job && (
        <MaterialCheckDialog
          ledger={ledger}
          job={job}
          busy={busy}
          actor={actor}
          onSave={onSave}
          onClose={() => setReview(null)}
        />
      )}
    </>
  );
}
