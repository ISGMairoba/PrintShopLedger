// Focused screenshots for a UI review at four widths: wide desktop, laptop, half screen and phone.
// Run after `npm run build`: node scripts/ui-probe.mjs <output folder>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fixture } from '../tests/pricing-fixture.mjs';
import { applyEvent } from '../src/domain.mjs';

const out = process.argv[2] ?? '/tmp/ui-probe';
mkdirSync(out, { recursive: true });
const port = 4198;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
const f = fixture();
const ledger = applyEvent(f.ledger, f.event);
const base = ledger.materials[0];
const uid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Materials near or below their minimum, for Critical stock and the Materials list.
for (let i = 0; i < 14; i++)
  ledger.materials.push({
    ...base,
    id: uid(100 + i),
    name:
      ['Art Card (A3)', 'Art Card (A4)', 'Carbonise Paper (White & 1 Color)', 'Sticker roll', 'Vinyl 5ft'][
        i % 5
      ] + ` ${i}`,
    available: i % 3,
    minimumStock: 5,
    measurementUnit: ['A3', 'A4', 'sheet', 'ft'][i % 4],
    requireSize: i % 4 === 3,
  });
// Shelf products with packs and variants, for Quick sale.
const svcBase = {
  ...ledger.services[0],
  materialId: null,
  materialOptions: undefined,
  shelfItem: true,
  private: false,
};
const shelf = (n, description, price, extra = {}) => ({
  ...svcBase,
  id: uid(200 + n),
  description,
  price,
  ...extra,
});
const packs = [
  { quantity: 50, price: 130000 },
  { quantity: 100, price: 25000 },
];
ledger.services.push(
  shelf(1, 'Art Card (A3)', 8000),
  shelf(2, 'Carbonise Paper (White & 1 Color)', 3000, { packPrices: packs }),
  shelf(3, 'Carbonize Paper A5 (white & 1 Color)', 1500, { packPrices: packs }),
  shelf(4, 'Cream Paper', 2500),
  shelf(5, 'Crochet Rope · Gold', 5000, { variantGroup: 'rope', variantName: 'Gold', packPrices: packs }),
  shelf(6, 'Crochet Rope · Green', 5000, { variantGroup: 'rope', variantName: 'Green', packPrices: packs }),
  shelf(7, 'Crochet Rope · Pink', 5000, { variantGroup: 'rope', variantName: 'Pink', packPrices: packs }),
  shelf(8, 'FBB Card 210g', 4000, { packPrices: packs }),
  shelf(9, 'Silver Card 2 Face · Gold', 25000, {
    variantGroup: 'silver',
    variantName: 'Gold',
    packPrices: packs,
  }),
  shelf(10, 'Silver Card 2 Face · White', 25000, {
    variantGroup: 'silver',
    variantName: 'White',
    packPrices: packs,
  }),
  shelf(11, 'Plain Paper', 1000),
  shelf(12, 'Straw Board (A5)', 6000),
  ...Array.from({ length: 24 }, (_, i) =>
    shelf(
      20 + i,
      `Envelope ${['A4', 'A5', 'DL', 'C4'][i % 4]} ${i}`,
      1000 + i * 100,
      i % 3 ? {} : { packPrices: packs },
    ),
  ),
);
// More customers with long details.
for (let i = 0; i < 6; i++)
  ledger.customers.push({
    ...ledger.customers[0],
    id: uid(300 + i),
    name: i % 2 ? `+234 703 030 45${i}6` : `Sara Jewelry Kano ${i}`,
    phone: `+234 703 030 45${i}6`,
    address: i % 3 ? '' : '12 Bompai Road, Kano',
    creditLimit: 1800000,
  });
// A quotation made from the fixture's template sale.
const now = '2026-10-18T10:00:00Z';
ledger.quotations = [
  {
    id: uid(400),
    customerId: ledger.customers[0].id,
    customerName: 'Sara Jewelry Kano',
    customerPhone: '+234 703 321 3325',
    lines: f.event.data.jobs.map((j) => ({ ...j, discountAmount: 0 })),
    orderDiscount: null,
    subtotal: f.event.data.jobs.reduce((n, j) => n + j.amount, 0),
    discountTotal: 0,
    total: f.event.data.jobs.reduce((n, j) => n + j.amount, 0),
    validUntil: '2026-12-01',
    note: '',
    status: 'open',
    version: 1,
    createdBy: uid(1),
    createdByLabel: 'Tester',
    createdAt: now,
    modifiedBy: uid(1),
    modifiedByLabel: 'Tester',
    modifiedAt: now,
    lastEventId: uid(401),
  },
];
// Expenses with materials and part payments.
const audit = {
  version: 1,
  createdBy: uid(1),
  createdByLabel: 'smgraphics2nd',
  createdAt: now,
  modifiedBy: uid(1),
  modifiedByLabel: 'smgraphics2nd',
  modifiedAt: now,
  lastEventId: uid(500),
};
ledger.expenses = [
  {
    id: uid(501),
    description: 'Restock: DI PRINTING',
    category: 'Materials',
    incurredOn: '2026-10-13',
    amount: 5000000,
    payee: 'SMG',
    note: '',
    receiptReference: '',
    materials: [{ materialId: base.id, name: 'DI PRINTING', quantity: 1000, measurementUnit: 'A4' }],
    payments: [{ id: uid(502), amount: 5000000, paidOn: '2026-10-13', method: 'Cash' }],
    voided: false,
    voidReason: '',
    ...audit,
  },
  {
    id: uid(503),
    description: 'Restock: SAV, SUBLIMATION',
    category: 'Materials',
    incurredOn: '2026-10-13',
    amount: 45000000,
    payee: 'SMG',
    note: '',
    receiptReference: '',
    materials: [],
    payments: [{ id: uid(504), amount: 20000000, paidOn: '2026-10-13', method: 'Transfer' }],
    voided: false,
    voidReason: '',
    ...audit,
  },
];
const settings = { ...f.settings, businessName: 'Mairoba Studio' };
settings.pricing = { ...settings.pricing, enabled: true };

let browser;
const notes = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const [mode, width, height, mobile, theme] of [
    ['w1920', 1920, 1020, false, 'dark'],
    ['w1590', 1590, 1000, false, 'dark'],
    ['w1280', 1280, 800, false, 'light'],
    ['w1000', 1000, 800, false, 'dark'],
    ['w390', 390, 844, true, 'light'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      serviceWorkers: 'block',
      colorScheme: theme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(`http://127.0.0.1:${port}`);
    await page.evaluate(
      async ({ ledger, settings }) => {
        localStorage.setItem(
          'printshopledger:branding:v1:local-trial',
          JSON.stringify({ settings, version: 1 }),
        );
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('printshopledger-v1', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('ledgers');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('ledgers', 'readwrite');
          const st = tx.objectStore('ledgers');
          st.delete(IDBKeyRange.bound('local-trial|', 'local-trial|￿'));
          st.put({ ledger, pending: [] }, 'local-trial');
          tx.oncomplete = resolve;
          tx.onerror = reject;
        });
        db.close();
      },
      { ledger: { ...ledger, settings: undefined }, settings: { ...settings, theme } },
    );
    await page.reload();
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await delay(600);
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
      await delay(500);
    };
    const shot = async (name, full = false) => {
      await delay(300);
      await page.screenshot({ path: `${out}/${mode}-${name}.png`, fullPage: full });
    };
    const close = async () => {
      for (let i = 0; i < 4 && (await page.locator('dialog[open]').count()); i++) {
        const d = page.locator('dialog[open]').last();
        const button = d.getByRole('button', { name: /^(Close|Cancel|Discard|Leave)/ }).first();
        if (await button.count()) await button.click({ timeout: 2000 }).catch(() => {});
        else await page.keyboard.press('Escape');
        await delay(250);
      }
      if (await page.locator('dialog[open]').count()) {
        await page.reload();
        await delay(800);
      }
    };
    const step = async (name, run) => {
      try {
        await run();
      } catch (e) {
        notes.push(`${mode} ${name}: ${e.message.split('\n')[0]}`);
      }
      await close();
    };
    await step('pos', async () => {
      await nav('Point of Service');
      await shot('01-pos');
    });
    await step('quick sale', async () => {
      await nav('Point of Service');
      await page
        .getByRole('button', { name: /Quick sale/ })
        .first()
        .click();
      await page.getByRole('dialog', { name: 'Quick sale' }).waitFor();
      await shot('02-quick-sale');
      // Overlap check: no two product tiles may share pixels.
      const overlaps = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('.quick-products > *')].map((el) =>
          el.getBoundingClientRect(),
        );
        let n = 0;
        tiles.forEach((a, i) =>
          tiles.slice(i + 1).forEach((b) => {
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
              n++;
          }),
        );
        const spill = [...document.querySelectorAll('.quick-products > *')].filter(
          (el) => el.scrollHeight > el.clientHeight + 2,
        ).length;
        return { n, spill };
      });
      notes.push(
        `${mode} quick sale: overlapping tiles ${overlaps.n}, tiles with spilling text ${overlaps.spill}`,
      );
    });
    await step('receive payment', async () => {
      await nav('Point of Service');
      await page
        .getByRole('button', { name: /Receive payment/ })
        .first()
        .click();
      await delay(400);
      await shot('03-receive-payment');
    });
    await step('checkout', async () => {
      await nav('Point of Service');
      await page
        .getByRole('button', { name: /Add job/ })
        .first()
        .click();
      await delay(400);
      const d = page.getByRole('dialog').last();
      await d.locator('#checkout-customer-input').scrollIntoViewIfNeeded();
      await shot('04-checkout-customer');
    });
    await step('search select', async () => {
      await nav('Point of Service');
      await page
        .getByRole('button', { name: /Add job/ })
        .first()
        .click();
      const d = page.getByRole('dialog').last();
      const box = d.getByRole('combobox', { name: 'Service', exact: true });
      await box.click();
      await box.fill('env a4');
      await delay(300);
      await shot('19-service-search');
    });
    await step('jobs', async () => {
      await nav('Jobs');
      await shot('05-jobs');
    });
    await step('customers', async () => {
      await nav('Customers');
      await shot('06-customers');
    });
    await step('materials', async () => {
      await nav('Materials');
      await shot('07-materials');
    });
    for (const [name, label] of [
      ['Payments', '15-payments'],
      ['Stock History', '16-stock-history'],
      ['Expenses', '17-expenses'],
      ['My Sales', '18-my-sales'],
    ])
      await step(label, async () => {
        await nav(name);
        await shot(label);
      });
    await step('dashboard', async () => {
      await nav('Dashboard');
      const panel = page.getByRole('heading', { name: 'Critical stock' });
      await panel.scrollIntoViewIfNeeded();
      await shot('08-dashboard-stock');
    });
    await step('quotation', async () => {
      await nav('Quotations');
      await page.getByRole('main').getByRole('button', { name: /View/ }).first().click();
      await delay(400);
      await shot('09-quotation');
    });
    for (const [name, label] of [
      ['Materials', '11-materials-audit'],
      ['Customers', '12-customers-audit'],
      ['Services', '13-services-audit'],
      ['Expenses', '14-expenses-audit'],
    ])
      await step(label, async () => {
        await nav(name);
        await page
          .getByRole('main')
          .getByRole('button', { name: /Audit view/ })
          .first()
          .click();
        await delay(400);
        await shot(label);
        await page
          .getByRole('main')
          .getByRole('button', { name: /Audit view/ })
          .first()
          .click();
      });
    await context.close();
  }
} finally {
  console.log(notes.join('\n'));
  await browser?.close();
  server.kill();
}
