import {assertIndependent} from './sync-dependencies.mjs';
import { applyEvent, emptyLedger } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
import type { LedgerEvent, LocalState } from './types';

const normalizeState = (state: LocalState): LocalState => ({ ...state, ledger: normalizeLedger(state.ledger) });
const fresh = (): LocalState => ({ ledger: emptyLedger(), pending: [] });
const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('printshopledger-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('ledgers');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function readState(scope: string): Promise<LocalState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ledgers');
    const request = tx.objectStore('ledgers').get(scope);
    request.onsuccess = () => resolve(normalizeState(request.result ?? fresh()));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
// One IndexedDB transaction validates, saves the ledger and appends the outbox.
// Read/write transactions serialize across tabs, preventing stale local writes.
export async function mutateState(scope: string, mutate: (state: LocalState) => LocalState): Promise<LocalState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ledgers', 'readwrite');
    const store = tx.objectStore('ledgers');
    const request = store.get(scope);
    let next: LocalState;
    let failure: unknown;
    request.onsuccess = () => {
      try { next = mutate(normalizeState(request.result ?? fresh())); store.put(next, scope); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(next); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Local save failed.')); };
    tx.onerror = () => { failure ??= tx.error; };
  });
}
export const saveEvent = (scope: string, event: LedgerEvent, cloud: boolean) => mutateState(scope, state => {assertIndependent(state,event);return {
  ...state, ledger: applyEvent(state.ledger, event), pending: cloud ? [...state.pending, event] : []
};});


export const saveEvents = (scope:string,events:LedgerEvent[],cloud:boolean) => mutateState(scope,state=>{for(const event of events)assertIndependent(state,event);return {
 ...state,ledger:events.reduce((ledger,event)=>applyEvent(ledger,event),state.ledger),pending:cloud?[...state.pending,...events]:[]
};});
