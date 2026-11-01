// Measures the app with a business the size of SMGraphics (made-up data): how long each main
// screen takes on a slowed-down computer, and which functions use the time. Run in CI.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { readCopy } from './local-copy.mjs';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { prepareCheckout } from '../src/checkout.mjs';

const SIZE = { customers: 250, services: 23, materials: 12, sales: 1060, days: 120 };
const CPU_SLOWDOWN = Number(process.env.CPU_SLOWDOWN ?? 4);
const actor = { id: '10000000-0000-4000-8000-000000000001', label: 'Cashier' };
const uuid = (n, p = '9') => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function bigLedger() {
  const now = Date.now();
  const day = (i) => new Date(now - (SIZE.days - (i % SIZE.days)) * 86400000).toISOString();
  let ledger = {
    ...emptyLedger(),
    moneyAccounts: [
      ['Cash', 'cash', 'Cash'],
      ['POS', 'pos', 'POS'],
      ['Transfer', 'bank', 'Transfer'],
    ].map(([name, accountType, kind], i) => ({
      id: uuid(i + 1, '7'),
      name,
      accountType,
      openingDate: '2020-01-01',
      openingBalance: 0,
      archived: false,
      version: 1,
      methods: [name],
      paymentMethods: [{ id: uuid(i + 1, '6'), name, label: name, kind, enabled: true, aliases: [] }],
    })),
  };
  ledger.materials = Array.from({ length: SIZE.materials }, (_, i) => ({
    id: uuid(i + 1, '3'),
    name: `Stock item ${i + 1}`,
    available: 100000,
    measurementUnit: 'sheet',
    requireSize: false,
    minimumStock: 10,
    archived: false,
    version: 1,
    createdBy: actor.id,
    modifiedBy: actor.id,
  }));
  ledger.services = Array.from({ length: SIZE.services }, (_, i) => ({
    id: uuid(i + 1, '4'),
    description: `Service ${i + 1}`,
    materialId: ledger.materials[i % SIZE.materials].id,
    price: 5000 + i * 1500,
    version: 1,
    archived: false,
  }));
  ledger.customers = Array.from({ length: SIZE.customers }, (_, i) => ({
    id: uuid(i + 1, '2'),
    name: `Customer ${i + 1}`,
    phone: `0803${String(i).padStart(7, '0')}`,
    address: 'Kano',
    creditLimit: 0,
    archived: false,
    version: 1,
  }));
  const t0 = Date.now();
  for (let i = 0; i < SIZE.sales; i++) {
    const at = day(i);
    const service = ledger.services[i % SIZE.services];
    const lines = Array.from({ length: 1 + (i % 3 === 0 ? 1 : 0) }, (_, k) => ({
      id: crypto.randomUUID(),
      serviceId: ledger.services[(i + k) % SIZE.services].id,
      description: `Job ${i}-${k}`,
      quantity: 1 + (i % 7),
      source: 'Walk-in',
      sourceNote: '',
    }));
    const total = lines.length * service.price * (1 + (i % 7));
    const method = ['Cash', 'POS', 'Transfer'][i % 3];
    const event = prepareCheckout(
      ledger,
      {
        customerId: ledger.customers[i % SIZE.customers].id,
        lines,
        cashReceived: i % 5 === 0 ? 0 : total,
        useWallet: false,
        method,
        methodLabel: method,
        accountId: ledger.moneyAccounts[i % 3].id,
        paidOn: at.slice(0, 10),
        reference: '',
      },
      actor,
      crypto.randomUUID(),
      at,
    );
    ledger = applyEvent(ledger, event);
  }
  // Most older jobs are finished.
  ledger.jobs = ledger.jobs.map((j, i) => (i < ledger.jobs.length - 60 ? { ...j, productionStatus: 'Collected' } : j));
  console.log(
    `Built ledger in ${Date.now() - t0} ms: ${ledger.jobs.length} jobs, ${ledger.checkouts.length} sales, ${ledger.payments.length} payments, ${ledger.materialHistory.length} stock changes, ${(JSON.stringify(ledger).length / 1e6).toFixed(1)} MB`,
  );
  return ledger;
}

async function run(mode, port) {
  const base = `http://127.0.0.1:${port}`;
  const args =
    mode === 'dev'
      ? ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
      : ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const server = spawn(process.execPath, args, { stdio: 'ignore' });
  const browser = await chromium.launch({ headless: true });
  try {
    for (let i = 0; i < 300; i++) {
      try {
        if ((await fetch(base)).ok) break;
      } catch {}
      await delay(100);
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    console.log(`[${mode}] trial open, loading records`);
    const state = await readCopy(page, 'local-trial');
    state.ledger = { ...state.ledger, ...bigLedger() };
    state.pending = [];
    await page.evaluate(
      (state) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('printshopledger-v1', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('ledgers', 'readwrite');
            tx.objectStore('ledgers').put(state, 'local-trial');
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      state,
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await page.addInitScript(() => {
      window.__long = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long += e.duration;
      }).observe({ type: 'longtask', buffered: true });
    });
    // The screen is settled when the browser can draw again after a short pause.
    const settle = () =>
      page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(r), 300))),
      );
    const results = [];
    const step = async (name, action, ready) => {
      await page.evaluate(() => (window.__long = 0)).catch(() => {});
      const t = Date.now();
      console.log(`[${mode}] ${name}: started`);
      try {
        await action();
        await ready();
        await settle();
      } catch (e) {
        console.log(`[${mode}] ${name}: GAVE UP after ${Date.now() - t} ms (${e.message.split('\n')[0]})`);
        results.push({ step: name, ms: 'over limit' });
        return;
      }
      const blocked = await page.evaluate(() => Math.round(window.__long));
      results.push({ step: name, ms: Date.now() - t - 300, blockedMs: blocked });
      console.log(`[${mode}] ${name}: ${Date.now() - t - 300} ms (blocked ${blocked} ms)`);
    };
    await cdp.send('Profiler.start');
    await step(
      'Open app (load records)',
      () => page.goto(base),
      () => page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor(),
    );
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const name of [
      'Dashboard',
      'Reports',
      'Jobs',
      'Customers',
      'Payments',
      'Payment Reminders',
      'Accounts',
      'Materials',
      'Stock History',
      'My Sales',
      'Point of Service',
    ]) {
      const button = nav.getByRole('button', { name, exact: true });
      if (!(await button.count())) {
        results.push({ step: name, ms: 'not in menu' });
        continue;
      }
      await step(
        name,
        () => button.click(),
        () => page.locator('main h1, h1').first().waitFor(),
      );
    }
    // A sale with the large record set: open the checkout and close it.
    await step(
      'Open "Add" checkout dialog',
      () => page.getByRole('button', { name: /^Add (job|order)$/ }).first().click(),
      () => page.getByRole('dialog').first().waitFor(),
    );
    const { profile } = await cdp.send('Profiler.stop');
    console.log(`\n=== ${mode} build, CPU ${CPU_SLOWDOWN}x slower ===`);
    console.table(results);
    if (errors.length) console.log('Page errors:', errors.slice(0, 5));
    // Self time per function.
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const n = nodes.get(id);
      const f = n.callFrame;
      const file = (f.url || '').replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '');
      const key = `${f.functionName || '(anonymous)'}  ${file}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`Top functions by own time (of ${Math.round(total)} ms sampled):`);
    for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40))
      console.log(`${String(Math.round(v)).padStart(7)} ms  ${k}`);
    // Inclusive time for app functions (src/), to see which screen computations are heavy.
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map();
    profile.samples.forEach((id, i) => {
      const seen = new Set();
      for (let cur = id; cur; cur = parent.get(cur)) {
        const f = nodes.get(cur).callFrame;
        if (!/\/src\//.test(f.url)) continue;
        const key = `${f.functionName || '(anonymous)'}  ${f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        incl.set(key, (incl.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
      }
    });
    console.log('Top app functions including what they call:');
    for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40))
      console.log(`${String(Math.round(v)).padStart(7)} ms  ${k}`);
    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }
}

await run('preview', 4301);
if (process.env.PROFILE_DEV) await run('dev', 4302);
