import { useContext, useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { jobBalanceFast } from './balances.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import { TemplateDocumentContext } from './TemplateFields';
import { currency } from './app/shared';
import { deliveryMessage, deliveryRef } from './delivery-note.mjs';
import {
  doneEvent,
  doneProblem,
  handoverEvent,
  handoverProblem,
  hasParts,
  jobParts,
  partsAllowed,
  paymentNeeded,
} from './job-handover.mjs';
import type { Job, JobHandoverEvent, Ledger } from './types';

type Handover = NonNullable<Job['progress']>['handovers'][number];

const when = (value: string) =>
  new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Done so far and collected so far as one bar: collected (solid) inside done (light). */
export function PartsBar({ job }: { job: Job }) {
  const p = jobParts(job);
  const pct = (n: number) => `${Math.min(100, (n / p.total) * 100)}%`;
  return (
    <div className="parts-bar" aria-hidden="true">
      <span className="parts-done" style={{ width: pct(p.done) }} />
      <span className="parts-collected" style={{ width: pct(p.collected) }} />
    </div>
  );
}

/** One line for job cards and lists: "Done 100 · Collected 50 of 200". */
export function partsLine(job: Job) {
  if (!hasParts(job)) return '';
  const p = jobParts(job);
  return `${p.finished ? 'All done' : `Done ${p.done}`} · Collected ${p.collected} of ${p.total}`;
}

/** Part orders on the job's details: done so far, handovers and their delivery notes. */
export default function JobParts({
  job,
  ledger,
  busy,
  actor,
  onSave,
  onPayment,
}: {
  job: Job;
  ledger: Ledger;
  busy: boolean;
  actor?: { id: string; label: string };
  onSave?: (event: JobHandoverEvent) => Promise<void>;
  onPayment?: (customerId: string) => void;
}) {
  const options = useBusinessOptions();
  const doc = useContext(TemplateDocumentContext);
  const [dialog, setDialog] = useState<'done' | 'handover' | null>(null);
  const [count, setCount] = useState('');
  const [collectedBy, setCollectedBy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [note4, setNote4] = useState<Handover | null>(null);
  useEffect(() => {
    if (job.progress?.handovers?.length) {
      void import('./receipt-pdf');
      void import('./share-pdf');
    }
  }, [job.progress?.handovers?.length]);
  if (!partsAllowed(job) && !hasParts(job)) return null;
  const p = jobParts(job);
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const canEdit = !!actor && !!onSave && partsAllowed(job);
  const quantity = Number(count);
  const paid = jobBalanceFast(ledger, job).paid;
  const money = dialog === 'handover' && Number.isInteger(quantity) && quantity > 0 ? paymentNeeded(job, paid, quantity) : null;
  const blocked = !!money?.short && options.handoverPayment === 'require';
  const problem =
    dialog === 'done' ? doneProblem(job, count === '' ? NaN : quantity) : dialog === 'handover' ? handoverProblem(job, count === '' ? NaN : quantity) : '';
  const open = (kind: 'done' | 'handover') => {
    setCount(kind === 'done' ? String(p.done || '') : String(p.ready || ''));
    setCollectedBy(kind === 'handover' ? (customer?.name ?? '') : '');
    setNote('');
    setError('');
    setDialog(kind);
  };
  const save = async () => {
    if (!actor || !onSave || problem || blocked) return;
    setError('');
    setWorking(true);
    try {
      const event =
        dialog === 'done'
          ? doneEvent(job, quantity, actor)
          : handoverEvent(job, { quantity, collectedBy, note }, actor);
      await onSave(event as JobHandoverEvent);
      setDialog(null);
      if (dialog === 'handover') setNotice('Handed over. Print or share the delivery note below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };
  async function deliveryPdf(h: Handover, action: 'share' | 'open' | 'roll') {
    setNotice('');
    try {
      const { createDeliveryNotePdf } = await import('./receipt-pdf');
      const pdf = createDeliveryNotePdf(
        { job, handover: h, customerName: customer?.name ?? '', customerPhone: customer?.phone ?? '' },
        doc.business,
        action === 'roll' ? 'roll' : 'a4',
      );
      if (action === 'share') {
        const { sharePdf, shareResult } = await import('./share-pdf');
        const name = typeof doc.business === 'string' ? doc.business : doc.business.businessName;
        const result = await sharePdf(pdf, `${deliveryRef(h.id)}.pdf`, {
          title: `Delivery note ${deliveryRef(h.id)}`,
          text: deliveryMessage(job, h, name),
          phone: customer?.phone || undefined,
        });
        setNotice(shareResult(result));
      } else window.open(String(pdf.output('bloburl')), '_blank', 'noopener');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <section className="job-parts" aria-label="Done and collected">
      <h3>Done and collected</h3>
      <div className="parts-summary">
        <span>
          Done <strong>{p.done}</strong>
        </span>
        <span>
          Collected <strong>{p.collected}</strong>
        </span>
        <span>
          Ready now <strong>{p.ready}</strong>
        </span>
        <span>
          Ordered <strong>{p.total}</strong>
        </span>
      </div>
      <PartsBar job={job} />
      {canEdit && (
        <div className="job-actions">
          {!p.finished && (
            <button type="button" className="text-button" disabled={busy} data-opens-dialog onClick={() => open('done')}>
              <Icon name="quantity" /> Record done so far
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy || !p.ready || !!job.hold}
            data-opens-dialog
            onClick={() => open('handover')}
          >
            <Icon name="next" /> Hand over part
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {p.handovers.length > 0 && (
        <ul className="parts-handovers">
          {p.handovers.map((h) => (
            <li key={h.id}>
              <span>
                <strong>{h.quantity}</strong> on {when(h.at)}
                <small>
                  {h.collectedBy ? `Collected by ${h.collectedBy} · ` : ''}handed over by {h.byLabel}
                  {h.note ? ` · ${h.note}` : ''}
                </small>
              </span>
              <button type="button" className="secondary" onClick={() => setNote4(h)}>
                <Icon name="details" /> Delivery note
              </button>
            </li>
          ))}
        </ul>
      )}
      {note4 && (
        <Modal title={`Delivery note ${deliveryRef(note4.id)}`} onClose={() => setNote4(null)}>
          <p className="muted">
            {note4.quantity} × {job.description}, {when(note4.at)}. No prices are shown.
          </p>
          <div className="material-actions">
            <button type="button" className="secondary" onClick={() => void deliveryPdf(note4, 'open')}>
              Open A4
            </button>
            <button type="button" className="secondary" onClick={() => void deliveryPdf(note4, 'roll')}>
              Open 80 mm
            </button>
            <button type="button" onClick={() => void deliveryPdf(note4, 'share')}>
              Share
            </button>
          </div>
          {notice && <p className="muted">{notice}</p>}
        </Modal>
      )}
      {dialog && (
        <Modal
          title={dialog === 'done' ? 'Record done so far' : 'Hand over part'}
          busy={working}
          onClose={() => setDialog(null)}
        >
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p className="muted">
            {dialog === 'done'
              ? `How many of the ${p.total} are finished so far? ${p.collected ? `${p.collected} are already collected.` : ''}`
              : `${p.ready} ready to hand over · ${p.total - p.collected} still to collect in all.`}
          </p>
          <label>
            {dialog === 'done' ? 'Done so far' : 'Customer is taking'}
            <input
              aria-label={dialog === 'done' ? 'Done so far' : 'Quantity handed over'}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))}
            />
          </label>
          {dialog === 'handover' && (
            <>
              <label>
                Collected by
                <input
                  aria-label="Collected by"
                  maxLength={80}
                  value={collectedBy}
                  onChange={(e) => setCollectedBy(e.target.value)}
                />
              </label>
              <label>
                Note (optional)
                <input aria-label="Handover note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {money && money.short > 0 && (
                <p className={`notice ${blocked ? '' : 'notice-warning'}`} role={blocked ? 'alert' : 'status'}>
                  {blocked ? 'Not yet: this part must be paid for first. ' : 'This part is not fully paid for. '}
                  Paid so far {currency(paid)}; taking {p.collected + quantity} of {p.total} needs{' '}
                  {currency(money.due)} — {currency(money.short)} more.
                  {blocked && onPayment && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setDialog(null);
                          onPayment(job.customerId);
                        }}
                      >
                        Receive payment
                      </button>
                    </>
                  )}
                </p>
              )}
            </>
          )}
          {count !== '' && problem && <small className="danger-text">{problem}</small>}
          <div className="material-actions">
            <button type="button" className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" disabled={working || !!problem || blocked} onClick={() => void save()}>
              {dialog === 'done' ? 'Save' : money?.short ? 'Hand over anyway' : 'Hand over'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
