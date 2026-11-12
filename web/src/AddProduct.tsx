import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import CurrencyInput from './CurrencyInput';
import PackPricesField, { packPricesFrom, type PackDraft } from './PackPricesField';
import PriceTiersField, { tiersFrom, type TierDraft } from './PriceTiersField';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useWords } from './Words';
import { emptyLedger, money } from './domain.mjs';
import { newVariantProductEvents } from './variants.mjs';
import type { Material, MaterialEvent, Service, ServiceEvent } from './types';

const blankVariants = () => [
  { name: '', stock: '', minimum: '' },
  { name: '', stock: '', minimum: '' },
];

/**
 * Add product: a thing sold off the shelf, entered once (name, unit, price, stock). The app keeps
 * its stock item and its shelf item together, so nobody has to link them. It can come in variants
 * (sizes, colours…), each with its own stock.
 */
export default function AddProduct({
  services,
  materials,
  busy,
  actor,
  onSaveMany,
  onClose,
}: {
  services: Service[];
  materials: Material[];
  busy: boolean;
  actor: { id: string; label: string };
  onSaveMany: (events: (MaterialEvent | ServiceEvent)[]) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const units = useBusinessOptions().materialUnits;
  const [error, setError] = useFeedbackMessage('error');
  const [packs, setPacks] = useState<PackDraft>([]);
  const [tiers, setTiers] = useState<TierDraft>([]);
  const [pricing, setPricing] = useState<'packs' | 'ranges'>('packs');
  const [priceText, setPriceText] = useState('');
  const [withVariants, setWithVariants] = useState(false);
  const [variantRows, setVariantRows] = useState(blankVariants);
  const ledgerFor = () => ({ ...emptyLedger(), services, materials });
  const kobo = (text: string) => {
    try {
      return money(text || '0');
    } catch {
      return null;
    }
  };
  async function submitProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    setError('');
    try {
      const name = String(data.get('name')).trim();
      const price = money(String(data.get('price')));
      const stock = Number(data.get('stock') || 0),
        minimum = Number(data.get('minimumStock') || 0);
      if (!name) throw Error(w('Enter a product name.'));
      if (withVariants) {
        await onSaveMany(
          newVariantProductEvents(
            ledgerFor(),
            {
              name,
              unit: String(data.get('unit')).trim(),
              price,
              packPrices: pricing === 'ranges' ? [] : packPricesFrom(packs),
              priceTiers: pricing === 'ranges' ? tiersFrom(tiers) : [],
              variants: variantRows,
            },
            actor,
          ),
        );
        onClose();
        return;
      }
      if (!Number.isFinite(stock) || stock < 0) throw Error('Opening stock must be zero or more.');
      const at = new Date().toISOString();
      const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: at };
      const materialId = crypto.randomUUID();
      await onSaveMany([
        {
          id: crypto.randomUUID(),
          kind: 'material.created',
          data: {
            id: materialId,
            name,
            available: Math.round(stock * 1000) / 1000,
            measurementUnit: String(data.get('unit')).trim(),
            requireSize: false,
            minimumStock: Math.round(minimum * 1000) / 1000,
            reason: 'Opening stock',
            ...audit,
          },
        },
        {
          id: crypto.randomUUID(),
          kind: 'service.created',
          data: {
            id: crypto.randomUUID(),
            description: name,
            materialId,
            price,
            shelfItem: true,
            packPrices: pricing === 'ranges' ? [] : packPricesFrom(packs),
            priceTiers: pricing === 'ranges' ? tiersFrom(tiers) : [],
            ...audit,
          },
        },
      ]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the product.');
    }
  }
  return (
<Modal title="Add product" busy={busy} onClose={onClose}>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <p className="muted">
        {w(
          'Creates the stock item and a matching shelf item in one step. Selling it takes it out of stock and marks it Collected.',
        )}
      </p>
      <form onSubmit={submitProduct}>
        <fieldset disabled={busy}>
          <div className="form-grid hint-grid">
            <label>
              Product name
              <input name="name" maxLength={160} placeholder="e.g. Blue biro pen" required />
            </label>
            <label>
              Unit
              <select name="unit" defaultValue={units.includes('piece') ? 'piece' : units[0]}>
                {units.map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label>
              Price (₦)
              <CurrencyInput name="price" required onValueChange={setPriceText} />
            </label>
            {!withVariants && (
              <>
                <label>
                  Opening stock
                  <input name="stock" type="number" min="0" step="0.001" defaultValue="0" />
                </label>
                <label>
                  Minimum stock
                  <input name="minimumStock" type="number" min="0" step="0.001" defaultValue="0" />
                  <small>Shows a low-stock warning at or below this.</small>
                </label>
              </>
            )}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={withVariants}
              onChange={(e) => setWithVariants(e.target.checked)}
            />
            Comes in variants (colours, sizes…)
          </label>
          {withVariants && (
            <fieldset className="variant-rows">
              <legend>Variants</legend>
              <p className="muted">
                Each variant keeps its own stock. They share the price and pack prices, and each is priced
                on its own: pieces of different variants never make up a pack.
              </p>
              {variantRows.map((row, index) => (
                <div className="variant-row" key={index}>
                  <label>
                    Variant
                    <input
                      aria-label={`Variant ${index + 1} name`}
                      maxLength={60}
                      placeholder={['e.g. Pink', 'e.g. Blue', 'e.g. White'][index] ?? 'Name'}
                      value={row.name}
                      onChange={(e) =>
                        setVariantRows((rows) =>
                          rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Opening stock
                    <input
                      aria-label={`Variant ${index + 1} opening stock`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.stock}
                      onChange={(e) =>
                        setVariantRows((rows) =>
                          rows.map((r, i) => (i === index ? { ...r, stock: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label>
                    Minimum stock
                    <input
                      aria-label={`Variant ${index + 1} minimum stock`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.minimum}
                      onChange={(e) =>
                        setVariantRows((rows) =>
                          rows.map((r, i) => (i === index ? { ...r, minimum: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Remove variant ${index + 1}`}
                    disabled={variantRows.length <= 2}
                    onClick={() => setVariantRows((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                onClick={() => setVariantRows((rows) => [...rows, { name: '', stock: '', minimum: '' }])}
              >
                <Icon name="add" /> Add variant
              </button>
            </fieldset>
          )}
          <label>
            How it is priced
            <select
              aria-label="How it is priced"
              value={pricing === 'ranges' ? 'ranges' : 'packs'}
              onChange={(e) => setPricing(e.target.value === 'ranges' ? 'ranges' : 'packs')}
            >
              <option value="packs">One price, with pack prices if needed</option>
              <option value="ranges">Price by quantity range (e.g. 1–25, 26–100, 101+)</option>
            </select>
          </label>
          {pricing === 'ranges' ? (
            <PriceTiersField value={tiers} onChange={setTiers} basePrice={kobo(priceText)} />
          ) : (
            <PackPricesField value={packs} onChange={setPacks} unitPrice={kobo(priceText)} />
          )}
          <button type="submit">
            <Icon name="save" /> {busy ? 'Saving...' : 'Save product'}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
