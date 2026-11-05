import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import CurrencyInput from './CurrencyInput';
import { currency } from './receipts.mjs';
import { money } from './domain.mjs';
import type { DrawerClosing } from './types';

const when = (value?: string) =>
  value ? new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : '';

/**
 * Conflict Inbox → drawers closed automatically overnight. An Admin enters the cash actually found
 * (or leaves it empty) and marks the drawer reviewed.
 */
export default function DrawerReviews({
  closings,
  online,
  onReview,
}: {
  closings: DrawerClosing[];
  online: boolean;
  onReview: (id: string, counted: number | null, note: string) => Promise<void>;
}) {
  const pending = closings
    .filter((d) => d.autoClosed && d.reviewStatus !== 'reviewed')
    .sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const [open, setOpen] = useState<DrawerClosing | null>(null);
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!pending.length) return null;
  const save = async (counted: number | null) => {
    if (!open) return;
    setBusy(true);
    setError('');
    try {
      await onReview(open.id, counted, note.trim());
      setOpen(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" aria-labelledby="drawer-reviews">
      <h2 id="drawer-reviews">Drawers closed automatically ({pending.length})</h2>
      <p className="muted">
        These drawers were still open the next day, so they were closed without a cash count. Enter the cash
        actually found, or mark them reviewed.
      </p>
      <div className="table-wrap">
        <table aria-label="Drawers closed automatically">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Sales</th>
              <th>Expected cash</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.fromUserLabel}</strong>
                  <small>Closed {when(d.closedAt)}</small>
                </td>
                <td>
                  {d.checkoutIds.length} sales
                  <small>
                    POS {currency(d.posCollected)} · Transfer {currency(d.transferCollected)}
                  </small>
                </td>
                <td>
                  {currency(d.expectedCash)}
                  {d.openingCash > 0 && <small>Including {currency(d.openingCash)} opening cash</small>}
                </td>
                <td className="cell-fit">
                  <button
                    type="button"
                    className="text-button"
                    disabled={!online}
                    onClick={() => {
                      setOpen(d);
                      setCount('');
                      setNote('');
                      setError('');
                    }}
                  >
                    <Icon name="details" /> Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!online && <p className="muted">Connect to review drawers.</p>}
      {open && (
        <Modal title={`Review drawer · ${open.fromUserLabel}`} busy={busy} onClose={() => setOpen(null)}>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p>
            {open.checkoutIds.length} sales closed {when(open.closedAt)}. Expected cash{' '}
            <strong>{currency(open.expectedCash)}</strong>
            {open.cashRefunded ? ` (after ${currency(open.cashRefunded)} cash refunds)` : ''}.
          </p>
          <fieldset disabled={busy}>
            <label>
              Cash found (₦)
              <CurrencyInput
                aria-label="Cash found"
                value={count}
                onValueChange={setCount}
                placeholder="Leave empty if not counted"
              />
            </label>
            {count && <p className="muted">Difference: {currency(money(count) - open.expectedCash)}</p>}
            <label>
              Note (optional)
              <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="material-actions">
              <button type="button" className="secondary" onClick={() => void save(null)}>
                Mark reviewed without a count
              </button>
              <button type="button" disabled={!count} onClick={() => void save(money(count))}>
                <Icon name="save" /> Save count and mark reviewed
              </button>
            </div>
          </fieldset>
        </Modal>
      )}
    </section>
  );
}
