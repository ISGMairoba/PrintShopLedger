// Items running low at other locations (stores, other branches) this person can see: the Materials
// page panel and the daily reminder at the top of the app.
import { stockLevel } from './material-display.mjs';

/**
 * @param {any[]} materials
 * @param {{ materialId: string, location: string, available: number }[]} stock
 * @param {string} here the location this device works in
 * @param {{ id: string, name: string }[]} list the locations this person can see
 */
export function lowAtOtherLocations(materials, stock, here, list) {
  const name = (id) => list.find((l) => l.id === id)?.name ?? '';
  return (stock ?? [])
    .filter((s) => s.location !== here && list.some((l) => l.id === s.location))
    .flatMap((s) => {
      const material = materials.find((m) => m.id === s.materialId && !m.archived);
      const level = material && stockLevel({ ...material, available: s.available });
      return material && level ? [{ material, location: s.location, available: s.available, level }] : [];
    })
    .sort(
      (a, b) =>
        (a.level === b.level ? 0 : a.level === 'Critical' ? -1 : 1) ||
        name(a.location).localeCompare(name(b.location)) ||
        a.material.name.localeCompare(b.material.name),
    );
}

const key = (scope) => `printshopledger:low-stock-seen:${scope}`;
/** The reminder shows once a day per device (until dismissed or opened). */
export function lowStockReminderDue(scope, today, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(key(scope)) !== today;
  } catch {
    return true;
  }
}
export function dismissLowStockReminder(scope, today, storage = globalThis.localStorage) {
  try {
    storage?.setItem(key(scope), today);
  } catch {}
}
