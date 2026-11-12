// After a build: Tailwind is set up beside the app's styles as intended (src/tailwind.css).
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../dist/assets/', import.meta.url);
const css = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(new URL(f, dir), 'utf8'))
  .join('\n');
const fail = (why) => {
  console.error(`Tailwind check failed: ${why}`);
  process.exit(1);
};
const hidden = css.match(/\.tw\\:hidden\s*\{[^}]*\}/)?.[0];
if (!hidden) fail('the tw:hidden class is missing (prefix not applied?)');
if (!/display:\s*none\s*!important/.test(hidden)) fail(`tw:hidden is not important: ${hidden}`);
// Tailwind's reset would restyle headings, buttons and lists everywhere.
if (/::file-selector-button|abbr:where\(\[title\]\)/.test(css))
  fail('the Tailwind reset (preflight) is included');
console.log('Tailwind check passed:', hidden);
