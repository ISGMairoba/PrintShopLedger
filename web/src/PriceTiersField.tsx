import CurrencyInput from './CurrencyInput';
import Icon from './Icon';
import { money } from './domain.mjs';
import { tierRows, validPriceTiers } from './price-tiers.mjs';
import { currency } from './receipts.mjs';
import type { PriceTier } from './types';

/** Quantity ranges as typed: the starting quantity and price (₦) text per row. */
export type TierDraft = { from: string; price: string }[];
export const tierDraft = (tiers?: PriceTier[]): TierDraft =>
  [...(tiers ?? [])]
    .sort((a, b) => a.from - b.from)
    .map((t) => ({ from: String(t.from), price: (t.price / 100).toFixed(2) }));
/** The typed rows as checked ranges (blank rows are ignored). Throws with a plain message. */
export const tiersFrom = (draft: TierDraft): PriceTier[] =>
  validPriceTiers(
    draft
      .filter((row) => row.from.trim() || row.price.trim())
      .map((row) => ({ from: Number(row.from), price: money(row.price || '0') })),
  );

/**
 * Price by quantity range: from a quantity up, a different price per item. The whole quantity is
 * charged at the rate of its range. Shows the full price list so it can be checked.
 */
export default function PriceTiersField({
  value,
  onChange,
  basePrice,
}: {
  value: TierDraft;
  onChange: (value: TierDraft) => void;
  /** The service price (kobo): the rate below the first range. */
  basePrice: number | null;
}) {
  let summary = '';
  try {
    const tiers = tiersFrom(value);
    if (tiers.length && basePrice !== null)
      summary = tierRows(basePrice, tiers)
        .map((r) => `${r.label}: ${currency(r.price)} each`)
        .join(' · ');
  } catch (cause) {
    summary = cause instanceof Error ? cause.message : '';
  }
  return (
    <fieldset className="pack-prices">
      <legend>Quantity ranges</legend>
      <p className="muted">
        The price above is for small orders. Add a range for each bigger quantity, e.g. from 26 at ₦80 and
        from 101 at ₦60. The whole order is charged at the rate of the range it falls in: 30 copies are 30 ×
        ₦80.
      </p>
      {value.map((row, index) => (
        <div className="pack-row" key={index}>
          <label>
            From quantity
            <input
              aria-label={`Range ${index + 1} from quantity`}
              type="number"
              min="2"
              step="1"
              inputMode="numeric"
              value={row.from}
              onChange={(e) =>
                onChange(value.map((r, i) => (i === index ? { ...r, from: e.target.value } : r)))
              }
            />
          </label>
          <label>
            Price each (₦)
            <CurrencyInput
              aria-label={`Range ${index + 1} price each`}
              value={row.price}
              onValueChange={(price) => onChange(value.map((r, i) => (i === index ? { ...r, price } : r)))}
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={`Remove range ${index + 1}`}
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
          onClick={() => onChange([...value, { from: '', price: '' }])}
        >
          <Icon name="add" /> Add range
        </button>
      )}
      {summary && <small role="status">{summary}</small>}
    </fieldset>
  );
}
