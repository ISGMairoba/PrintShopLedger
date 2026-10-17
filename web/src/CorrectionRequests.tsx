import { useEffect, useState } from 'react';
import Modal from './Modal';
import JobCorrectionPicker from './JobCorrectionPicker';
import { useFeedbackMessage } from './Feedback';
import { AdjustmentHistory } from './SaleAdjustmentsPage';
import { adjustmentLabels, applySaleAdjustment } from './sale-adjustments.mjs';
import {
  approvalEvent,
  correctionChanges,
  ownSaleAdjustments,
  ownSaleJobs,
  requestStatusLabels,
} from './correction-requests.mjs';
import { useWords } from './Words';
import type { CorrectionRequest, Job, Ledger, SupervisedEvent } from './types';

type Load = () => Promise<CorrectionRequest[]>;
const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : '');
const kindLabel = (kind: string) => adjustmentLabels[kind as keyof typeof adjustmentLabels] ?? kind;

/** Keeps the request list fresh: loads on open, and again when `version` changes. */
function useRequests(load: Load, version: number) {
  const [requests, setRequests] = useState<CorrectionRequest[] | null>(null),
    [error, setError] = useState('');
  const reload = () =>
    load()
      .then((list) => {
        setRequests(list);
        setError('');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  useEffect(() => {
    void reload();
  }, [version]);
  return { requests, setRequests, error, reload };
}

function RequestList({
  ledger,
  requests,
  busy,
  onWithdraw,
  onReview,
}: {
  ledger: Ledger;
  requests: CorrectionRequest[];
  busy: boolean;
  onWithdraw?: (r: CorrectionRequest) => void;
  onReview?: (r: CorrectionRequest) => void;
}) {
  const { w } = useWords();
  return (
    <ul className="request-list">
      {requests.map((r) => {
        const job = ledger.jobs.find((j) => j.id === r.jobId);
        return (
          <li key={r.id} className={`request-item ${r.status}`}>
            <div>
              <strong>{w(kindLabel(r.kind))}</strong> · {job?.description ?? w('Job')} #
              {r.jobId.slice(0, 8).toUpperCase()}
              <small>
                {r.requestedByLabel} · {when(r.requestedAt)} · “{r.reason}”
              </small>
              <small>
                <span
                  className={`badge ${r.status === 'approved' ? 'paid' : r.status === 'pending' ? 'unpaid' : ''}`}
                >
                  {requestStatusLabels[r.status]}
                </span>
                {r.decidedByLabel && ` ${r.decidedByLabel} · ${when(r.decidedAt)}`}
                {r.note && ` · “${r.note}”`}
              </small>
            </div>
            {r.status === 'pending' && onReview && (
              <button className="secondary" disabled={busy} onClick={() => onReview(r)}>
                Review
              </button>
            )}
            {r.status === 'pending' && onWithdraw && (
              <button className="secondary" disabled={busy} onClick={() => onWithdraw(r)}>
                Withdraw
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * My Sales, for cashiers: request a correction on one of your own sales, follow your requests,
 * and see the corrections made to your sales.
 */
export function MyCorrectionsPanel({
  ledger,
  userId,
  busy,
  online,
  version,
  load,
  onRequest,
  onWithdraw,
}: {
  ledger: Ledger;
  userId: string;
  busy: boolean;
  online: boolean;
  version: number;
  load: Load;
  onRequest: (job: Job) => void;
  onWithdraw: (requestId: string) => Promise<CorrectionRequest[]>;
}) {
  const { w } = useWords();
  const [jobId, setJobId] = useState(''),
    [message, setMessage] = useFeedbackMessage('error');
  const { requests, setRequests, error } = useRequests(load, version);
  const own = { ...ledger, jobs: ownSaleJobs(ledger, userId) };
  const history = ownSaleAdjustments(ledger, userId);
  return (
    <section className="panel" aria-labelledby="my-corrections">
      <h2 id="my-corrections">{w('Corrections to my sales')}</h2>
      <p className="muted">
        {w(
          'Made a mistake on a sale? Ask for a correction here. An Admin or Manager approves it before anything changes.',
        )}
      </p>
      <div className="form-grid">
        <JobCorrectionPicker ledger={own} days={30} value={jobId} onChange={setJobId} />
        <button
          disabled={busy || !online || !jobId}
          onClick={() => onRequest(own.jobs.find((j) => j.id === jobId)!)}
        >
          Request a correction
        </button>
      </div>
      {!online && <p className="muted">{w('Connect to the internet to request a correction.')}</p>}
      {(error || message) && (
        <p className="notice" role="alert">
          {message || error}
        </p>
      )}
      <h3>My requests</h3>
      {requests === null ? (
        <p className="muted">{online ? 'Loading requests…' : w('Connect to see your requests.')}</p>
      ) : requests.length ? (
        <RequestList
          ledger={ledger}
          requests={requests}
          busy={busy || !online}
          onWithdraw={async (r) => {
            try {
              setRequests(await onWithdraw(r.id));
            } catch (cause) {
              setMessage(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        />
      ) : (
        <p className="muted">{w('No correction requests yet.')}</p>
      )}
      {history.length > 0 && (
        <>
          <h3>Corrections made to my sales</h3>
          <AdjustmentHistory records={history} />
        </>
      )}
    </section>
  );
}

/** Sale Adjustments, for Admin and higher: requests waiting for approval. */
export function PendingRequestsPanel({
  ledger,
  actor,
  busy,
  canSave,
  version,
  load,
  onApprove,
  onReject,
}: {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  canSave: boolean;
  version: number;
  load: Load;
  onApprove: (event: SupervisedEvent, requestId: string) => Promise<void>;
  onReject: (requestId: string, note: string) => Promise<CorrectionRequest[]>;
}) {
  const { w } = useWords();
  const { requests, setRequests, error, reload } = useRequests(load, version);
  const [reviewing, setReviewing] = useState<CorrectionRequest | null>(null),
    [showAll, setShowAll] = useState(false);
  if (requests === null && !error) return null;
  const pending = (requests ?? []).filter((r) => r.status === 'pending'),
    shown = showAll ? (requests ?? []) : pending;
  return (
    <section className="correction-requests" aria-labelledby="correction-requests">
      <h3 id="correction-requests">
        {w('Correction requests')}{' '}
        {pending.length > 0 && <span className="badge unpaid">{pending.length}</span>}
      </h3>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {shown.length ? (
        <RequestList ledger={ledger} requests={shown} busy={busy || !canSave} onReview={setReviewing} />
      ) : (
        <p className="muted">{w('No requests waiting.')}</p>
      )}
      {(requests?.length ?? 0) > pending.length && (
        <button className="text-button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? w('Show waiting requests only') : w('Show decided requests too')}
        </button>
      )}
      {reviewing && (
        <RequestReviewDialog
          ledger={ledger}
          request={reviewing}
          actor={actor}
          busy={busy}
          canSave={canSave}
          onClose={() => setReviewing(null)}
          onApprove={async (event) => {
            await onApprove(event, reviewing.id);
            await reload();
          }}
          onReject={async (note) => setRequests(await onReject(reviewing.id, note))}
        />
      )}
    </section>
  );
}

function RequestReviewDialog({
  ledger,
  request,
  actor,
  busy,
  canSave,
  onClose,
  onApprove,
  onReject,
}: {
  ledger: Ledger;
  request: CorrectionRequest;
  actor: { id: string; label: string };
  busy: boolean;
  canSave: boolean;
  onClose: () => void;
  onApprove: (event: SupervisedEvent) => Promise<void>;
  onReject: (note: string) => Promise<void>;
}) {
  const { w } = useWords();
  const [note, setNote] = useState(''),
    [error, setError] = useFeedbackMessage('error');
  const [event] = useState(() => {
    try {
      return approvalEvent(ledger, request, actor);
    } catch {
      return null;
    }
  });
  let rows: [string, string, string][] = [],
    problem = '';
  try {
    if (!event) throw Error('This request no longer matches the records. Reject it and ask for a new one.');
    rows = correctionChanges(ledger, applySaleAdjustment(ledger, event), request.jobId);
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : String(cause);
  }
  const job = ledger.jobs.find((j) => j.id === request.jobId);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setError('');
    try {
      await action();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Modal title="Review correction request" wide busy={busy} onClose={onClose}>
      <p>
        <strong>{w(kindLabel(request.kind))}</strong> · {job?.description} #
        {request.jobId.slice(0, 8).toUpperCase()}
      </p>
      <p>
        {w('Requested by')} {request.requestedByLabel} · {when(request.requestedAt)}
        <br />
        {w('Reason')}: “{request.reason}”
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <section className="correction-comparison" aria-label="Correction comparison">
        <h3>Review changes</h3>
        {problem ? (
          <p className="notice" role="status">
            {problem}
          </p>
        ) : rows.length ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Original</th>
                <th scope="col">Corrected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, before, after]) => (
                <tr key={label} className="comparison-changed">
                  <th scope="row">{label}</th>
                  <td>{before}</td>
                  <td>
                    <strong>{after}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">{w('Nothing would change.')}</p>
        )}
      </section>
      <div className="actions">
        <button
          disabled={busy || !canSave || !!problem || !event}
          onClick={() => void run(() => onApprove(event!))}
        >
          {busy ? 'Saving…' : 'Approve and apply'}
        </button>
      </div>
      <form
        className="supervisor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => onReject(note));
        }}
      >
        <label>
          {w('Reason for rejecting')}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} required maxLength={500} />
        </label>
        <button className="secondary" disabled={busy || !canSave}>
          Reject request
        </button>
      </form>
    </Modal>
  );
}
