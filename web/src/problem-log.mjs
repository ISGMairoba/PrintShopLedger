// Problems this device ran into (app errors, failed syncs), kept until the next sync sends them to
// the developer console. The same problem is kept once with a count.
const KEY = 'printshopledger:problems:v1';
const MAX = 30;

const read = (storage) => {
  try {
    const items = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
};
const write = (storage, items) => {
  try {
    if (items.length) storage.setItem(KEY, JSON.stringify(items));
    else storage.removeItem(KEY);
  } catch {}
};
// Noise from browsers and extensions, not from the app.
const ignored = [
  /^ResizeObserver loop/i,
  /^Script error\.?$/i,
  /chrome-extension:|moz-extension:/i,
  /^AbortError/i,
];

/** Note a problem. kind is 'error' or 'sync'; detail is a small object (stack, page, app version). */
export function recordProblem(
  kind,
  message,
  detail = {},
  { storage = globalThis.localStorage, now = new Date() } = {},
) {
  const text = String(message ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  if (!storage || !text || ignored.some((pattern) => pattern.test(text))) return;
  const items = read(storage);
  const at = now.toISOString();
  const same = items.find((item) => item.kind === kind && item.message === text);
  if (same) {
    same.count = (same.count ?? 1) + 1;
    same.lastAt = at;
    same.detail = detail;
  } else items.push({ kind, message: text, detail, count: 1, firstAt: at, lastAt: at });
  // Keep the most recent ones.
  items.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  write(storage, items.slice(0, MAX));
}

/** Take the waiting problems (up to 20) to send; put them back with returnProblems if sending fails. */
export function takeProblems({ storage = globalThis.localStorage } = {}) {
  if (!storage) return [];
  const items = read(storage);
  const taken = items.slice(0, 20);
  write(storage, items.slice(20));
  return taken;
}
export function returnProblems(taken, { storage = globalThis.localStorage } = {}) {
  if (!storage || !taken.length) return;
  for (const item of taken)
    for (let i = 0; i < (item.count ?? 1); i++)
      recordProblem(item.kind, item.message, item.detail, { storage, now: new Date(item.lastAt) });
}
export const problemKey = KEY;
