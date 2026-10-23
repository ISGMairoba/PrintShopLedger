import { useEffect, useMemo, useState, type FormEvent } from 'react';
import VariantTools from './VariantTools';
import Modal from './Modal';
import PackPricesField, { packDraft, packPricesFrom, type PackDraft } from './PackPricesField';
import PriceTiersField, { tierDraft, tiersFrom, type TierDraft } from './PriceTiersField';
import Icon from './Icon';
import CurrencyInput from './CurrencyInput';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useWords } from './Words';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { editableProducts, productEditEvents } from './product-edit.mjs';
import { addVariantEvents, variantBase, variantEditEvents, variantGroupOf } from './variants.mjs';
import type { Ledger, MaterialEvent, ServiceEvent } from './types';

/**
 * Edit a product or service in one place: its name (and its stock item's name with it), price,
 * minimum stock and stock level.
 */
export default function ProductEditor({
  ledger,
  actor,
  busy,
  initialServiceId = '',
  onSave,
  onClose,
}: {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  initialServiceId?: string;
  onSave: (events: (MaterialEvent | ServiceEvent)[]) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const { stockReasons, materialUnits } = useBusinessOptions();
  const products = useMemo(() => editableProducts(ledger), [ledger]);
  const [query, setQuery] = useState('');
  type Fields = {
    serviceId: string;
    name: string;
    price: string;
    renameStock: boolean;
    unit: string;
    minimum: string;
    mode: 'none' | 'add' | 'set';
    quantity: string;
    reason: string;
    packs: PackDraft;
    tiers: TierDraft;
    pricing: 'single' | 'packs' | 'ranges';
  };
  const fieldsFor = (id: string): Fields => {
    const p = products.find((x) => x.service.id === id);
    return {
      serviceId: p ? id : '',
      // A variant shows the product's name: renaming it renames every variant.
      name: p ? variantBase(p.service) : '',
      price: p ? (p.service.price / 100).toFixed(2) : '',
      // Rename the stock item along with it when they share a name and nothing else uses it.
      renameStock: !!p?.material && p.material.name === p.service.description && !p.sharedWith.length,
      unit: p?.material?.measurementUnit ?? '',
      minimum: String(p?.material?.minimumStock ?? 0),
      mode: 'none',
      quantity: '',
      reason: '',
      packs: packDraft(p?.service.packPrices),
      tiers: tierDraft(p?.service.priceTiers),
      pricing: p?.service.priceTiers?.length ? 'ranges' : p?.service.packPrices?.length ? 'packs' : 'single',
    };
  };
  const [f, setF] = useState<Fields>(() => fieldsFor(initialServiceId));
  const [error, setError] = useFeedbackMessage('error');
  const [done, setDone] = useState('');
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }));
  const {
    serviceId,
    name,
    price,
    renameStock,
    unit,
    minimum,
    mode,
    quantity,
    reason,
    packs,
    tiers,
    pricing,
  } = f;
  const chosen = products.find((p) => p.service.id === serviceId) ?? null;
  const group = chosen ? variantGroupOf(ledger, chosen.service) : null;
  // After variants change, reload the fields from the updated ledger (names change with them).
  const [reload, setReload] = useState('');
  useEffect(() => {
    if (!reload) return;
    const message = reload;
    setReload('');
    setF(fieldsFor(serviceId));
    setDone(message);
  }, [ledger, reload]);
  const [newVariant, setNewVariant] = useState<{ name: string; stock: string; minimum: string } | null>(null);
  const shown = products.filter((p) =>
    `${p.service.description} ${p.material?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  function pick(id: string) {
    setF(fieldsFor(id));
    setNewVariant(null);
    setError('');
    setDone('');
  }
  const changes = () => ({
    name,
    price: money(price || '0'),
    renameStock,
    ...(unit ? { unit } : {}),
    minimumStock: minimum === '' ? 0 : Number(minimum),
    stock: { mode, quantity: Number(quantity || 0), reason },
    packPrices: pricing === 'packs' ? packPricesFrom(packs) : [],
    priceTiers: pricing === 'ranges' ? tiersFrom(tiers) : [],
  });
  let preview: string[] = [],
    problem = '';
  if (chosen)
    try {
      preview = (group ? variantEditEvents : productEditEvents)(
        ledger,
        chosen.service.id,
        changes(),
        actor,
      ).summary;
    } catch (cause) {
      problem = cause instanceof Error ? cause.message : String(cause);
    }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || busy) return;
    try {
      const { events, summary } = (group ? variantEditEvents : productEditEvents)(
        ledger,
        chosen.service.id,
        changes(),
        actor,
      );
      await onSave(events);
      setF(fieldsFor(''));
      setDone(`Saved: ${summary.join('; ')}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function saveVariant(e: FormEvent) {
    e.preventDefault();
    if (!group || !newVariant || busy) return;
    try {
      await onSave(
        addVariantEvents(
          ledger,
          group.id,
          { name: newVariant.name, stock: newVariant.stock, minimum: newVariant.minimum },
          actor,
        ),
      );
      setNewVariant(null);
      setError('');
      setDone(`Added ${newVariant.name.trim()} to ${group.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const m = chosen?.material;
  return (
    <Modal title={w('Edit product')} wide busy={busy} onClose={onClose}>
      {done && (
        <p className="notice" role="status">
          {done}
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!chosen ? (
        <>
          <p className="muted">
            {w(
              'Choose a product or service. You can rename it and its stock item together, change the price and update the stock.',
            )}
          </p>
          <input
            aria-label={w('Search products')}
            placeholder={w('Search products and services')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="product-pick" aria-label={w('Products')}>
            {shown.map((p) => (
              <li key={p.service.id}>
                <button type="button" className="secondary" onClick={() => pick(p.service.id)}>
                  <span>
                    <strong>{p.service.description}</strong>
                    <small>
                      {p.material
                        ? `${p.material.available} ${p.material.measurementUnit} in stock`
                        : w('No stock item')}
                      {p.service.private ? ' · Private' : ''}
                    </small>
                  </span>
                  <span>{p.service.private ? '—' : currency(p.service.price)}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted">{w('No matching products.')}</li>}
          </ul>
        </>
      ) : (
        <>
          {group && (
            <div className="notice" role="note">
              <strong>
                {group.name} comes in {group.members.length} variants.
              </strong>{' '}
              Name, unit, price and pack prices apply to all of them; stock is kept for each one.
              <div className="variant-chips" role="group" aria-label="Variants">
                {group.members.map(({ service, material }) => (
                  <button
                    type="button"
                    key={service.id}
                    className="secondary"
                    aria-pressed={service.id === chosen.service.id}
                    onClick={() => pick(service.id)}
                  >
                    {service.variantName}
                    {material ? ` · ${material.available}` : ''}
                  </button>
                ))}
                <button
                  type="button"
                  className="secondary"
                  aria-expanded={!!newVariant}
                  onClick={() => setNewVariant(newVariant ? null : { name: '', stock: '', minimum: '' })}
                >
                  <Icon name="add" /> Add variant
                </button>
              </div>
            </div>
          )}
          <VariantTools
            key={chosen.service.id + (group?.id ?? '')}
            ledger={ledger}
            service={chosen.service}
            group={group}
            busy={busy}
            actor={actor}
            onSave={onSave}
            onDone={(message) => {
              setError('');
              setReload(message);
            }}
            onError={setError}
          />
          {group && newVariant && (
            <form className="variant-rows" onSubmit={saveVariant} aria-label="New variant">
              <p className="muted">
                The new variant gets {group.name}'s price and pack prices, with its own stock.
              </p>
              <div className="variant-row">
                <label>
                  Variant name
                  <input
                    aria-label="New variant name"
                    required
                    maxLength={60}
                    placeholder="e.g. Green"
                    value={newVariant.name}
                    onChange={(e) => setNewVariant({ ...newVariant, name: e.target.value })}
                  />
                </label>
                <label>
                  Opening stock
                  <input
                    aria-label="New variant opening stock"
                    type="number"
                    min="0"
                    step="0.001"
                    value={newVariant.stock}
                    onChange={(e) => setNewVariant({ ...newVariant, stock: e.target.value })}
                  />
                </label>
                <label>
                  Minimum stock
                  <input
                    aria-label="New variant minimum stock"
                    type="number"
                    min="0"
                    step="0.001"
                    value={newVariant.minimum}
                    onChange={(e) => setNewVariant({ ...newVariant, minimum: e.target.value })}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  <Icon name="save" /> Add
                </button>
              </div>
            </form>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  {group ? 'Product name' : 'Name'}
                  <input
                    aria-label="Name"
                    value={name}
                    maxLength={160}
                    required
                    onChange={(e) => set({ name: e.target.value })}
                  />
                </label>
                {!chosen.service.private && (
                  <label>
                    Price (₦)
                    <CurrencyInput
                      aria-label="Price"
                      value={price}
                      onValueChange={(value) => set({ price: value })}
                      required
                    />
                  </label>
                )}
                {chosen.material && (
                  <label>
                    {group ? 'Unit (all variants)' : 'Unit'}
                    <select aria-label="Unit" value={unit} onChange={(e) => set({ unit: e.target.value })}>
                      {[...new Set([chosen.material.measurementUnit, ...materialUnits])].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                    {!group && chosen.sharedWith.length > 0 && unit !== chosen.material.measurementUnit && (
                      <small>Also changes the unit for the other items using this stock item.</small>
                    )}
                  </label>
                )}
              </div>
              {!chosen.service.private && !chosen.service.customPrice && (
                <label>
                  {group ? 'How it is priced (all variants)' : 'How it is priced'}
                  <select
                    aria-label="How it is priced"
                    value={pricing}
                    onChange={(e) => set({ pricing: e.target.value as Fields['pricing'] })}
                  >
                    <option value="single">One price per item</option>
                    {!chosen.material?.requireSize && <option value="packs">Pack prices</option>}
                    <option value="ranges">Price by quantity range</option>
                  </select>
                </label>
              )}
              {!chosen.service.private && !chosen.service.customPrice && pricing === 'ranges' && (
                <PriceTiersField
                  value={tiers}
                  onChange={(next) => set({ tiers: next })}
                  basePrice={(() => {
                    try {
                      return money(price || '0');
                    } catch {
                      return null;
                    }
                  })()}
                />
              )}
              {!chosen.service.private && !chosen.material?.requireSize && pricing === 'packs' && (
                <PackPricesField
                  value={packs}
                  onChange={(next) => set({ packs: next })}
                  unitPrice={(() => {
                    try {
                      return money(price || '0');
                    } catch {
                      return null;
                    }
                  })()}
                  unit={unit || 'piece'}
                />
              )}
              {m ? (
                <>
                  <h4>
                    {group ? `Stock of ${chosen.service.variantName}` : `${w('Stock item')}: ${m.name}`}
                  </h4>
                  <p className="muted">
                    {m.available} {m.measurementUnit} in stock now
                    {chosen.sharedWith.length > 0 &&
                      ` · also used by ${chosen.sharedWith.map((s) => s.description).join(', ')}`}
                  </p>
                  {!group && (
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={renameStock}
                        onChange={(e) => set({ renameStock: e.target.checked })}
                      />
                      {w('Rename the stock item to the same name')}
                    </label>
                  )}
                  {renameStock && chosen.sharedWith.length > 0 && (
                    <p className="notice notice-warning">
                      {w('This stock item is shared. Its new name will show for the other items too.')}
                    </p>
                  )}
                  <div className="form-grid">
                    <label>
                      Minimum stock
                      <input
                        aria-label="Minimum stock"
                        type="number"
                        min="0"
                        step="0.001"
                        value={minimum}
                        onChange={(e) => set({ minimum: e.target.value })}
                      />
                    </label>
                    <label>
                      Stock change
                      <select
                        aria-label="Stock change"
                        value={mode}
                        onChange={(e) => set({ mode: e.target.value as Fields['mode'] })}
                      >
                        <option value="none">No change</option>
                        <option value="add">Add stock (restock)</option>
                        <option value="set">Set to counted amount</option>
                      </select>
                    </label>
                    {mode !== 'none' && (
                      <>
                        <label>
                          {mode === 'add'
                            ? `Quantity to add (${m.measurementUnit})`
                            : `Counted stock (${m.measurementUnit})`}
                          <input
                            aria-label={mode === 'add' ? 'Quantity to add' : 'Counted stock'}
                            type="number"
                            min="0"
                            step="0.001"
                            required
                            value={quantity}
                            onChange={(e) => set({ quantity: e.target.value })}
                          />
                        </label>
                        <label>
                          Reason
                          <input
                            aria-label="Reason"
                            list="product-stock-reasons"
                            maxLength={500}
                            required
                            value={reason}
                            onChange={(e) => set({ reason: e.target.value })}
                          />
                          <datalist id="product-stock-reasons">
                            {stockReasons.map((r) => (
                              <option key={r} value={r} />
                            ))}
                          </datalist>
                        </label>
                      </>
                    )}
                  </div>
                  {mode === 'set' && (
                    <small className="muted">
                      A count replaces the stock level and is recorded as a stock count, like on the{' '}
                      {w('Materials')} page.
                    </small>
                  )}
                </>
              ) : (
                <p className="muted">
                  {w('This service has no stock item, so only its name and price can change.')}
                </p>
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
              {problem && problem !== 'Nothing has changed.' && (
                <p className="danger-text" role="status">
                  {problem}
                </p>
              )}
              <div className="material-actions">
                <button type="submit" disabled={busy || !!problem}>
                  <Icon name="save" /> {busy ? 'Saving...' : 'Save changes'}
                </button>
                <button type="button" className="secondary" onClick={() => pick('')}>
                  {w('Choose another product')}
                </button>
              </div>
            </fieldset>
          </form>
        </>
      )}
    </Modal>
  );
}
