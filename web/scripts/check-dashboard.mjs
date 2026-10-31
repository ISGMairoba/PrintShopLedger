import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4181', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4181')).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  for (const mobile of [false, true])
    for (const rank of [1, 2, 3, 4]) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        serviceWorkers: 'block',
      });
      const id = '11111111-1111-4111-8111-111111111111',
        shop = '22222222-2222-4222-8222-222222222222',
        now = new Date().toISOString(),
        role = ['', 'cashier', 'admin', 'manager', 'developer'][rank];
      const token = [
        { alg: 'HS256', typ: 'JWT' },
        { sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
        'c2lnbmF0dXJl',
      ]
        .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
        .join('.');
      const user = {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'test@example.invalid',
        user_metadata: { full_name: 'Test User' },
        app_metadata: { provider: 'email' },
        created_at: now,
      };
      let settings = { ...defaultBranding(), businessName: 'Mairoba Studios' };
      // Saving settings raises their version, which tells devices to download them again.
      let settingsVersion = 1;
      const ledger = emptyLedger();
      ledger.jobs = [
        {
          id: 'test-job',
          customerId: 'customer',
          service: 'Banner printing',
          quantity: 3,
          source: 'WhatsApp',
          description: 'Test banner',
          amount: 4500000,
          createdAt: '2026-10-09T09:00:00Z',
          productionStatus: 'Queued',
        },
      ];
      ledger.customers = [{ id: 'customer', name: 'Test customer', creditLimit: 10000000 }];
      ledger.payments = [
        {
          id: 'payment',
          customerId: 'customer',
          amount: 1000000,
          method: 'Cash',
          paidOn: '2026-10-09',
          createdAt: '2026-10-09',
          allocations: [{ jobId: 'test-job', amount: 1000000 }],
        },
      ];
      ledger.payments.push({
        id: 'transfer',
        customerId: 'customer',
        amount: 500000,
        method: 'Bank transfer',
        paidOn: '2026-10-09',
        createdAt: '2026-10-09',
        allocations: [{ jobId: 'test-job', amount: 500000 }],
      });
      ledger.materials = [
        {
          id: 'material',
          name: 'Flex roll',
          available: -2,
          minimumStock: 5,
          measurementUnit: 'ft',
          archived: false,
        },
        {
          id: 'near',
          name: 'Paper near minimum',
          available: 12,
          minimumStock: 10,
          measurementUnit: 'sheet',
          archived: false,
        },
        {
          id: 'healthy',
          name: 'Healthy paper',
          available: 13,
          minimumStock: 10,
          measurementUnit: 'sheet',
          archived: false,
        },
      ];
      ledger.expenses = [
        {
          id: 'expense',
          description: 'Transport',
          amount: 500000,
          incurredOn: '2026-10-09',
          payments: [{ amount: 200000, paidOn: '2026-10-09' }],
          voided: false,
        },
      ];
      await context.route('https://*.supabase.co/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        let result = {};
        if (path === '/auth/v1/token')
          result = {
            access_token: token,
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-refresh',
            user,
          };
        else if (path === '/auth/v1/user') result = user;
        else if (path.endsWith('/list_business_shops')) result = [{ id: shop, name: 'Mairoba Studios' }];
        else if (path.endsWith('/list_my_shops'))
          result = [
            {
              id: shop,
              name: 'Mairoba Studios',
              userId: id,
              role,
              rank,
              accessLevel: rank,
              username: role,
              staffName: 'Test User',
            },
          ];
        else if (path.endsWith('/business_settings')) result = [{ settings, version: settingsVersion }];
        else if (path.endsWith('/report_problems')) result = null;
        else if (path.endsWith('/my_subscription')) result = { state: 'none' };
        else if (path.endsWith('/report_device') || path.endsWith('/ack_device_sign_out'))
          result = { signOut: false };
        else if (/\/get_ledger(_changes)?$/.test(path)) result = ledger;
        else throw Error('Unexpected request: ' + path);
        // Syncs ask for changes since a cursor; this test server always sends everything.
        if (path.endsWith('/get_ledger_changes')) result = { cursor: '1', full: true, ledger: result };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://127.0.0.1:4181');
      await page.getByLabel('Business email', { exact: true }).fill('test@example.invalid');
      await page.getByLabel('Business password', { exact: true }).fill('test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
      const open = async () => {
        if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      };
      await open();
      const nav = page.getByRole('navigation', { name: 'Main' });
      if (rank === 1) {
        assert.equal(await nav.getByRole('button', { name: 'Dashboard', exact: true }).count(), 0);
        await context.close();
        continue;
      }
      await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
      await page.getByLabel('From', { exact: true }).fill('2026-10-09');
      await page.getByLabel('To', { exact: true }).fill('2026-10-09');
      const values = page.locator('.dashboard-stats').first();
      await values.getByText('₦45,000.00', { exact: true }).waitFor();
      await values.getByText('₦15,000.00', { exact: true }).waitFor();
      await values.getByText('₦13,000.00', { exact: true }).waitFor();
      await page.getByText('₦30,000.00', { exact: true }).waitFor();
      await page.locator('.dashboard-row').filter({ hasText: 'Flex roll' }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Dashboard fits viewport',
      );
      await page.getByRole('heading', { name: 'Critical stock', exact: true }).waitFor();
      await page.locator('.dashboard-row.stock-near').filter({ hasText: 'Paper near minimum' }).waitFor();
      assert.equal(await page.locator('.dashboard-row').filter({ hasText: 'Healthy paper' }).count(), 0);
      const positions = await values.locator('article').evaluateAll((items) =>
        items.map((item) => ({
          top: item.getBoundingClientRect().top,
          left: item.getBoundingClientRect().left,
        })),
      );
      assert.equal(positions.length, 6);
      if (!mobile) {
        assert.equal(positions[0].top, positions[2].top);
        assert.equal(positions[3].top, positions[5].top);
        assert.ok(positions[3].top > positions[0].top);
      } else {
        assert.equal(positions[0].top, positions[1].top);
        assert.ok(positions[2].top > positions[0].top);
      }
      await values.getByText('Money In − Money Out', { exact: true }).waitFor();
      await values.getByText('₦40,000.00', { exact: true }).waitFor();
      assert.equal(await page.locator('.dashboard-pie').count(), 2);
      const services = page.getByRole('region', { name: 'Top 5 services' });
      await page.getByLabel('Rank services by', { exact: true }).selectOption('quantity');
      await services.locator('.dashboard-row').getByText('3', { exact: true }).waitFor();
      await page.getByLabel('Rank services by', { exact: true }).selectOption('sales');
      await services.locator('.dashboard-row').getByText('₦45,000.00', { exact: true }).waitFor();
      const sources = page.getByRole('region', { name: 'Job sources' });
      await sources.getByRole('button', { name: 'Hide WhatsApp', exact: true }).waitFor();
      await page.getByLabel('Compare job sources by', { exact: true }).selectOption('quantity');
      await sources.locator('.dashboard-row').getByText('3', { exact: true }).waitFor();
      await page.getByLabel('Compare job sources by', { exact: true }).selectOption('sales');
      await sources.locator('.dashboard-row').getByText('₦45,000.00', { exact: true }).waitFor();
      const customers = page.getByRole('region', { name: 'Top 5 customers' });
      await customers.locator('.dashboard-row').filter({ hasText: 'Test customer' }).waitFor();
      await page.getByLabel('Rank customers by', { exact: true }).selectOption('quantity');
      await customers.locator('.dashboard-row').getByText('3', { exact: true }).waitFor();
      // All charts use Recharts; pie selection persists on tap and legends do not alter record totals.
      const methods = page.getByRole('region', { name: 'Payment methods' });
      const slicePoint = async (name) => {
        const slice = methods.getByRole('button', { name: `Select ${name}:`, exact: false });
        await slice.scrollIntoViewIfNeeded();
        return slice.evaluate((element) => {
          const svg = element.closest('svg'),
            box = svg.getBoundingClientRect(),
            view = svg.viewBox.baseVal,
            radius = Number(element.dataset.hitRadius),
            angle = (Number(element.dataset.midAngle) * Math.PI) / 180;
          return {
            x:
              box.x + ((Number(element.dataset.centerX) + Math.cos(angle) * radius) * box.width) / view.width,
            y:
              box.y +
              ((Number(element.dataset.centerY) - Math.sin(angle) * radius) * box.height) / view.height,
          };
        });
      };
      const cashPoint = await slicePoint('Cash');
      await page.mouse.click(cashPoint.x, cashPoint.y);
      await methods.locator('.chart-selection').getByText('Cash', { exact: true }).waitFor();
      await methods.locator('.chart-selection').getByText(/66.7%/).waitFor();
      if (!mobile) {
        const point = await slicePoint('Bank transfer');
        await page.mouse.move(point.x, point.y);
        await methods.locator('.chart-selection').getByText('Bank transfer', { exact: true }).waitFor();
        await page.getByRole('heading', { name: 'Payment methods', exact: true }).hover();
        await methods.locator('.chart-selection').getByText('Cash', { exact: true }).waitFor();
      }
      const bankKey = methods.getByRole('button', { name: 'Select Bank transfer: ₦5,000.00', exact: true });
      await page.mouse.move(0, 0);
      await bankKey.focus();
      await page.keyboard.press('Enter');
      await bankKey.evaluate((element) => element.blur());
      await methods.locator('.chart-selection').getByText('Bank transfer', { exact: true }).waitFor();
      await methods.getByRole('button', { name: 'Hide Cash', exact: true }).click();
      await methods
        .locator('.dashboard-row')
        .filter({ hasText: 'Bank transfer' })
        .getByText('100.0%', { exact: true })
        .waitFor();
      await values.getByText('₦15,000.00', { exact: true }).waitFor();
      await methods.getByRole('button', { name: 'Hide Bank transfer', exact: true }).click();
      await methods.getByText('All categories are hidden. Show a category below.', { exact: true }).waitFor();
      await methods.getByRole('button', { name: 'Show Cash', exact: true }).click();
      await methods.getByRole('button', { name: 'Show Bank transfer', exact: true }).click();
      await sources.locator('.recharts-bar-rectangle').first().click();
      await sources.locator('.chart-selection').getByText('WhatsApp', { exact: true }).waitFor();
      await sources.getByRole('button', { name: 'Hide WhatsApp', exact: true }).click();
      await sources.getByText('All categories are hidden. Show a category below.', { exact: true }).waitFor();
      await sources.getByRole('button', { name: 'Show WhatsApp', exact: true }).click();
      await customers.locator('.recharts-bar-rectangle').first().click();
      await customers.locator('.chart-selection').getByText('Test customer', { exact: true }).waitFor();
      const trend = page
        .locator('.dashboard-panel')
        .filter({ has: page.getByRole('heading', { name: 'Daily trend', exact: true }) });
      await trend.getByRole('button', { name: 'Hide Net sales', exact: true }).click();
      await trend.getByRole('button', { name: 'Hide Net collections', exact: true }).click();
      for (const name of ['Expenses incurred', 'Expenses paid', 'Sales less expenses']) {
        const b = trend.getByRole('button', { name: 'Hide ' + name, exact: true });
        if (await b.count()) await b.click();
      }
      await trend.getByText('All series are hidden. Show a series above.', { exact: true }).waitFor();
      await trend.getByRole('button', { name: 'Show Net sales', exact: true }).click();
      await trend.getByRole('button', { name: 'Show Net collections', exact: true }).click();
      const chart = trend.locator('.recharts-surface');
      await chart.focus();
      await page.keyboard.press('ArrowRight');
      await trend.locator('.recharts-tooltip-wrapper').getByText('Net sales', { exact: false }).waitFor();
      assert.equal(
        await page.locator('.recharts-responsive-container').count(),
        5,
        'Every current chart is interactive',
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Interactive charts fit viewport',
      );
      await page.screenshot({
        path: mobile ? '/tmp/ledger-dashboard-mobile.png' : '/tmp/ledger-dashboard-desktop.png',
        fullPage: true,
      });
      await page.getByLabel('From', { exact: true }).fill('2026-10-10');
      await page.getByRole('alert').filter({ hasText: 'Choose valid From' }).waitFor();
      assert.equal(await page.locator('.dashboard-chart').count(), 0);
      await page.getByLabel('From', { exact: true }).fill('2026-10-09');
      await context.setOffline(true);
      await page.getByText(/Offline — showing saved device records/).waitFor();
      await context.setOffline(false);
      if (rank === 2 || rank === 3) {
        settingsVersion++;
        settings = {
          ...settings,
          pageAccess: { ...settings.pageAccess, [String(rank)]: ['Dashboard', 'My Account'] },
        };
        await page.reload();
        await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
        await page
          .getByText('No summary sections are available under your current page permissions.', {
            exact: true,
          })
          .waitFor();
        assert.equal(await page.locator('.dashboard-stats article').count(), 0);
        assert.equal(await page.locator('.dashboard-chart').count(), 0);
        settingsVersion++;
        settings = {
          ...settings,
          pageAccess: {
            ...settings.pageAccess,
            [String(rank)]: ['Dashboard', 'My Account', 'Jobs', 'Payments'],
          },
        };
        await page.reload();
        await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
        await page.getByRole('region', { name: 'Top 5 services' }).waitFor();
        assert.equal(
          await page.getByRole('region', { name: 'Top 5 customers' }).count(),
          0,
          'Hidden Customers page must also hide customer rankings',
        );
      }
      assert.deepEqual(errors, []);
      console.log(`${mobile ? 'Mobile' : 'Desktop'} rank ${rank} dashboard passed.`);
      await context.close();
    }
  console.log('Dashboard figures, dates, permission filtering, offline notice and mobile layout passed.');
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: '/tmp/ledger-dashboard-failure.png', fullPage: true });
    console.error('Chart failure details:', await page.locator('.interactive-chart').allTextContents());
  }
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
