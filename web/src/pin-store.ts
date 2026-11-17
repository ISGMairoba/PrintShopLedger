// This device's copy of each person's PIN hash, encrypted (AES-GCM) with a key the browser keeps
// and never lets the app read out (a non-extractable CryptoKey in IndexedDB). Also whether the
// screen is locked and how many wrong PINs were tried, so reloading the page stays locked.
// If the device's stored data is cleared while locked, the person must sign in with their password
// (lockedFlag in localStorage notices it).

const DB = 'printshopledger-pin';
const STORE = 'pins';
const KEY_ID = '__key__';

export type PinRecord = { hash: string; tries: number; locked: boolean };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function deviceKey(): Promise<CryptoKey> {
  const saved = await run<CryptoKey | undefined>('readonly', (s) => s.get(KEY_ID));
  if (saved) return saved;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await run('readwrite', (s) => s.put(key, KEY_ID));
  return key;
}
const id = (scope: string, userId: string) => `${scope}:${userId}`;
const flag = (scope: string) => `printshopledger:locked:v1:${scope}`;

export async function readPin(scope: string, userId: string): Promise<PinRecord | null> {
  try {
    const box = await run<{ iv: Uint8Array; data: ArrayBuffer } | undefined>('readonly', (s) =>
      s.get(id(scope, userId)),
    );
    if (!box) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, await deviceKey(), box.data);
    return JSON.parse(new TextDecoder().decode(plain)) as PinRecord;
  } catch {
    return null;
  }
}
export async function writePin(scope: string, userId: string, record: PinRecord | null) {
  if (!record) {
    await run('readwrite', (s) => s.delete(id(scope, userId)));
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deviceKey(),
    new TextEncoder().encode(JSON.stringify(record)),
  );
  await run('readwrite', (s) => s.put({ iv, data }, id(scope, userId)));
}

/** Which person this device is locked for (also kept outside the encrypted store, see above). */
export function lockedFlag(scope: string): string | null {
  try {
    return localStorage.getItem(flag(scope));
  } catch {
    return null;
  }
}
export function setLockedFlag(scope: string, userId: string | null) {
  try {
    if (userId) localStorage.setItem(flag(scope), userId);
    else localStorage.removeItem(flag(scope));
  } catch {}
}
