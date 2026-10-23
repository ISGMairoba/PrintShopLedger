// Price by quantity range: a service can charge less per item for bigger orders, e.g. 1–25 at the
// service price, 26–100 at ₦80, 101 and more at ₦60. The whole quantity is charged at the rate of
// the range it falls in (30 copies = 30 × ₦80). The server picks the rate the same way
// (private.tier_price).
import { packTotal } from './pack-prices.mjs';

const currency = (kobo) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(kobo / 100);

/**
 * Checked ranges, smallest starting quantity first. Throws on anything the server would refuse.
 * @param {unknown} input
 * @returns {{ from: number, price: number }[]}
 */
export function validPriceTiers(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 6) throw Error('Add up to 6 quantity ranges.');
  const seen = new Set();
  const tiers = input.map((tier) => {
    const from = Number(tier?.from),
      price = Number(tier?.price);
    if (!Number.isInteger(from) || from < 2 || from > 1000000)
      throw Error('Each range starts at a whole number, 2 or more.');
    if (!Number.isSafeInteger(price) || price < 0 || price > 100000000000)
      throw Error('Enter a price for each range.');
    if (seen.has(from)) throw Error(`There are two ranges starting at ${from}.`);
    seen.add(from);
    return { from, price };
  });
  return tiers.sort((a, b) => a.from - b.from);
}

/** The price per item for a quantity: the rate of the range it falls in, else the service price. */
export function tierPrice(base, tiers, quantity) {
  const q = Number(quantity);
  let price = base;
  for (const tier of [...(tiers ?? [])].sort((a, b) => a.from - b.from))
    if (q >= tier.from) price = tier.price;
  return price;
}

/** Whether a service charges by quantity range. */
export const usesTiers = (service) => !!service?.priceTiers?.length;

/** The ranges as rows: [{ label: '1–25', price }, { label: '26–100', price }, { label: '101+', price }]. */
export function tierRows(base, tiers) {
  const sorted = [...(tiers ?? [])].sort((a, b) => a.from - b.from);
  const starts = [{ from: 1, price: base }, ...sorted];
  return starts.map((t, i) => ({
    label:
      i + 1 < starts.length
        ? starts[i + 1].from - 1 === t.from
          ? `${t.from}`
          : `${t.from}–${starts[i + 1].from - 1}`
        : `${t.from}+`,
    price: t.price,
  }));
}

/** "1–25: ₦100 · 26–100: ₦80 · 101+: ₦60" — the price list. */
export const tierList = (base, tiers) =>
  tierRows(base, tiers)
    .map((r) => `${r.label}: ${currency(r.price)}`)
    .join(' · ');

/**
 * The price (kobo) of a quantity of an item sold by count: packs, a range rate, or the single price.
 * @param {{ price: number, packPrices?: { quantity: number, price: number }[], priceTiers?: { from: number, price: number }[] }} service
 * @param {number} quantity
 */
export function countPrice(service, quantity) {
  if (service.packPrices?.length) return packTotal(service.price, service.packPrices, quantity);
  const unit = tierPrice(service.price, service.priceTiers, quantity);
  return Number((BigInt(unit) * BigInt(Math.round(Number(quantity) * 1000)) + 500n) / 1000n);
}
