import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import SearchSelect from './SearchSelect';
import { splitPlan } from './materials.mjs';
import { materialCode } from './material-display.mjs';
import type { Material, MaterialEvent } from './types';
import { renameActive as wt } from './Words';

// How many one item makes, remembered on this device for each pair (A4 → A5: 2).
const yieldKey = (from: string, to: string) => `psl-split-yield:${from}:${to}`;
function rememberedYield(from: string, to: string) {
  try {
    return localStorage.getItem(yieldKey(from, to)) ?? '';
  } catch {
    return '';
  }
}
function rememberYield(from: string, to: string, value: number) {
  try {
    localStorage.setItem(yieldKey(from, to), String(value));
  } catch {
    // Remembering is only a convenience.
  }
}

type Piece = { key: string; toId: string; made: string };
const newPiece = (): Piece => ({ key: crypto.randomUUID(), toId: '', made: '' });

/**
 * Materials → Split: cut stock of this material into one or more smaller ones (1 A4 makes 2 A5;
 * or 1 A2 makes 1 A3 + 1 A4 + 1 A6 + 2 A7; a 10 ft roll makes a 7 ft and a 3 ft roll), or put it
 * back together to fix a split entered by mistake. Every stock level changes in one step. The
 * pieces don't have to add up to the whole (offcuts).
 */
export default function SplitStock({
  material,
  materials,
  busy,
  actor,
  onSave,
  onClose,
}: {
  material: Material;
  materials: Material[];
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: MaterialEvent) => Promise<void>;
  onClose: () => void;
}) {
  const [join, setJoin] = useState(false),
    [pieces, setPieces] = useState<Piece[]>(() => [newPiece()]),
    [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const q = Number(quantity);
  const rows = pieces.map((p) => {
    const to = materials.find((m) => m.id === p.toId);
    let plan: { from: number; to: number; change: number } | null = null;
    if (to && q > 0 && Number(p.made) > 0)
      try {
        plan = splitPlan(material, to, q, Number(p.made), join);
      } catch {
        plan = null;
      }
    return { piece: p, to, plan };
  });
  const ready = rows.every((r) => r.to && r.plan);
  const update = (key: string, change: Partial<Piece>) =>
    setPieces((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const fromAfter = rows[0]?.plan?.from;
  const describe = () =>
    rows.map((r) => `${r.plan?.change} ${r.to?.name}`).join(' + ');
  const unit = (m: Material) => m.measurementUnit;
  return (
    <Modal title={`${join ? 'Put back together' : 'Split'}: ${material.name}`} busy={busy} onClose={onClose}>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="split-stock"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !ready) return;
          setError('');
          try {
            for (const r of rows) splitPlan(material, r.to as Material, q, Number(r.piece.made), join);
            await onSave({
              id: crypto.randomUUID(),
              kind: 'material.split',
              data: {
                id: material.id,
                baseVersion: material.version,
                pieces: rows.map((r) => ({
                  toId: (r.to as Material).id,
                  toBaseVersion: (r.to as Material).version,
                  toEventId: crypto.randomUUID(),
                  yield: Number(r.piece.made),
                })),
                quantity: q,
                join,
                reason:
                  reason.trim() ||
                  (join
                    ? `Put back together: ${describe()} into ${q} ${material.name}`
                    : `Split ${q} ${material.name} into ${describe()}`),
                modifiedBy: actor.id,
                modifiedByLabel: actor.label,
                modifiedAt: new Date().toISOString(),
              },
            });
            for (const r of rows) rememberYield(material.id, (r.to as Material).id, Number(r.piece.made));
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="split-direction" role="radiogroup" aria-label="What to do">
            <label className="check-label">
              <input type="radio" checked={!join} onChange={() => setJoin(false)} /> Split into smaller{' '}
              {wt('materials')}
            </label>
            <label className="check-label">
              <input type="radio" checked={join} onChange={() => setJoin(true)} /> Put back together (fix a
              mistaken split)
            </label>
          </div>
          <label>
            {join ? `${material.name} to put back together` : `${material.name} to split`}
            <span className="input-with-unit">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <span>{unit(material)}</span>
            </span>
          </label>
          <p className="muted">
            One {material.measurementUnit} of {material.name} makes:
          </p>
          {rows.map(({ piece, to }, i) => (
            <div className="form-grid split-piece" key={piece.key}>
              <SearchSelect
                label={join ? `${wt('Material')} it was split into` : `Piece ${i + 1}`}
                value={piece.toId}
                required
                options={materials
                  .filter(
                    (m) =>
                      m.id !== material.id &&
                      !m.archived &&
                      (m.id === piece.toId || !pieces.some((p) => p.toId === m.id)),
                  )
                  .map((m) => ({ value: m.id, label: `${m.name} (${materialCode(m.id, materials)})` }))}
                onChange={(id) =>
                  update(piece.key, { toId: id, made: id && !piece.made ? rememberedYield(material.id, id) : piece.made })
                }
              />
              <label>
                How many
                <span className="input-with-unit">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    required
                    value={piece.made}
                    onChange={(e) => update(piece.key, { made: e.target.value })}
                  />
                  <span>{to ? unit(to) : ''}</span>
                </span>
              </label>
              {pieces.length > 1 && (
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Remove piece ${i + 1}`}
                  onClick={() => setPieces((list) => list.filter((p) => p.key !== piece.key))}
                >
                  <Icon name="close" /> Remove
                </button>
              )}
            </div>
          ))}
          {pieces.length < 20 && (
            <button type="button" className="secondary" onClick={() => setPieces((list) => [...list, newPiece()])}>
              <Icon name="add" /> Add another piece
            </button>
          )}
          {ready && fromAfter !== undefined && (
            <p className="notice" role="status">
              {material.name}: {material.available} → <strong>{fromAfter}</strong> {unit(material)}
              {rows.map((r) => (
                <span key={r.piece.key}>
                  <br />
                  {r.to?.name}: {r.to?.available} → <strong>{r.plan?.to}</strong> {r.to ? unit(r.to) : ''} (
                  {join ? '−' : '+'}
                  {r.plan?.change})
                </span>
              ))}
            </p>
          )}
          <label>
            Note (optional)
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="dialog-action-buttons">
            <button type="button" className="secondary" onClick={onClose}>
              <Icon name="close" /> Cancel
            </button>
            <button type="submit" disabled={!ready}>
              <Icon name="save" /> {join ? 'Put back together' : 'Split stock'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
