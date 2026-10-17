// Records the tutorial videos: plays each one in the app's local trial with a sample shop,
// shows a caption for every step, records the screen, adds a computer voice reading the
// captions, and writes an MP4 per video.
// Run after `npm run build`:  node scripts/tutorials/record.mjs <output folder> [video id …]
// Voice: Piper (PIPER_MODEL=path to .onnx) if installed, else espeak-ng, else silent.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { sampleShop } from './sample-shop.mjs';
import { videos } from './videos.mjs';

const out = process.argv[2] ?? '/tmp/tutorials';
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });
const work = join(out, '.work');
mkdirSync(work, { recursive: true });
const port = 4198;
console.log(
  process.env.PIPER_MODEL && existsSync(process.env.PIPER_MODEL)
    ? 'Voice: Piper'
    : 'Voice: espeak-ng (Piper model missing)',
);
const SIZE = { width: 1280, height: 720 };

// ---------- Voice ----------
function speak(text, file) {
  const model = process.env.PIPER_MODEL;
  if (model && existsSync(model)) {
    const r = spawnSync('piper', ['--model', model, '--output_file', file], { input: text });
    if (r.status === 0 && existsSync(file)) return true;
    console.warn('piper failed:', String(r.stderr).slice(0, 300));
  }
  const e = spawnSync('espeak-ng', ['-v', 'en-gb', '-s', '160', '-w', file, text]);
  return e.status === 0 && existsSync(file);
}
function seconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(String(r.stdout).trim()) || 0;
}

// ---------- On-screen helpers ----------
/** The caption bar: a popover, so it shows above open dialogs (re-shown after each action). */
async function caption(page, text) {
  await page.evaluate((value) => {
    let el = document.getElementById('tutorial-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tutorial-caption';
      el.popover = 'manual';
      el.style.cssText = [
        'inset:auto auto 26px 50%',
        'transform:translateX(-50%)',
        'margin:0',
        'max-width:980px',
        'width:max-content',
        'background:rgba(12,20,32,.92)',
        'color:#fff',
        'font:600 22px/1.4 system-ui,sans-serif',
        'padding:14px 24px',
        'border:0',
        'border-radius:12px',
        'text-align:center',
        'pointer-events:none',
        'box-shadow:0 10px 30px rgba(0,0,0,.35)',
      ].join(';');
      document.body.append(el);
    }
    el.textContent = value;
    el.style.display = value ? '' : 'none';
    try {
      el.hidePopover();
    } catch {}
    if (value) el.showPopover();
  }, text);
}
const raise = (page) =>
  page
    .evaluate(() => {
      const el = document.getElementById('tutorial-caption');
      if (el && el.textContent) {
        try {
          el.hidePopover();
        } catch {}
        el.showPopover();
      }
    })
    .catch(() => {});

function helpers(page, context) {
  const mark = (loc, on) =>
    loc
      .evaluate((el, on) => {
        el.style.outline = on ? '4px solid #f5a524' : '';
        el.style.outlineOffset = on ? '3px' : '';
      }, on)
      .catch(() => {});
  return {
    page,
    context,
    /** Point at a control (orange ring), pause, then press it. */
    async tap(loc, pause = 700) {
      await loc.scrollIntoViewIfNeeded();
      await mark(loc, true);
      await delay(pause);
      await loc.click();
      await mark(loc, false);
      await delay(250);
      await raise(page);
    },
    /** Point at something without pressing it. */
    async show(loc, pause = 1400) {
      // Scroll it to the middle directly: big tables may never count as "still" for Playwright.
      await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await mark(loc, true);
      await delay(pause);
      await mark(loc, false);
    },
    /** Type into a box at a readable speed. */
    async type(loc, text) {
      await loc.scrollIntoViewIfNeeded();
      await mark(loc, true);
      await loc.click();
      await loc.fill('');
      await loc.pressSequentially(text, { delay: 90 });
      await delay(300);
      await mark(loc, false);
    },
    /** Choose the option whose text contains `text`. */
    async choose(select, text) {
      await select.scrollIntoViewIfNeeded();
      await mark(select, true);
      await delay(500);
      const value = await select.evaluate(
        (el, text) => [...el.options].find((o) => o.textContent.includes(text))?.value,
        text,
      );
      if (value === undefined) throw Error(`No option "${text}"`);
      await select.selectOption(value);
      await delay(400);
      await mark(select, false);
    },
    nav: async (name) => {
      const button = page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name, exact: true });
      await mark(button, true);
      await delay(600);
      await button.click();
      await mark(button, false);
      await delay(500);
    },
    wait: (ms) => delay(ms),
  };
}

// ---------- Recording ----------
async function seed(page) {
  const { ledger, settings } = sampleShop();
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
        {
          const st = tx.objectStore('ledgers');
          st.delete(IDBKeyRange.bound('local-trial' + '|', 'local-trial' + '|\uffff'));
          st.put({ ledger, pending: [] }, 'local-trial');
        }
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
      db.close();
    },
    { ledger, settings },
  );
}

async function record(browser, video) {
  console.log(`\n▶ ${video.id}: ${video.title}`);
  // Voice first: each step lasts at least as long as its sentence.
  const lines = video.steps.map((step, i) => {
    const file = join(work, `${video.id}-${String(i).padStart(2, '0')}.wav`);
    const spoken = speak(step.say, file);
    return { file: spoken ? file : null, length: spoken ? seconds(file) : step.say.split(' ').length / 2.6 };
  });
  const dir = join(work, video.id);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: SIZE },
    serviceWorkers: 'block',
    acceptDownloads: true,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const born = Date.now();
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${port}`);
  await seed(page);
  await page.reload();
  await page.getByRole('button', { name: 'Try locally on this device' }).waitFor();
  if (!video.startSignedOut) {
    await page.getByRole('button', { name: 'Try locally on this device' }).click();
    await page.getByRole('navigation', { name: 'Main' }).waitFor();
  }
  await delay(600);
  // Keep pop-ups above the caption band at the bottom of the frame.
  await page.addStyleTag({
    content:
      'dialog.modal{inset:0 0 auto 0!important;margin:12px auto 0!important;max-height:calc(100dvh - 118px)!important}',
  });
  const h = helpers(page, context);
  if (video.setup) await video.setup(h);
  const start = (Date.now() - born) / 1000;
  const marks = [],
    done = [];
  for (const [i, step] of video.steps.entries()) {
    const at = (Date.now() - born) / 1000;
    marks.push(at - start);
    await caption(page, step.say);
    const began = Date.now();
    if (step.do) await step.do(h);
    done.push((Date.now() - born) / 1000 - start);
    const hold = Math.max(lines[i].length + 0.7, step.min ?? 2.4) * 1000 - (Date.now() - began);
    if (hold > 0) await delay(hold);
  }
  await caption(page, '');
  await delay(500);
  const end = (Date.now() - born) / 1000;
  const raw = await page.video().path();
  await context.close();
  // Picture from `start` to `end`; each sentence placed at its step's moment.
  const args = ['-y', '-loglevel', 'error', '-i', raw];
  const voiced = lines.map((l, i) => ({ ...l, at: marks[i] })).filter((l) => l.file);
  for (const l of voiced) args.push('-i', l.file);
  const filters = [`[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS[v]`];
  voiced.forEach((l, i) => {
    const ms = Math.round(l.at * 1000);
    filters.push(`[${i + 1}:a]adelay=${ms}|${ms},aresample=44100[a${i}]`);
  });
  if (voiced.length)
    filters.push(
      `${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0:dropout_transition=0[a]`,
    );
  const file = join(out, `${video.id}.mp4`);
  args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (voiced.length) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '128k');
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-t',
    (end - start).toFixed(3),
    '-movflags',
    '+faststart',
    file,
  );
  const r = spawnSync('ffmpeg', args);
  if (r.status !== 0) throw Error(`ffmpeg failed: ${String(r.stderr).slice(0, 800)}`);
  // Frames to check the result by eye: one per step.
  const frames = join(out, 'frames', video.id);
  mkdirSync(frames, { recursive: true });
  marks.forEach((at, i) => {
    const t = Math.min(Math.max(done[i] + 0.4, at + 1.5), end - start - 0.2);
    spawnSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      t.toFixed(2),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=960:-1',
      join(frames, `${String(i + 1).padStart(2, '0')}.jpg`),
    ]);
  });
  console.log(`  ✓ ${file} (${(end - start).toFixed(1)} s)`);
  return {
    id: video.id,
    title: video.title,
    seconds: Math.round(end - start),
    description: video.description,
  };
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
const made = [],
  failed = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const video of videos) {
    if (only.length && !only.includes(video.id)) continue;
    try {
      made.push(await record(browser, video));
    } catch (e) {
      console.error(`  ✗ ${video.id}: ${e.message}`);
      failed.push(`${video.id}: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser?.close();
  server.kill();
}
// A list for uploading: title, description and length of each video.
writeFileSync(
  join(out, 'videos.md'),
  [
    '# PrintShopLedger tutorial videos',
    '',
    ...made.map(
      (v) =>
        `## ${v.id}.mp4\n\n**Title:** PrintShopLedger: ${v.title}\n\n**Description:** ${v.description}\n\n**Length:** ${v.seconds} s\n`,
    ),
    failed.length ? `\n## Not made\n\n${failed.map((f) => `- ${f}`).join('\n')}\n` : '',
  ].join('\n'),
);
console.log(failed.length ? `\nNot made:\n${failed.join('\n')}` : '\nAll videos made.');
if (failed.length) process.exitCode = 1;
