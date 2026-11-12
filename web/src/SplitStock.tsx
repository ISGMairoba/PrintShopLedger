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

/**
 * Materials → Split: cut stock of this material into a smaller one (1 A4 makes 2 A5), or put it
 * back together to fix a split entered by mistake. Both stock levels change in one step.
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
    [toId, setToId] = useState(''),
    [made, setMade] = useState(''),
    [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const to = materials.find((m) => m.id === toId);
  let plan: { from: number; to: number; change: number } | null = null;
  if (to && Number(quantity) > 0 && Number(made) > 0)
    try {
      plan = splitPlan(material, to, Number(quantity), Number(made), join);
    } catch {
      plan = null;
    }
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
          if (busy || !to) return;
          setError('');
          try {
            const q = Number(quantity),
              y = Number(made);
            const p = splitPlan(material, to, q, y, join);
            await onSave({
              id: crypto.randomUUID(),
              kind: 'material.split',
              data: {
                id: material.id,
                baseVersion: material.version,
                toId: to.id,
                toBaseVersion: to.version,
                toEventId: crypto.randomUUID(),
                quantity: q,
                yield: y,
                join,
                reason:
                  reason.trim() ||
                  (join
                    ? `Put back together: ${p.change} ${to.name} into ${q} ${material.name}`
                    : `Split ${q} ${material.name} into ${p.change} ${to.name}`),
                modifiedBy: actor.id,
                modifiedByLabel: actor.label,
                modifiedAt: new Date().toISOString(),
              },
            });
            rememberYield(material.id, to.id, y);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="split-direction" role="radiogroup" aria-label="What to do">
            <label className="check-label">
              <input type="radio" checked={!join} onChange={() => setJoin(false)} /> Split into a smaller{' '}
              {wt('material')}
            </label>
            <label className="check-label">
              <input type="radio" checked={join} onChange={() => setJoin(true)} /> Put back together (fix a
              mistaken split)
            </label>
          </div>
          <SearchSelect
            label={join ? `${wt('Material')} it was split into` : `Smaller ${wt('material')}`}
            value={toId}
            required
            options={materials
              .filter((m) => m.id !== material.id && !m.archived)
              .map((m) => ({ value: m.id, label: `${m.name} (${materialCode(m.id, materials)})` }))}
            onChange={(id) => {
              setToId(id);
              if (id && !made) setMade(rememberedYield(material.id, id));
            }}
          />
          <div className="form-grid">
            <label>
              One {material.measurementUnit} of {material.name} makes
              <span className="input-with-unit">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  required
                  value={made}
                  onChange={(e) => setMade(e.target.value)}
                />
                <span>{to ? unit(to) : ''}</span>
              </span>
            </label>
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
          </div>
          {to && plan && (
            <p className="notice" role="status">
              {material.name}: {material.available} → <strong>{plan.from}</strong> {unit(material)}
              <br />
              {to.name}: {to.available} → <strong>{plan.to}</strong> {unit(to)} ({join ? '−' : '+'}
              {plan.change})
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
            <button type="submit" disabled={!to || !plan}>
              <Icon name="save" /> {join ? 'Put back together' : 'Split stock'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
