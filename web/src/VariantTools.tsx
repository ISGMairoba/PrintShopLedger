import { useState, type FormEvent } from 'react';
import Icon from './Icon';
import {
  joinVariantsEvents,
  makeVariantsEvents,
  separateVariantEvents,
  variantGroups,
  type VariantGroup,
} from './variants.mjs';
import type { Ledger, MaterialEvent, Service, ServiceEvent } from './types';
import { alphabetical } from './alphabetical.mjs';

type Events = (MaterialEvent | ServiceEvent)[];
type Row = { name: string; stock: string; minimum: string };
const blank = (): Row => ({ name: '', stock: '', minimum: '' });

/**
 * In Edit product: give an item variants (or make it a variant of another product), or take a
 * variant out of its product so it is an item of its own.
 */
export default function VariantTools({
  ledger,
  service,
  group,
  busy,
  actor,
  onSave,
  onDone,
  onError,
}: {
  ledger: Ledger;
  service: Service;
  group: VariantGroup | null;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (events: Events) => Promise<void>;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<'' | 'make' | 'join' | 'separate'>('');
  const [product, setProduct] = useState(service.description);
  const [variant, setVariant] = useState('');
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState(
    group ? `${group.name} ${service.variantName ?? ''}`.trim() : service.description,
  );
  const others = variantGroups(ledger);
  const material = service.materialId ? ledger.materials.find((m) => m.id === service.materialId) : null;
  // Variants need a stock item counted by number (not sized) on an item that is for sale.
  const eligible = !!material && !material.archived && !material.requireSize && !service.private;
  let preview: string[] = [],
    problem = '';
  const plan = () => {
    if (open === 'make')
      return makeVariantsEvents(ledger, service.id, { product, variant, others: rows }, actor);
    if (open === 'join') return joinVariantsEvents(ledger, service.id, target, variant, actor);
    return separateVariantEvents(ledger, service.id, newName, actor);
  };
  if (open)
    try {
      preview = plan().summary;
    } catch (cause) {
      problem = cause instanceof Error ? cause.message : String(cause);
    }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    try {
      const { events, summary } = plan();
      await onSave(events);
      setOpen('');
      onDone(`Saved: ${summary.join('; ')}.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (!group && !eligible) return null;
  return (
    <div className="variant-tools">
      <div className="variant-chips" role="group" aria-label="Variant actions">
        {group ? (
          <button
            type="button"
            className="secondary"
            aria-expanded={open === 'separate'}
            onClick={() => setOpen(open === 'separate' ? '' : 'separate')}
          >
            <Icon name="close" /> Make {service.variantName} a separate item
          </button>
        ) : (
          <>
            <button
              type="button"
              className="secondary"
              aria-expanded={open === 'make'}
              onClick={() => setOpen(open === 'make' ? '' : 'make')}
            >
              <Icon name="add" /> Add variants (colours, sizes…)
            </button>
            {others.length > 0 && (
              <button
                type="button"
                className="secondary"
                aria-expanded={open === 'join'}
                onClick={() => {
                  setTarget(target || others[0].id);
                  setOpen(open === 'join' ? '' : 'join');
                }}
              >
                <Icon name="add" /> Make it a variant of another product
              </button>
            )}
          </>
        )}
      </div>
      {open && (
        <form className="variant-rows" onSubmit={submit} aria-label="Variants">
          {open === 'make' && (
            <>
              <p className="muted">
                This item becomes one variant and keeps its stock. The new variants get the same price, pack
                prices and unit, each with its own stock.
              </p>
              <div className="form-grid">
                <label>
                  Product name
                  <input
                    value={product}
                    maxLength={100}
                    required
                    onChange={(e) => setProduct(e.target.value)}
                  />
                </label>
                <label>
                  This item is the variant
                  <input
                    value={variant}
                    maxLength={60}
                    required
                    placeholder="e.g. Pink"
                    onChange={(e) => setVariant(e.target.value)}
                  />
                </label>
              </div>
              {rows.map((row, index) => (
                <div className="variant-row" key={index}>
                  <label>
                    New variant
                    <input
                      aria-label={`New variant ${index + 1} name`}
                      maxLength={60}
                      placeholder="e.g. Blue"
                      value={row.name}
                      onChange={(e) =>
                        setRows((all) =>
                          all.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Opening stock
                    <input
                      aria-label={`New variant ${index + 1} opening stock`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.stock}
                      onChange={(e) =>
                        setRows((all) =>
                          all.map((r, i) => (i === index ? { ...r, stock: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Minimum stock
                    <input
                      aria-label={`New variant ${index + 1} minimum stock`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.minimum}
                      onChange={(e) =>
                        setRows((all) =>
                          all.map((r, i) => (i === index ? { ...r, minimum: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Remove new variant ${index + 1}`}
                    disabled={rows.length <= 1}
                    onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
              <button type="button" className="secondary" onClick={() => setRows((all) => [...all, blank()])}>
                <Icon name="add" /> Another variant
              </button>
            </>
          )}
          {open === 'join' && (
            <>
              <p className="muted">
                This item keeps its stock and takes the other product's price and pack prices. It needs the
                same unit.
              </p>
              <div className="form-grid">
                <label>
                  Product
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {alphabetical(others, (g) => g.name).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.members.map((m) => m.service.variantName).join(', ')})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  This item is the variant
                  <input
                    value={variant}
                    maxLength={60}
                    required
                    placeholder="e.g. Gold"
                    onChange={(e) => setVariant(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          {open === 'separate' && (
            <>
              <p className="muted">
                {service.variantName} becomes an item of its own, with its stock, price and pack prices as
                they are. Later price changes to {group?.name} no longer apply to it.
              </p>
              <label>
                Name of the separate item
                <input
                  value={newName}
                  maxLength={160}
                  required
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
            </>
          )}
          {preview.length > 0 && (
            <div className="notice" role="status">
              <strong>This will:</strong>
              <ul>
                {preview.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {problem && (
            <p className="danger-text" role="status">
              {problem}
            </p>
          )}
          <div className="material-actions">
            <button type="submit" disabled={busy || !!problem}>
              <Icon name="save" /> {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="secondary" onClick={() => setOpen('')}>
              <Icon name="close" /> Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
