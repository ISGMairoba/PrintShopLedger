// Browser checks: read the app's offline copy in the browser (the small-pieces layout of
// src/storage-core.mjs; an old single record is read as it is).
export const readCopy = (page, scope) =>
  page.evaluate(
    (scope) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('printshopledger-v1', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('ledgers');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            store = db.transaction('ledgers').objectStore('ledgers'),
            records = new Map();
          const range = IDBKeyRange.bound(`${scope}|`, `${scope}|\uffff`);
          const keys = store.getAllKeys(range),
            values = store.getAll(range),
            old = store.get(scope);
          values.onsuccess = () => {
            keys.result.forEach((key, i) => records.set(String(key), values.result[i]));
            db.close();
            const meta = records.get(`${scope}|meta`);
            if (!meta) return resolve(old.result);
            const ledger = { ...meta.rest };
            for (const [name, count] of Object.entries(meta.pieces)) {
              ledger[name] = [];
              for (let n = 0; n < count; n++)
                ledger[name].push(...(records.get(`${scope}|L|${name}|${n}`) ?? []));
            }
            resolve({ ...meta.details, ledger, pending: records.get(`${scope}|outbox`) ?? [] });
          };
          values.onerror = () => reject(values.error);
        };
      }),
    scope,
  );
