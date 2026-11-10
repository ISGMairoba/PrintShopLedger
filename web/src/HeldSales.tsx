import { useState } from 'react';
import Icon from './Icon';
import { currency } from './receipts.mjs';
import { heldLabel, isOld, OLD_AFTER_HOURS } from './held-sales.mjs';
import type { HeldSale } from './CheckoutEditor';

/** Point of Service: the sales put aside on this device, to resume or discard. */
export default function HeldSales({
  held,
  busy,
  onResume,
  onDiscard,
}: {
  held: HeldSale[];
  busy: boolean;
  onResume: (sale: HeldSale) => void;
  onDiscard: (sale: HeldSale) => void;
}) {
  const [confirming, setConfirming] = useState('');
  if (!held.length) return null;
  const old = held.filter((h) => isOld(h)).length;
  return (
    <section className="held-sales" aria-labelledby="held-sales-title">
      <h3 id="held-sales-title">
        <Icon name="pause" /> Held sales on this device ({held.length})
      </h3>
      {old > 0 && (
        <p className="notice notice-warning" role="status">
          {old} held for more than {OLD_AFTER_HOURS / 24} days. Finish {old === 1 ? 'it' : 'them'} or discard{' '}
          {old === 1 ? 'it' : 'them'}; held sales don't keep stock aside.
        </p>
      )}
      <ul>
        {held.map((h) => (
          <li key={h.id} className={isOld(h) ? 'held-old' : undefined}>
            <span>
              <strong>{heldLabel(h)}</strong>
              <small className="muted">
                {h.kind === 'quick' ? 'Quick sale' : 'Checkout'} ·{' '}
                {h.total === null ? '—' : currency(h.total)} · held{' '}
                {new Date(h.heldAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} by{' '}
                {h.heldBy}
              </small>
            </span>
            <span className="held-actions">
              <button type="button" disabled={busy} onClick={() => onResume(h)}>
                Resume
              </button>
              <button
                type="button"
                className="text-button danger-text"
                disabled={busy}
                aria-label={`${confirming === h.id ? 'Yes, discard' : 'Discard'} held sale: ${heldLabel(h)}`}
                onClick={() => {
                  if (confirming !== h.id) return setConfirming(h.id);
                  setConfirming('');
                  onDiscard(h);
                }}
              >
                <Icon name="close" /> {confirming === h.id ? 'Yes, discard' : 'Discard'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
