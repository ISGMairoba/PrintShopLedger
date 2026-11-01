import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import type { Material, StockRequest } from './types';

type Location = { id: string; name: string; kind?: string };
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : '');

/**
 * Materials page → Stock requests: what this location has asked for, and what other locations have
 * asked from the locations this person may send from. Sending moves the stock (a transfer).
 */
export function StockRequestsPanel({
  requests,
  materials,
  locations,
  userId,
  seesAll,
  canSendFrom,
  busy,
  onAnswer,
  onCancel,
}: {
  requests: StockRequest[];
  materials: Material[];
  locations: Location[];
  userId: string;
  seesAll: boolean;
  canSendFrom: (location: string) => boolean;
  busy: boolean;
  onAnswer: (id: string, send: boolean, quantity: number | null, reply: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [showAnswered, setShowAnswered] = useState(false);
  const [answering, setAnswering] = useState<StockRequest | null>(null);
  const [sendQty, setSendQty] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const name = (id: string) => locations.find((l) => l.id === id)?.name ?? 'Main branch';
  const material = (id: string) => materials.find((m) => m.id === id);
  const pending = requests.filter((r) => r.status === 'pending');
  const shown = showAnswered ? requests : pending;
  if (!requests.length) return null;
  const run = async (task: () => Promise<void>) => {
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section className="panel" aria-labelledby="stock-requests">
      <h2 id="stock-requests">Stock requests{pending.length ? ` (${pending.length} open)` : ''}</h2>
      {error && !answering && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {shown.length ? (
        <div className="table-wrap">
          <table aria-label="Stock requests">
            <thead>
              <tr>
                <th>Item</th>
                <th>Asked</th>
                <th>From → to</th>
                <th>By</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const m = material(r.materialId);
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{m?.name ?? 'Stock item'}</strong>
                      {r.note && <small>{r.note}</small>}
                    </td>
                    <td className="cell-fit">
                      {qty(r.quantity)} {m?.measurementUnit ?? ''}
                    </td>
                    <td>
                      {name(r.from)} → {name(r.to)}
                    </td>
                    <td>
                      {r.requestedByLabel}
                      <small>{when(r.requestedAt)}</small>
                    </td>
                    <td>
                      {r.status === 'pending'
                        ? 'Waiting'
                        : r.status === 'sent'
                          ? `Sent ${qty(r.sentQuantity ?? r.quantity)}`
                          : r.status === 'declined'
                            ? 'Declined'
                            : 'Withdrawn'}
                      {r.status !== 'pending' && (
                        <small>
                          {r.handledByLabel} · {when(r.handledAt)}
                          {r.reply ? ` · ${r.reply}` : ''}
                        </small>
                      )}
                    </td>
                    <td className="cell-fit">
                      {r.status === 'pending' && canSendFrom(r.from) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setAnswering(r);
                            setSendQty(String(r.quantity));
                            setReply('');
                            setError('');
                          }}
                        >
                          <Icon name="share" /> Answer
                        </button>
                      )}
                      {r.status === 'pending' && (r.requestedBy === userId || seesAll) && (
                        <button
                          className="text-button danger-text"
                          disabled={busy}
                          onClick={() => run(() => onCancel(r.id))}
                        >
                          <Icon name="close" /> Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No open requests.</p>
      )}
      {requests.length > pending.length && (
        <button className="text-button" onClick={() => setShowAnswered(!showAnswered)}>
          {showAnswered ? 'Show open requests only' : 'Show answered requests (last 30 days)'}
        </button>
      )}
      {answering && (
        <Modal title="Answer stock request" busy={busy} onClose={() => setAnswering(null)}>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p>
            {name(answering.to)} asks {name(answering.from)} for {qty(answering.quantity)}{' '}
            {material(answering.materialId)?.measurementUnit ?? ''} of{' '}
            <strong>{material(answering.materialId)?.name ?? 'this item'}</strong>.
          </p>
          <fieldset disabled={busy}>
            <label>
              Quantity to send
              <input
                aria-label="Quantity to send"
                inputMode="decimal"
                value={sendQty}
                onChange={(e) => setSendQty(e.target.value)}
              />
            </label>
            <label>
              Reply (optional)
              <input maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)} />
            </label>
            <p className="muted">
              Sending moves the stock now and records it in both locations' Stock History.
            </p>
            <div className="material-actions">
              <button
                type="button"
                className="secondary danger-text"
                onClick={() =>
                  run(async () => {
                    await onAnswer(answering.id, false, null, reply.trim());
                    setAnswering(null);
                  })
                }
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => {
                  const n = Number(sendQty);
                  if (!(n > 0)) {
                    setError('Enter a quantity greater than zero.');
                    return;
                  }
                  run(async () => {
                    await onAnswer(answering.id, true, n, reply.trim());
                    setAnswering(null);
                  });
                }}
              >
                Send
              </button>
            </div>
          </fieldset>
        </Modal>
      )}
    </section>
  );
}

/** Ask another location (usually a store) for stock of one item. */
export function RequestStockModal({
  material,
  locations,
  here,
  stock,
  busy,
  onRequest,
  onClose,
}: {
  material: Material;
  locations: Location[];
  here: string;
  stock?: { materialId: string; location: string; available: number }[];
  busy: boolean;
  onRequest: (from: string, quantity: number, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const others = locations.filter((l) => l.id !== here);
  const atOf = (id: string) => stock?.find((s) => s.materialId === material.id && s.location === id)?.available;
  const [from, setFrom] = useState(others.find((l) => l.kind === 'store')?.id ?? others[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title={`Request ${material.name}`} busy={busy} onClose={onClose}>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const n = Number(amount);
          if (!(n > 0)) {
            setError('Enter a quantity greater than zero.');
            return;
          }
          try {
            await onRequest(from, n, note.trim());
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Ask
            <select aria-label="Ask location" value={from} onChange={(e) => setFrom(e.target.value)}>
              {others.map((l) => {
                const at = atOf(l.id);
                return (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.kind === 'store' ? ' (store)' : ''}
                    {at === undefined ? '' : ` · ${qty(at)} ${material.measurementUnit} there`}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Quantity ({material.measurementUnit})
            <input
              aria-label="Quantity to request"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Note
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="muted">
            Staff who can send stock from there will see the request. The stock arrives here when they send it.
          </p>
          <div className="material-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!from}>
              Send request
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
