import { assertIndependent } from './sync-dependencies.mjs';
import { applyEvent, emptyLedger } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
import type { LedgerEvent, LocalState } from './types';

const normalizeState = (state: LocalState): LocalState => ({
  ...state,
  ledger: normalizeLedger(state.ledger),
});
const fresh = (): LocalState => ({ ledger: emptyLedger(), pending: [] });
const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('printshopledger-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('ledgers');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
// A damaged local copy: the browser lost the file behind a stored record ("Data lost due to missing
// file") or cannot read it. The server keeps the business records, so the copy is rebuilt from the
// next download; unsynced changes come back from the small separate backup below.
export const damagedStorage = (error: unknown) => {
  const e = error as { name?: string; message?: string } | null;
  return (
    !!e &&
    (e.name === 'UnknownError' ||
      e.name === 'NotReadableError' ||
      /missing file|data lost|cannot be read|unreadable/i.test(e.message ?? ''))
  );
};
// Unsynced changes are also kept in localStorage, which is separate from the main copy: small,
// and written after every local save. Best effort only; the main copy stays the source of truth.
const backupKey = (scope: string) => `printshopledger-unsynced:${scope}`;
function backupPending(scope: string, pending: LedgerEvent[]) {
  try {
    if (pending.length) localStorage.setItem(backupKey(scope), JSON.stringify(pending));
    else localStorage.removeItem(backupKey(scope));
  } catch {
    // Storage full or blocked: the main copy still holds the changes.
  }
}
function restoredPending(scope: string): LedgerEvent[] {
  try {
    const value = JSON.parse(localStorage.getItem(backupKey(scope)) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
/** A fresh copy after damage: no records until the next download, plus any backed-up changes. */
const recovered = (scope: string): LocalState => ({
  ...fresh(),
  pending: restoredPending(scope),
  storageRecovered: new Date().toISOString(),
});
/** Replace the damaged record with the recovered copy (kept in memory if even that fails). */
async function replaceDamaged(scope: string, state: LocalState) {
  const db = await openDatabase();
  await new Promise<void>((resolve) => {
    const tx = db.transaction('ledgers', 'readwrite');
    const store = tx.objectStore('ledgers');
    store.delete(scope);
    store.put(state, scope);
    tx.oncomplete =
      tx.onabort =
      tx.onerror =
        () => {
          db.close();
          resolve();
        };
  });
}
export async function readState(scope: string): Promise<LocalState> {
  const db = await openDatabase();
  try {
    return await new Promise<LocalState>((resolve, reject) => {
      const tx = db.transaction('ledgers');
      const request = tx.objectStore('ledgers').get(scope);
      request.onsuccess = () => resolve(normalizeState(request.result ?? fresh()));
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch (error) {
    if (!damagedStorage(error)) throw error;
    const state = recovered(scope);
    await replaceDamaged(scope, state);
    return state;
  }
}
// One IndexedDB transaction validates, saves the ledger and appends the outbox.
// Read/write transactions serialize across tabs, preventing stale local writes.
export async function mutateState(
  scope: string,
  mutate: (state: LocalState) => LocalState,
): Promise<LocalState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ledgers', 'readwrite');
    const store = tx.objectStore('ledgers');
    const request = store.get(scope);
    let next: LocalState;
    let failure: unknown;
    const write = (current: LocalState) => {
      try {
        next = mutate(current);
        store.put(next, scope);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    request.onsuccess = () => write(normalizeState(request.result ?? fresh()));
    request.onerror = (event) => {
      // The stored copy is damaged: replace it in this same transaction instead of failing.
      if (!damagedStorage(request.error)) return;
      event.preventDefault();
      event.stopPropagation();
      store.delete(scope);
      write(recovered(scope));
    };
    tx.oncomplete = () => {
      db.close();
      backupPending(scope, next.pending);
      resolve(next);
    };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error('Local save failed.'));
    };
    tx.onerror = () => {
      failure ??= tx.error;
    };
  });
}
export const saveEvent = (scope: string, event: LedgerEvent, cloud: boolean) =>
  mutateState(scope, (state) => {
    assertIndependent(state, event);
    return {
      ...state,
      ledger: applyEvent(state.ledger, event),
      pending: cloud ? [...state.pending, event] : [],
    };
  });

export const saveEvents = (scope: string, events: LedgerEvent[], cloud: boolean) =>
  mutateState(scope, (state) => {
    for (const event of events) assertIndependent(state, event);
    return {
      ...state,
      ledger: events.reduce((ledger, event) => applyEvent(ledger, event), state.ledger),
      pending: cloud ? [...state.pending, ...events] : [],
    };
  });
