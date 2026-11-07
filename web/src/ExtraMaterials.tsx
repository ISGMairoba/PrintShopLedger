import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { currency } from './receipts.mjs';
import {
  acceptsExtraMaterials,
  extraMaterialsCost,
  extraMaterialsEvent,
  extraUsages,
  MAX_EXTRA_MATERIALS,
} from './production-materials.mjs';
import { alphabetical } from './alphabetical.mjs';
import type { Job, JobExtraMaterialsEvent, Ledger } from './types';

const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

/**
 * Job details → Materials added in production (services and templates that accept them): what was
 * added, its estimated cost, and a form to add more or correct the amounts.
 */
export default function ExtraMaterials({
  job,
  ledger,
  busy,
  actor,
  onSave,
}: {
  job: Job;
  ledger: Ledger;
  busy: boolean;
  actor: { id: string; label: string };
  /** Saves the change; left out when this person may not add materials. */
  onSave?: (event: JobExtraMaterialsEvent) => Promise<void>;
}) {
  const [rows, setRows] = useState<{ materialId: string; quantity: string }[] | null>(null);
  const [error, setError] = useState('');
  if (!acceptsExtraMaterials(ledger, job) && !extraUsages(job).length) return null;
  const used = extraUsages(job);
  const name = (id: string) => ledger.materials.find((m) => m.id === id);
  const cost = extraMaterialsCost(ledger, used);
  const cancelled = job.productionStatus === 'Cancelled';
  const choices = alphabetical(
    ledger.materials.filter((m) => !m.archived || used.some((u) => u.materialId === m.id)),
    (m) => m.name,
  );
  const open = () => {
    setError('');
    setRows([
      ...used.map((u) => ({ materialId: u.materialId, quantity: String(u.quantity) })),
      ...(cancelled ? [] : [{ materialId: '', quantity: '' }]),
    ]);
  };
  const save = async () => {
    if (!rows || !onSave) return;
    setError('');
    try {
      const wanted = rows.filter((r) => r.materialId);
      // A material removed from the list goes back to stock (total 0).
      const removed = used
        .filter((u) => !wanted.some((r) => r.materialId === u.materialId))
        .map((u) => ({ materialId: u.materialId, quantity: 0 }));
      const usages = [...wanted.map((r) => ({ materialId: r.materialId, quantity: Number(r.quantity) })), ...removed];
      if (usages.some((u) => !(u.quantity >= 0)))
        throw Error('Enter how much of each material was used.');
      await onSave(extraMaterialsEvent(ledger, job, usages, actor) as JobExtraMaterialsEvent);
      setRows(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section className="job-detail-stage" aria-labelledby="extra-materials">
      <h3 id="extra-materials">Materials added in production</h3>
      {used.length ? (
        <>
          {used.map((u) => (
            <div className="history" key={u.materialId}>
              <span>{name(u.materialId)?.name ?? 'Material'}</span>
              <strong>
                {qty(u.quantity)} {name(u.materialId)?.measurementUnit ?? ''}
              </strong>
            </div>
          ))}
          <p className="muted">
            {job.extraMaterials?.costCovered
              ? `Their cost is already in the price${cost.kobo ? ` (materials actually used: about ${currency(cost.kobo)})` : ''}.`
              : `Estimated cost ${currency(cost.kobo)}, added to this job's cost.`}
            {cost.unpriced.length > 0 && ` ${cost.unpriced.length} material(s) have no cost set in Pricing Templates → Costs.`}{' '}
            Last changed by {job.extraMaterials?.updatedByLabel}.
          </p>
        </>
      ) : (
        <p className="muted">None added yet.</p>
      )}
      {onSave && acceptsExtraMaterials(ledger, job) && (!cancelled || used.length > 0) && (
        <button type="button" className="secondary" disabled={busy} onClick={open}>
          <Icon name="add" /> {cancelled ? 'Return materials' : used.length ? 'Add or correct materials' : 'Add materials used'}
        </button>
      )}
      {rows && (
        <Modal title="Materials used in production" busy={busy} onClose={() => setRows(null)}>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p className="muted">
            Enter the total of each material this job used. Stock moves by the difference; set 0 (or remove a
            line) to return it.
          </p>
          {rows.map((r, i) => {
            const m = name(r.materialId);
            return (
              <div className="form-row" key={i}>
                <label>
                  Material
                  <select
                    aria-label={`Material ${i + 1}`}
                    value={r.materialId}
                    disabled={cancelled}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))}
                  >
                    <option value="">Choose a material…</option>
                    {choices.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        disabled={c.id !== r.materialId && rows.some((x) => x.materialId === c.id)}
                      >
                        {c.name} · {qty(c.available)} {c.measurementUnit} in stock
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount used{m ? ` (${m.measurementUnit})` : ''}
                  <input
                    aria-label={`Amount used ${i + 1}`}
                    inputMode="decimal"
                    value={r.quantity}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                  />
                </label>
                <button
                  type="button"
                  className="text-button danger-text"
                  aria-label={`Remove material ${i + 1}`}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Icon name="close" />
                </button>
              </div>
            );
          })}
          {!cancelled && rows.length < MAX_EXTRA_MATERIALS && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRows([...rows, { materialId: '', quantity: '' }])}
            >
              <Icon name="add" /> Another material
            </button>
          )}
          <div className="material-actions">
            <button type="button" className="secondary" onClick={() => setRows(null)}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void save()}>
              <Icon name="save" /> Save materials
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
