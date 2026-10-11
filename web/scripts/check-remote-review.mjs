import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4195', '--strictPort'],
  { stdio: 'inherit' },
);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cashier = uuid(1),
  admin = uuid(2),
  shop = uuid(3),
  a = uuid(4),
  b = uuid(5),
  paper = uuid(6),
  film = uuid(7),
  print = uuid(8),
  laminate = uuid(9),
  now = new Date().toISOString();
const actor = { id: cashier, label: 'Cashier' };
const makeToken = (id) =>
  [
    { alg: 'HS256', typ: 'JWT' },
    { sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
    'c2lnbmF0dXJl',
  ]
    .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
    .join('.');
const user = (id) => ({
  id,
  aud: 'authenticated',
  role: 'authenticated',
  email: (id === admin ? 'admin' : 'cashier') + '@example.invalid',
  user_metadata: {},
  app_metadata: { provider: 'email' },
  created_at: now,
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4195')).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const mobile of [false, true]) {
    let base = emptyLedger();
    for (const [kind, data] of [
      ['customer', { id: a, name: 'Customer A', phone: '080111', address: '', creditLimit: 0 }],
      ['customer', { id: b, name: 'Customer B', phone: '080222', address: '', creditLimit: 0 }],
      [
        'material',
        { id: paper, name: 'Paper', available: 100, measurementUnit: 'sheet', requireSize: false },
      ],
      ['material', { id: film, name: 'Film', available: 100, measurementUnit: 'sheet', requireSize: false }],
      ['service', { id: print, description: 'Printing', materialId: paper, price: 10000 }],
      ['service', { id: laminate, description: 'Laminating', materialId: film, price: 10000 }],
    ])
      base = applyEvent(base, {
        id: crypto.randomUUID(),
        kind: kind + '.created',
        data: { ...data, modifiedBy: admin, modifiedByLabel: 'Admin', modifiedAt: now },
      });
    const sale = prepareCheckout(
      base,
      {
        customerId: a,
        lines: [
          {
            id: uuid(10),
            serviceId: print,
            description: 'Offline print job',
            quantity: 10,
            source: 'WhatsApp',
          },
        ],
        cashReceived: 100000,
        useWallet: false,
        method: 'Cash',
        paidOn: now.slice(0, 10),
      },
      actor,
      uuid(11),
      now,
    );
    const other = prepareCheckout(
      base,
      {
        customerId: b,
        lines: [
          {
            id: uuid(12),
            serviceId: laminate,
            description: 'Independent film job',
            quantity: 5,
            source: 'WhatsApp',
          },
        ],
        cashReceived: 50000,
        useWallet: false,
        method: 'Cash',
        paidOn: now.slice(0, 10),
      },
      actor,
      uuid(13),
      now,
    );
    let cloud = applyEvent(base, {
        id: uuid(14),
        kind: 'material.stock_set',
        data: {
          id: paper,
          baseVersion: 1,
          quantity: 90,
          reason: 'Physical count',
          modifiedBy: admin,
          modifiedByLabel: 'Admin',
          modifiedAt: now,
        },
      }),
      queue = [],
      aliases = new Set(),
      writes = [],
      reviews = 0;
    const token = () => JSON.stringify(cloud);
    const contexts = [];
    const errors = [];
    async function device(id) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        serviceWorkers: 'block',
      });
      contexts.push(context);
      await context.route('https://*.supabase.co/**', async (route) => {
        const path = new URL(route.request().url()).pathname,
          body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
        let result = {},
          status = 200;
        if (path === '/auth/v1/token')
          result = {
            access_token: makeToken(id),
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-' + id,
            user: user(id),
          };
        else if (path === '/auth/v1/user') result = user(id);
        else if (path === '/auth/v1/logout') result = {};
        else if (path.endsWith('/list_business_shops')) result = [{ id: shop, name: 'Remote review test' }];
        else if (path.endsWith('/list_my_shops'))
          result = [
            {
              id: shop,
              name: 'Remote review test',
              userId: id,
              role: id === admin ? 'manager' : 'cashier',
              rank: id === admin ? 3 : 1,
              accessLevel: id === admin ? 3 : 1,
              username: id === admin ? 'admin' : 'cashier',
              staffName: id === admin ? 'Admin' : 'Cashier',
            },
          ];
        else if (path.endsWith('/business_settings')) result = [];
        else if (path.endsWith('/get_ledger')) result = cloud;
        else if (path.endsWith('/apply_checkout_event')) {
          writes.push(body.p_event.id);
          if (!aliases.has(body.p_event.id)) {
            try {
              cloud = applyEvent(cloud, body.p_event);
            } catch (error) {
              status = 409;
              result = { code: 'PT409', message: error.message };
            }
          }
        } else if (path.endsWith('/submit_sync_conflict')) {
          if (!queue.some((item) => item.event_id === body.p_event.id))
            queue.push({
              event_id: body.p_event.id,
              actor_id: id,
              actor_label: 'Cashier',
              source: body.p_event,
              message: body.p_message,
              status: 'pending',
              submitted_at: now,
            });
        } else if (path.endsWith('/list_sync_conflicts'))
          result = queue.filter(
            (item) =>
              (id === admin || item.actor_id === id) &&
              (!body.p_events || body.p_events.includes(item.event_id)),
          );
        else if (path.endsWith('/get_sync_conflict')) {
          assert.equal(id, admin);
          result = {
            conflict: queue.find((item) => item.event_id === body.p_event),
            ledger: cloud,
            token: token(),
          };
        } else if (path.endsWith('/resolve_sync_conflict')) {
          assert.equal(id, admin);
          const item = queue.find((item) => item.event_id === body.p_event);
          if (item.status !== 'pending' || body.p_token !== token()) {
            status = 409;
            result = {
              code: 'PT409',
              message: 'The reviewed records changed. Refresh and review the latest values.',
            };
          } else {
            for (const event of body.p_replacements) {
              assert.equal(event.data.createdBy, cashier);
              cloud = applyEvent(cloud, event);
            }
            aliases.add(item.event_id);
            item.status = 'resolved';
            item.replacements = body.p_replacements;
            item.reviewer_label = 'Admin';
            item.reason = body.p_reason;
            item.resolved_at = now;
            reviews++;
          }
        } else throw Error('Unexpected remote-review request ' + path);
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://127.0.0.1:4195');
      await page.getByLabel('Business email', { exact: true }).fill(user(id).email);
      await page.getByLabel('Business password', { exact: true }).fill('synthetic-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
      await page.locator('.sync-status').getByText('Saved', { exact: false }).waitFor();
      return page;
    }
    const till = await device(cashier);
    await till.evaluate(
      async ({ scope, state }) => {
        await new Promise((resolve, reject) => {
          const r = indexedDB.open('printshopledger-v1', 1);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction('ledgers', 'readwrite');
            tx.objectStore('ledgers').put(state, scope);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      {
        scope: cashier + ':' + shop,
        state: { ledger: applyEvent(applyEvent(base, sale), other), pending: [sale, other] },
      },
    );
    await till.reload();
    await till.getByRole('alert').filter({ hasText: 'Admin review required.' }).waitFor();
    assert.equal(await till.getByRole('button', { name: 'Add job', exact: true }).isEnabled(), true);
    assert.equal(cloud.checkouts.length, 1);
    assert.equal(cloud.checkouts[0].id, other.id);
    assert.equal(cloud.materials.find((m) => m.id === paper).available, 90);
    assert.equal(cloud.materials.find((m) => m.id === film).available, 95);
    await till.getByRole('button', { name: 'Add job', exact: true }).click();
    let d = till.getByRole('dialog', { name: 'New checkout' });
    await d.getByLabel('Service', { exact: true }).selectOption(print);
    await d.getByLabel('Job description').fill('Depends on disputed paper');
    await d.getByLabel('Quantity', { exact: true }).fill('1');
    await d.getByRole('combobox', { name: 'Customer name or phone' }).fill('Customer B');
    await d.getByRole('option').filter({ hasText: 'Customer B' }).click();
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.getByRole('alert').filter({ hasText: 'awaiting Admin review' }).waitFor();
    assert.equal(cloud.checkouts.length, 1);
    await d.getByRole('button', { name: 'Close', exact: true }).click();
    const office = await device(admin);
    if (mobile) await office.getByRole('button', { name: 'Menu', exact: true }).click();
    await office
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Conflict Inbox', exact: true })
      .click();
    await office.getByRole('button', { name: 'Review conflict', exact: true }).click();
    d = office.getByRole('dialog', { name: 'Remote conflict review' });
    await d.getByLabel('Review reason').fill('Cashier usage included in physical count');
    await d.getByRole('button', { name: 'Review sale and stock', exact: true }).click();
    d = office.getByRole('dialog', { name: 'Review pending checkout' });
    await d.waitFor();
    await d.getByLabel('Already included in physical count: Offline print job').check();
    await d.getByLabel('I have reviewed the stock count and the material deduction.').check();
    // Another device changes stock after the review opens: the original decision must fail.
    cloud = applyEvent(cloud, {
      id: crypto.randomUUID(),
      kind: 'material.stock_added',
      data: {
        id: paper,
        baseVersion: cloud.materials.find((m) => m.id === paper).version,
        quantity: 5,
        reason: 'Delivery',
        modifiedBy: admin,
        modifiedByLabel: 'Admin',
        modifiedAt: now,
      },
    });
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.getByRole('alert').filter({ hasText: 'reviewed records changed' }).waitFor();
    assert.equal(reviews, 0);
    await d.getByRole('button', { name: 'Close', exact: true }).click();
    d = office.getByRole('dialog', { name: 'Remote conflict review' });
    await d.getByRole('button', { name: 'Reload review', exact: true }).click();
    await d.getByLabel('Review reason').fill('Usage counted; subsequent delivery retained');
    await d.getByRole('button', { name: 'Review sale and stock', exact: true }).click();
    d = office.getByRole('dialog', { name: 'Review pending checkout' });
    await d.getByLabel('Already included in physical count: Offline print job').check();
    await d.getByLabel('I have reviewed the stock count and the material deduction.').check();
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await till.evaluate(() => window.dispatchEvent(new Event('focus')));
    await till
      .getByRole('alert')
      .filter({ hasText: 'Admin review required.' })
      .waitFor({ state: 'detached' });
    const local = await till.evaluate(
      (scope) =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open('printshopledger-v1', 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction('ledgers').objectStore('ledgers').get(scope);
            q.onsuccess = () => {
              db.close();
              resolve(q.result);
            };
            q.onerror = () => reject(q.error);
          };
        }),
      cashier + ':' + shop,
    );
    assert.equal(local.pending.length, 0);
    assert.equal(local.ledger.checkouts.length, 2);
    assert.equal(
      local.ledger.payments.reduce((sum, p) => sum + p.amount, 0),
      150000,
    );
    assert.equal(reviews, 1);
    assert.equal(cloud.materials.find((m) => m.id === paper).available, 95);
    assert.equal(cloud.checkouts.length, 2);
    assert.equal(
      cloud.payments.reduce((sum, p) => sum + p.amount, 0),
      150000,
    );
    assert.equal(cloud.checkouts.find((r) => r.id !== other.id).createdBy, cashier);
    assert.equal(writes.filter((id) => id === sale.id).length, 1, 'Held source was not retried');
    assert.deepEqual(errors, []);
    for (const context of contexts) await context.close();
    console.log(
      'Remote review, stale decision protection and independent sales passed on ' +
        (mobile ? 'mobile' : 'desktop'),
    );
  }
} finally {
  await browser?.close();
  server.kill();
}
