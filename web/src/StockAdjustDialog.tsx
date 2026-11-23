import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { useBusinessOptions } from './BusinessOptionsContext';
import CurrencyInput from './CurrencyInput';
import { useCostMethod } from './CostMethodContext';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import type { Material, MaterialEvent, MaterialHistoryEntry } from './types';

/** The suggested note a stock change starts with. */
export function defaultStockReason(mode: 'add' | 'set', reasons: readonly string[]) {
  const want = mode === 'add' ? 'Restocking' : 'Stock Count Correction';
  return reasons.includes(want) ? want : (reasons[0] ?? '');
}

/**
 * Add to stock or set the counted quantity, with a reason (Stock items and Products). Each saves a
 * stock change of its own, so stock never changes through an edit form.
 */
export default function StockAdjustDialog({
  material,
  mode,
  history,
  busy,
  actor,
  onSave,
  onClose,
}: {
  material: Material;
  mode: 'add' | 'set';
  history: MaterialHistoryEntry[];
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: MaterialEvent) => Promise<void>;
  onClose: () => void;
}) {
  const costMethod = useCostMethod();
  const { stockReasons } = useBusinessOptions();
  const [reason, setReason] = useState(() => defaultStockReason(mode, stockReasons));
  const [error, setError] = useState('');
  // A restock's supplier price (optional): it sets the actual cost per unit (actual-cost.mjs).
  const [price, setPrice] = useState(''),
    [supplier, setSupplier] = useState(''),
    [included, setIncluded] = useState(''),
    [quantity, setQuantity] = useState('');
  const perUnit = (() => {
    try {
      const q = Number(quantity);
      return price.trim() && q > 0 ? money(price) / q : null;
    } catch {
      return null;
    }
  })();
  const suggestions = [
    ...new Set([
      ...stockReasons,
      ...history
        .filter((item) => item.action.startsWith('material.stock_'))
        .map((item) => item.reason)
        .filter(Boolean),
    ]),
  ];
  return (
    <Modal
      title={`${mode === 'add' ? 'Add to stock' : 'Set quantity'}: ${material.name}`}
      busy={busy}
      onClose={onClose}
    >
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <p>
        Current available: {material.available} {material.measurementUnit}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const data = new FormData(e.currentTarget);
          setError('');
          try {
            await onSave({
              id: crypto.randomUUID(),
              kind: mode === 'add' ? 'material.stock_added' : 'material.stock_set',
              data: {
                id: material.id,
                baseVersion: material.version,
                quantity: Number(data.get('quantity')),
                reason: String(data.get('reason') ?? '').trim(),
                ...(mode === 'add' && costMethod === 'actual' && price.trim()
                  ? {
                      cost: {
                        supplierPrice: money(price),
                        ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
                        ...(included.trim() ? { included: included.trim() } : {}),
                      },
                    }
                  : {}),
                modifiedBy: actor.id,
                modifiedByLabel: actor.label,
                modifiedAt: new Date().toISOString(),
              },
            } as MaterialEvent);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not save the stock change.');
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              {mode === 'add' ? 'Quantity to add' : 'New available quantity'}
              <input
                name="quantity"
                type="number"
                inputMode="decimal"
                min={mode === 'add' ? '0.001' : '-1000000000000'}
                max="1000000000000"
                step="0.001"
                defaultValue={mode === 'set' ? material.available : ''}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>
            <label>
              Reason / note
              <input
                name="reason"
                list="stock-reason-suggestions"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Choose a suggestion or enter your own note"
              />
            </label>
          </div>
          <datalist id="stock-reason-suggestions">
            {suggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <div className="reason-options" aria-label="Suggested stock notes">
            {stockReasons.map((item) => (
              <button type="button" className="secondary" key={item} onClick={() => setReason(item)}>
                {item}
              </button>
            ))}
          </div>
          {/* Supplier prices only matter on the Actual cost method (plans/actual-cost-v2.md). */}
          {mode === 'add' && costMethod === 'actual' && (
            <div className="form-grid restock-cost">
              <label>
                Supplier price for this quantity (₦)
                <CurrencyInput value={price} onValueChange={setPrice} />
                <small>
                  {perUnit !== null
                    ? `${currency(Math.round(perUnit))} per ${material.measurementUnit}`
                    : 'Leave empty for stock with no cost (a return, a gift, a found count).'}
                </small>
              </label>
              <label>
                Supplier (optional)
                <input value={supplier} maxLength={80} onChange={(e) => setSupplier(e.target.value)} />
              </label>
              {price.trim() && (
                <label>
                  Already included in the price (optional)
                  <input
                    value={included}
                    maxLength={200}
                    placeholder="For example: delivery, clearance"
                    onChange={(e) => setIncluded(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          <p className="muted">
            {mode === 'add'
              ? 'This quantity will be added to the existing stock.'
              : 'This will replace the available quantity with the number you enter.'}
          </p>
          <button type="submit">
            <Icon name="save" /> {busy ? 'Saving...' : mode === 'add' ? 'Add to stock' : 'Set quantity'}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
