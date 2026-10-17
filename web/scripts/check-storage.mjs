// Offline copy: an old single record moves to small pieces, and a lost piece is repaired
// instead of leaving the workspace stuck on "Loading workspace".
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, webkit } from 'playwright';
import { applyEvent, emptyLedger } from '../src/domain.mjs';

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4201', '--strictPort'],
  { stdio: 'inherit' },
);
const at = new Date().toISOString();
const oldCopy = {
  ledger: applyEvent(emptyLedger(), {
    id: crypto.randomUUID(),
    kind: 'customer.created',
    data: {
      id: crypto.randomUUID(),
      name: 'Old copy customer',
      phone: '0801',
      address: '',
      creditLimit: 0,
      modifiedBy: 'local-trial',
      modifiedByLabel: 'Local trial user',
      modifiedAt: at,
    },
  }),
  pending: [],
};
const idb = (page, script, arg) => page.evaluate(script, arg);
const keys = (page) =>
  idb(
    page,
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('printshopledger-v1', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('ledgers');
        open.onsuccess = () => {
          const req = open.result.transaction('ledgers').objectStore('ledgers').getAllKeys();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result.map(String).sort());
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4201')).ok) break;
    } catch {}
    await delay(100);
  }
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 900 },
      });
      // The damage drill: a read of the named record fails the way a lost file does.
      await context.addInitScript(() => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (key) {
          if (String(key) === localStorage.getItem('drill-break'))
            throw new DOMException('Data lost due to missing file.', 'UnknownError');
          return get.call(this, key);
        };
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:4201');
      // An old single-record copy, as every device has today.
      await idb(
        page,
        (value) =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('printshopledger-v1', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('ledgers');
            open.onsuccess = () => {
              const tx = open.result.transaction('ledgers', 'readwrite');
              tx.objectStore('ledgers').put(value, 'local-trial');
              tx.oncomplete = () => {
                open.result.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
          }),
        oldCopy,
      );
      await page.getByRole('button', { name: 'Try locally on this device' }).click();
      await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Customers', exact: true })
        .click();
      await page.getByText('Old copy customer').first().waitFor();
      const moved = await keys(page);
      assert.ok(!moved.includes('local-trial'), 'old record removed after the move');
      assert.ok(moved.includes('local-trial|meta') && moved.includes('local-trial|outbox'));
      assert.ok(moved.some((k) => k.startsWith('local-trial|L|customers|')));

      // Lose one piece: the app opens, says what happened, and keeps working.
      await page.evaluate(() => localStorage.setItem('drill-break', 'local-trial|L|customers|0'));
      await page.reload();
      await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
      await page
        .getByText(/offline copy was damaged/)
        .first()
        .waitFor();
      await page.evaluate(() => localStorage.removeItem('drill-break'));
      await page.reload();
      await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
      assert.equal(
        await page.getByText(/offline copy was damaged/).count(),
        0,
        'repaired copy reads cleanly',
      );
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'My Account', exact: true })
        .click();
      await page.getByRole('heading', { name: 'This device' }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    'Offline storage passed Chromium/WebKit: old copy moved to pieces; lost piece repaired; This device shown.',
  );
} finally {
  server.kill();
}
