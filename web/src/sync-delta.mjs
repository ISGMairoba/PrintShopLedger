// Delta sync: after one full download, a device asks only for what changed since its cursor
// (public.get_ledger_changes) and merges it into its copy. A full download still happens on the
// first sync, after a repair, whenever this device has unsent or held work (its copy then
// carries local changes on top of the business copy), and every half hour as a safety net.
export const FULL_SYNC_EVERY = 30 * 60 * 1000;

/** Whether the next download must be the whole business. */
export function needsFullSync(state, now = Date.now()) {
  return (
    !state.syncCursor ||
    !state.fullSyncAt ||
    now - Date.parse(state.fullSyncAt) > FULL_SYNC_EVERY ||
    state.pending.length > 0 ||
    Object.keys(state.syncConflicts ?? {}).length > 0 ||
    !!state.storageRecovered
  );
}

/**
 * Merge changed records into a ledger: a record with a known id replaces it in place; a new one
 * is added at the end. Collections not mentioned stay as they are.
 * @param {Record<string, any>} ledger
 * @param {Record<string, any[]>} changes
 */
export function mergeChanges(ledger, changes) {
  const next = { ...ledger };
  for (const [name, items] of Object.entries(changes ?? {})) {
    if (!Array.isArray(items) || !items.length) continue;
    const list = [...(ledger[name] ?? [])];
    const at = new Map(list.map((item, index) => [item.id, index]));
    for (const item of items) {
      const index = at.get(item.id);
      if (index === undefined) {
        at.set(item.id, list.length);
        list.push(item);
      } else list[index] = item;
    }
    next[name] = list;
  }
  return next;
}
