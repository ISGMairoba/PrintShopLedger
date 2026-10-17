import { assertIndependent } from './sync-dependencies.mjs';
import { applyEvent } from './domain.mjs';
import { loadState, writeState, damagedStorage } from './storage-core.mjs';

// The last copy read or written per scope; reused while the stored revision still matches.
const cache = new Map<string, Map<string, unknown>>();
import type { LedgerEvent, LocalState } from './types';

export { damagedStorage };

// The offline copy lives in small records (see storage-core.mjs): a damaged file costs one
// piece, which is downloaded again, and the unsynced changes are kept apart from the rest.
const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('printshopledger-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('ledgers');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Promise steps over ONE transaction; each next request is made as the last one finishes. */
function storeOf(tx: IDBTransaction) {
  const store = tx.objectStore('ledgers');
  const ask = <T>(request: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => {
        // A damaged record is handled by the caller; it must not abort the whole save.
        event.preventDefault();
        event.stopPropagation();
        reject(request.error);
      };
    });
  return {
    keys: (prefix: string) =>
      ask(store.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))).then((keys) => keys.map(String)),
    get: (key: string) => ask(store.get(key)),
    put: (key: string, value: unknown) => ask(store.put(value, key)).then(() => undefined),
    delete: (key: string) => ask(store.delete(key)).then(() => undefined),
  };
}

// Unsynced changes are also copied to localStorage after every save: a second, separate place,
// used only if the outbox itself is lost.
const backupKey = (scope: string) => `printshopledger-unsynced:${scope}`;
function backupPending(scope: string, pending: LedgerEvent[]) {
  try {
    if (pending.length) localStorage.setItem(backupKey(scope), JSON.stringify(pending));
    else localStorage.removeItem(backupKey(scope));
  } catch {
    // Storage full or blocked: the outbox still holds the changes.
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

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: ReturnType<typeof storeOf>, abort: () => void) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('ledgers', mode);
    let result: T, failure: unknown;
    work(storeOf(tx), () => tx.abort()).then(
      (value) => (result = value),
      (error) => {
        failure = error;
        try {
          tx.abort();
        } catch {
          // Already finished.
        }
      },
    );
    tx.oncomplete = () => {
      db.close();
      if (failure) reject(failure);
      else resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error('Local save failed.'));
    };
  });
}

export async function readState(scope: string): Promise<LocalState> {
  const loaded = await run('readonly', (store) =>
    loadState(store, scope, {
      writable: false,
      backup: () => restoredPending(scope),
      cached: cache.get(scope) ?? null,
    }),
  );
  // Moving an old copy over, or repairing a damaged one, needs a write.
  if (loaded.needsWrite) return mutateState(scope, (state) => state);
  if (loaded.records && loaded.records !== cache.get(scope))
    cache.set(scope, structuredClone(loaded.records));
  return loaded.state as LocalState;
}

// One IndexedDB transaction reads, validates, and writes the changed pieces and the outbox.
// Read/write transactions serialize across tabs, preventing stale local writes.
export async function mutateState(
  scope: string,
  mutate: (state: LocalState) => LocalState,
): Promise<LocalState> {
  const { state: next, records } = await run('readwrite', async (store) => {
    const loaded = await loadState(store, scope, {
      writable: true,
      backup: () => restoredPending(scope),
      cached: cache.get(scope) ?? null,
    });
    const state = mutate(loaded.state as LocalState);
    return { state, records: await writeState(store, scope, loaded.records!, state) };
  }).catch((error) => {
    cache.delete(scope);
    throw error;
  });
  // Only a committed transaction updates the cache.
  cache.set(scope, structuredClone(records));
  backupPending(scope, next.pending);
  return next;
}

/** Ask the browser to keep this site's data under storage pressure; report space left. */
export async function storageHealth() {
  try {
    const persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.());
    const estimate = await navigator.storage?.estimate?.();
    return {
      persisted: !!persisted,
      usage: estimate?.usage ?? null,
      free: estimate?.quota != null && estimate.usage != null ? estimate.quota - estimate.usage : null,
    };
  } catch {
    return { persisted: false, usage: null, free: null };
  }
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
