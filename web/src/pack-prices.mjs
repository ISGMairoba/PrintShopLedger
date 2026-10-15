// Pack prices: a product sold by the piece can also be sold in packs (e.g. 25 for ₦1,500).
// A quantity is priced as packs plus loose pieces: the largest pack first, then smaller packs,
// then the rest at the single price. The server prices it the same way (private.pack_price),
// so both must agree to the kobo.
const currency = (kobo) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(kobo / 100);

/**
 * Checked pack prices, largest pack first. Throws on anything the server would refuse.
 * @param {unknown} input
 * @returns {{ quantity: number, price: number }[]}
 */
export function validPackPrices(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 6) throw Error('Add up to 6 pack prices.');
  const seen = new Set();
  const packs = input.map((pack) => {
    const quantity = Number(pack?.quantity),
      price = Number(pack?.price);
    if (!Number.isInteger(quantity) || quantity < 2 || quantity > 1000000)
      throw Error('A pack must hold a whole number of pieces, 2 or more.');
    if (!Number.isSafeInteger(price) || price < 1 || price > 100000000000)
      throw Error('Enter a price for each pack.');
    if (seen.has(quantity)) throw Error(`There are two prices for a pack of ${quantity}.`);
    seen.add(quantity);
    return { quantity, price };
  });
  return packs.sort((a, b) => b.quantity - a.quantity);
}

/**
 * The packs a quantity is sold as, largest first: [{ quantity, price, count }].
 * @param {{ quantity: number, price: number }[] | undefined} packs
 * @param {number | string} quantity
 */
export function packBreakdown(packs, quantity) {
  let left = Math.round(Number(quantity) * 1000);
  const result = [];
  for (const pack of [...(packs ?? [])].sort((a, b) => b.quantity - a.quantity)) {
    const count = Math.floor(left / (pack.quantity * 1000));
    if (count > 0) {
      result.push({ quantity: pack.quantity, price: pack.price, count });
      left -= count * pack.quantity * 1000;
    }
  }
  return result;
}

/**
 * Price in kobo: the packs, then the loose pieces at the single price (rounded once, half up).
 * @param {number} unit single-piece price in kobo
 * @param {{ quantity: number, price: number }[] | undefined} packs
 * @param {number | string} quantity
 */
export function packTotal(unit, packs, quantity) {
  const thousandths = Math.round(Number(quantity) * 1000);
  const used = packBreakdown(packs, quantity);
  const packed = used.reduce((n, p) => n + p.price * p.count, 0);
  const loose = thousandths - used.reduce((n, p) => n + p.quantity * p.count * 1000, 0);
  return packed + Number((BigInt(unit) * BigInt(loose) + 500n) / 1000n);
}

/** Whether a service is priced with packs (items sold by count only, never by size). */
export const usesPacks = (service, material) => !!service?.packPrices?.length && !material?.requireSize;

/** "1 × 100 for ₦5,500 + 1 × 25 for ₦1,500 + 5 × ₦100" — how a price was made up. */
export function packSummary(unit, packs, quantity) {
  const used = packBreakdown(packs, quantity);
  if (!used.length) return '';
  const loose =
    Math.round((Number(quantity) - used.reduce((n, p) => n + p.quantity * p.count, 0)) * 1000) / 1000;
  return [
    ...used.map((p) => `${p.count} × ${p.quantity} for ${currency(p.price)}`),
    ...(loose > 0 ? [`${loose} × ${currency(unit)}`] : []),
  ].join(' + ');
}

/** "25 for ₦1,500 · 50 for ₦3,000" — the price list, smallest pack first. */
export const packList = (packs) =>
  [...(packs ?? [])]
    .sort((a, b) => a.quantity - b.quantity)
    .map((p) => `${p.quantity} for ${currency(p.price)}`)
    .join(' · ');
