// "Stock below zero" (Business Settings → Jobs & payments): a business can stop sales, material
// confirmations and waste from taking more than is in stock. The device checks before saving; the
// server checks again, so work saved offline from an out-of-date stock count waits for review
// until an admin updates the stock.
let blocked = false;
/** Follow the business setting (jobs.stockBelowZero === 'block'). */
export const setStockBelowZeroBlocked = (value) => {
  blocked = !!value;
};
export const stockBelowZeroBlocked = () => blocked;
const amount = (n) => String(Math.round(n * 1000) / 1000);
/** The message for taking `needed` of a material that has `available`. */
export const notEnoughStock = (material, available, needed) =>
  `Not enough ${material.name}: ${amount(Math.max(0, available))} ${material.measurementUnit} in stock, ` +
  `this needs ${amount(needed)}. Ask an admin to update the stock first.`;
/**
 * Refuse a change that takes a material below zero (or further below), when the business blocks it.
 * @param {{ materials: { id: string, name: string, measurementUnit: string, available: number }[] }} before
 * @param {{ materials: { id: string, name: string, measurementUnit: string, available: number }[] }} after
 */
export function checkStockBelowZero(before, after) {
  if (!blocked) return;
  for (const m of after.materials) {
    const old = before.materials.find((x) => x.id === m.id)?.available ?? 0;
    if (m.available < 0 && m.available < old) throw Error(notEnoughStock(m, old, old - m.available));
  }
}
