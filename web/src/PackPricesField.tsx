import CurrencyInput from './CurrencyInput';
import Icon from './Icon';
import { money } from './domain.mjs';
import { packSummary, packTotal, validPackPrices } from './pack-prices.mjs';
import { currency } from './receipts.mjs';
import type { PackPrice } from './types';

/** Pack prices as typed: pack size and price (₦) text per row. */
export type PackDraft = { quantity: string; price: string }[];
export const packDraft = (packs?: PackPrice[]): PackDraft =>
  [...(packs ?? [])]
    .sort((a, b) => a.quantity - b.quantity)
    .map((p) => ({ quantity: String(p.quantity), price: (p.price / 100).toFixed(2) }));
/** The typed rows as checked pack prices (blank rows are ignored). Throws with a plain message. */
export const packPricesFrom = (draft: PackDraft): PackPrice[] =>
  validPackPrices(
    draft
      .filter((row) => row.quantity.trim() || row.price.trim())
      .map((row) => ({ quantity: Number(row.quantity), price: money(row.price || '0') })),
  );

/**
 * Pack prices for a product sold by the piece: e.g. 25 for ₦1,500. Sales are priced as packs
 * plus loose pieces, largest pack first. Shows a worked example so the price list can be checked.
 */
export default function PackPricesField({
  value,
  onChange,
  unitPrice,
  unit = 'piece',
}: {
  value: PackDraft;
  onChange: (value: PackDraft) => void;
  /** Single-piece price in kobo, for the example. */
  unitPrice: number | null;
  unit?: string;
}) {
  let example = '';
  try {
    const packs = packPricesFrom(value);
    if (packs.length && unitPrice !== null) {
      const smallest = Math.min(...packs.map((p) => p.quantity));
      const q = smallest + 5;
      example = `Example: ${q} ${unit}s = ${packSummary(unitPrice, packs, q)} = ${currency(packTotal(unitPrice, packs, q))}`;
    }
  } catch (cause) {
    example = cause instanceof Error ? cause.message : '';
  }
  return (
    <fieldset className="pack-prices">
      <legend>Pack prices (optional)</legend>
      <p className="muted">
        Sell this in packs as well as one by one, e.g. 25 for ₦1,500. A sale is charged as packs plus loose
        pieces: the largest pack first, then smaller packs, then the rest at the single price.
      </p>
      {value.map((row, index) => (
        <div className="pack-row" key={index}>
          <label>
            Pack of
            <input
              aria-label={`Pack ${index + 1} size`}
              type="number"
              min="2"
              step="1"
              inputMode="numeric"
              value={row.quantity}
              onChange={(e) =>
                onChange(value.map((r, i) => (i === index ? { ...r, quantity: e.target.value } : r)))
              }
            />
          </label>
          <label>
            Price (₦)
            <CurrencyInput
              aria-label={`Pack ${index + 1} price`}
              value={row.price}
              onValueChange={(price) => onChange(value.map((r, i) => (i === index ? { ...r, price } : r)))}
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={`Remove pack ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      {value.length < 6 && (
        <button
          type="button"
          className="secondary"
          onClick={() => onChange([...value, { quantity: '', price: '' }])}
        >
          <Icon name="add" /> Add pack price
        </button>
      )}
      {example && <small role="status">{example}</small>}
    </fieldset>
  );
}
