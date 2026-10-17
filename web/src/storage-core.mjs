// How this device keeps its offline copy: many small records instead of one large one.
//
//   <scope>|meta                    sync details: last sync, held conflicts, which pieces exist
//   <scope>|outbox                  the unsynced changes only
//   <scope>|L|<collection>|<n>      ~100 records of one collection (jobs, payments, receipts…)
//
// A save writes only the pieces that changed. If the browser loses the file behind one piece
// ("Data lost due to missing file"), the records are downloaded again from the server and the
// outbox (kept apart) survives. Devices with the old single record (<scope>) move over once.
// The store passed in is a thin promise wrapper over one IndexedDB transaction (see storage.ts);
// tests pass an in-memory one.
import { emptyLedger } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';

export const PIECE_SIZE = 100;
export const FORMAT = 2;
const metaKey = (scope) => `${scope}|meta`;
const outboxKey = (scope) => `${scope}|outbox`;
const pieceKey = (scope, name, n) => `${scope}|L|${name}|${n}`;
export const scopePrefix = (scope) => `${scope}|`;

/** The browser lost or cannot read a stored record. */
export const damagedStorage = (error) =>
  !!error &&
  (error.name === 'UnknownError' ||
    error.name === 'NotReadableError' ||
    /missing file|data lost|cannot be read|unreadable/i.test(error.message ?? ''));

const fresh = () => ({ ledger: emptyLedger(), pending: [] });
const normalizeState = (state) => ({ ...state, ledger: normalizeLedger(state.ledger) });

/** The records to store for a state: key → value. */
export function splitState(scope, state) {
  const { ledger, pending, ...details } = state;
  const entries = new Map();
  const pieces = {},
    rest = {};
  for (const [name, value] of Object.entries(ledger)) {
    if (!Array.isArray(value)) {
      rest[name] = value;
      continue;
    }
    const count = Math.ceil(value.length / PIECE_SIZE);
    pieces[name] = count;
    for (let n = 0; n < count; n++)
      entries.set(pieceKey(scope, name, n), value.slice(n * PIECE_SIZE, (n + 1) * PIECE_SIZE));
  }
  entries.set(outboxKey(scope), pending ?? []);
  entries.set(metaKey(scope), { format: FORMAT, details, pieces, rest });
  return entries;
}

/** The state from its stored records (null when the pieces listed in meta are not all there). */
export function joinState(scope, records) {
  const meta = records.get(metaKey(scope));
  if (!meta || meta.format !== FORMAT) return null;
  const ledger = { ...meta.rest };
  for (const [name, count] of Object.entries(meta.pieces)) {
    const items = [];
    for (let n = 0; n < count; n++) {
      const piece = records.get(pieceKey(scope, name, n));
      if (!Array.isArray(piece)) return null;
      items.push(...piece);
    }
    ledger[name] = items;
  }
  return { ...meta.details, ledger, pending: records.get(outboxKey(scope)) ?? [] };
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** Whether a stored piece already holds these values (a quick check by item, then by content). */
export function samePiece(stored, next) {
  if (Array.isArray(stored) && Array.isArray(next))
    return stored.length === next.length && stored.every((item, i) => same(item, next[i]));
  return same(stored, next);
}

/** Whether two states hold the same records, details and unsynced changes (key order aside). */
export function sameState(a, b) {
  if (!a || !b) return false;
  const keys = (x) =>
    Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort();
  const outer = keys(a).filter((k) => k !== 'ledger');
  if (JSON.stringify(outer) !== JSON.stringify(keys(b).filter((k) => k !== 'ledger'))) return false;
  if (outer.some((k) => !same(a[k], b[k]))) return false;
  const inner = keys(a.ledger);
  return (
    JSON.stringify(inner) === JSON.stringify(keys(b.ledger)) &&
    inner.every((k) => same(a.ledger[k], b.ledger[k]))
  );
}

/**
 * Write a state, touching only what changed since `stored` (the records as read).
 * @returns {Promise<Map<string, unknown>>} the records now stored
 */
export async function writeState(store, scope, stored, state) {
  const entries = splitState(scope, state);
  const mk = metaKey(scope),
    before = stored.get(mk);
  // Every write moves meta's revision on, so a cached copy knows when it is out of date.
  const meta = entries.get(mk);
  let changed = !before || !samePiece({ ...before, rev: 0 }, { ...meta, rev: 0 });
  for (const [key, value] of entries) {
    if (key === mk || (stored.has(key) && samePiece(stored.get(key), value))) continue;
    await store.put(key, value);
    changed = true;
  }
  for (const key of stored.keys())
    if (!entries.has(key)) {
      await store.delete(key);
      changed = true;
    }
  const rev = (before?.rev ?? 0) + (changed ? 1 : 0);
  entries.set(mk, { ...meta, rev });
  if (changed) await store.put(mk, entries.get(mk));
  else entries.set(mk, before);
  return entries;
}

/** The revision of a written copy (to check a cached copy against). */
export const revisionOf = (scope, records) => records?.get(metaKey(scope))?.rev ?? null;

/**
 * Read this scope's copy, moving an old single record over and repairing damage on the way.
 * When that needs a write and the store is read-only, returns { needsWrite: true }.
 * options.backup() → the unsynced changes kept elsewhere (restored if the outbox is lost).
 * @param {any} store
 * @param {string} scope
 * @param {{ writable: boolean, backup?: () => any[], cached?: Map<string, unknown> | null }} options
 * @returns {Promise<{ state?: any, records?: Map<string, unknown>, needsWrite?: boolean, migrated?: boolean, repaired?: boolean, migrationFailed?: boolean }>}
 */
export async function loadState(store, scope, { writable, backup = () => [], cached = null }) {
  // A copy read before is reused when no tab has written since (one small read instead of all).
  if (cached) {
    try {
      const meta = await store.get(metaKey(scope));
      if (meta?.format === FORMAT && meta.rev != null && meta.rev === revisionOf(scope, cached)) {
        // The state handed out is a copy: the cached records stay exactly as stored.
        const joined = joinState(scope, structuredClone(cached));
        if (joined) return { state: normalizeState(joined), records: cached };
      }
    } catch (error) {
      if (!damagedStorage(error)) throw error;
    }
  }
  const keys = await store.keys(scopePrefix(scope));
  const records = new Map(),
    damaged = [];
  for (const key of keys) {
    try {
      records.set(key, await store.get(key));
    } catch (error) {
      if (!damagedStorage(error)) throw error;
      damaged.push(key);
    }
  }
  const recovered = (pending) => ({ ...fresh(), pending, storageRecovered: new Date().toISOString() });

  if (!keys.length) {
    // Nothing in the new layout: an old single record, or a first visit.
    let old,
      lost = false;
    try {
      old = await store.get(scope);
    } catch (error) {
      if (!damagedStorage(error)) throw error;
      lost = true;
    }
    if (old === undefined && !lost) return { state: fresh(), records };
    if (!writable) return { needsWrite: true };
    const state = lost ? recovered(backup()) : normalizeState(old);
    // Check the move before anything is deleted: the pieces must rebuild the same state.
    if (!sameState(joinState(scope, splitState(scope, state)), state))
      return { state, records: new Map(), migrationFailed: true };
    const written = await writeState(store, scope, new Map(), state);
    await store.delete(scope);
    return { state, records: written, migrated: !lost, repaired: lost };
  }

  const outboxLost = damaged.includes(outboxKey(scope));
  const metaLost = damaged.includes(metaKey(scope)) || !records.has(metaKey(scope));
  const joined = !damaged.length && !metaLost ? joinState(scope, records) : null;
  if (joined) return { state: normalizeState(joined), records };

  // Damage: keep what can be trusted, download the records again.
  if (!writable) return { needsWrite: true };
  const meta = metaLost ? null : records.get(metaKey(scope));
  const pending = outboxLost ? backup() : (records.get(outboxKey(scope)) ?? backup());
  const { lastSynced: _lastSynced, ...details } = meta?.details ?? {};
  const state = { ...details, ...recovered(pending) };
  for (const key of damaged) await store.delete(key);
  const kept = new Map([...records].filter(([key]) => !damaged.includes(key)));
  const written = await writeState(store, scope, kept, state);
  return { state, records: written, repaired: true };
}
