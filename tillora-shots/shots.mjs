// Temporary: screenshots of the live Tillora app (demo workspace) for a UI review.
import { chromium } from 'playwright';
const out = process.argv[2];
const url = 'https://tillora-pos.vercel.app/';
const browser = await chromium.launch();
const log = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [mode, opts] of [
  ['desktop', { viewport: { width: 1366, height: 900 } }],
  ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
]) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.on('pageerror', (e) => log.push(`${mode} pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await delay(1500);
  let n = 0;
  const shot = async (name) => {
    await delay(500);
    const file = `${mode}-${String(++n).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    await page.screenshot({ path: `${out}/${file}`, fullPage: true });
    log.push(`${mode} ${file}`);
  };
  await shot('start');
  const demo = page.getByRole('button', { name: /demo/i }).first();
  if (await demo.count()) {
    await demo.click();
    await delay(2500);
  } else log.push(`${mode}: no demo button`);
  await shot('home');
  const openMenu = async () => {
    if (mode !== 'mobile') return;
    const menu = page.getByRole('button', { name: /menu/i }).first();
    if (await menu.count()) await menu.click().catch(() => {});
    await delay(400);
  };
  await openMenu();
  if (mode === 'mobile') await shot('menu');
  const names = await page.$$eval('nav button, aside button', (els) =>
    [...new Set(els.map((e) => e.textContent.trim()).filter((t) => t && t.length < 40))],
  );
  log.push(`${mode} nav: ${names.join(' | ')}`);
  for (const name of names) {
    try {
      await openMenu();
      await page.locator('nav button, aside button').filter({ hasText: name }).first().click({ timeout: 3000 });
      await delay(800);
      await shot(name);
      // Open the first "add/new" style button on the page, if any, to see a form.
      const add = page.getByRole('button', { name: /^(\+ ?)?(add|new)\b/i }).first();
      if (await add.count()) {
        await add.click({ timeout: 2000 }).catch(() => {});
        await delay(600);
        await shot(`${name}-form`);
        await page.keyboard.press('Escape');
        const close = page.getByRole('button', { name: /close|cancel/i }).first();
        if (await close.count()) await close.click({ timeout: 1500 }).catch(() => {});
      }
    } catch (e) {
      log.push(`${mode} ${name}: ${e.message.split('\n')[0]}`);
    }
  }
  // Point of sale with something in the basket.
  try {
    await openMenu();
    await page.locator('nav button, aside button').filter({ hasText: 'Point of sale' }).first().click({ timeout: 3000 });
    await delay(800);
    const product = page.locator('main button').filter({ hasText: /₦|NGN|\d/ }).first();
    await product.click({ timeout: 3000 });
    await product.click({ timeout: 3000 });
    await delay(500);
    await shot('pos-basket');
    const pay = page.getByRole('button', { name: /continue to payment/i }).first();
    if (await pay.count()) {
      await pay.click({ timeout: 3000 });
      await delay(700);
      await shot('pos-payment');
    }
  } catch (e) {
    log.push(`${mode} pos: ${e.message.split('\n')[0]}`);
  }
  await context.close();
}
await browser.close();
console.log(log.join('\n'));
