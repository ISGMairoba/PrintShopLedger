// Drop-down lists read alphabetically ("Art Card (A4)" before "Art Card (A10)": numbers by value).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} label
 * @returns {T[]}
 */
export const alphabetical = (items, label) => [...items].sort((a, b) => collator.compare(label(a), label(b)));
