// Small fields set with their own operations (server: migration 20261116190000_item_fields.sql):
// * an item's icon, category, code and tags, for the Quick sale screen (service.display_set; code and
//   tags: migration 20261117090000_item_codes_tags.sql);
// * a customer's "Called as" name, used to greet them in messages (customer.called_as_set).

const control = /[\x00-\x1f\x7f]/;

export const MAX_TAGS = 10;
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/;

/** An item code as typed: '' or up to 24 letters, digits and . _ / - (starting with a letter or digit). */
export function cleanCode(code) {
  const value = String(code ?? '').trim();
  if (value && !codePattern.test(value))
    throw Error('Item codes use up to 24 letters, digits, dots, dashes or slashes.');
  return value;
}

/** Tags as typed: up to 10, each up to 30 characters, no repeats (ignoring capitals). */
export function cleanTags(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > 30 || control.test(tag)) throw Error('Keep each tag to 30 characters.');
    if (!out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  if (out.length > MAX_TAGS) throw Error(`Give an item up to ${MAX_TAGS} tags.`);
  return out;
}

/**
 * A code to suggest for an item: the first letters of its category (or ITM) and the next free number,
 * e.g. STA-001.
 */
export function suggestCode(services, category = '', exceptId = '') {
  const prefix =
    String(category)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3) || 'ITM';
  const taken = new Set(services.filter((s) => s.id !== exceptId).map((s) => (s.code ?? '').toLowerCase()));
  for (let n = 1; n < 100000; n++) {
    const code = `${prefix}-${String(n).padStart(3, '0')}`;
    if (!taken.has(code.toLowerCase())) return code;
  }
  return '';
}

/** Tags already used, for suggestions (most used first). */
export function itemTags(services) {
  const count = new Map();
  for (const s of services) for (const t of s.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** An item's minimum order as typed: 0 (none) or a whole number up to 1,000,000. */
export function cleanMinQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 1000000) throw Error('Enter the minimum order as a whole number.');
  return n;
}

/**
 * The event setting an item's icon (a name from the icon set, or ''), category, code, tags and
 * minimum order (0: none).
 */
export function displayEvent(
  service,
  { icon, category, code, tags, minQuantity },
  actor,
  now = new Date().toISOString(),
) {
  return {
    id: crypto.randomUUID(),
    kind: 'service.display_set',
    data: {
      id: service.id,
      baseVersion: service.version ?? 1,
      icon: String(icon ?? ''),
      category: String(category ?? '').trim(),
      code: cleanCode(code ?? service.code ?? ''),
      tags: cleanTags(tags ?? service.tags ?? []),
      minQuantity: cleanMinQuantity(minQuantity ?? service.minQuantity ?? 0),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

/** The event setting a customer's "Called as" name ('' to greet them by their first name). */
export function calledAsEvent(customer, calledAs, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind: 'customer.called_as_set',
    data: {
      id: customer.id,
      baseVersion: customer.version ?? 1,
      calledAs: String(calledAs ?? '').trim(),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

function bump(record, d, eventId) {
  return {
    ...record,
    version: (record.version ?? 1) + 1,
    modifiedBy: d.modifiedBy,
    modifiedByLabel: d.modifiedByLabel,
    modifiedAt: d.modifiedAt,
    lastEventId: eventId,
  };
}

/** Apply either event to the business copy (the same checks as the server). */
export function applyFieldEvent(ledger, event) {
  const d = event.data;
  if (event.kind === 'service.display_set') {
    const s = ledger.services.find((x) => x.id === d.id);
    if (!s) throw Error('Item not found.');
    if (s.lastEventId === event.id) return ledger;
    if ((s.version ?? 1) !== d.baseVersion) throw Error('Item changed elsewhere. Review the latest version.');
    if (!/^([a-z][a-zA-Z0-9]{0,39})?$/.test(d.icon)) throw Error('Choose an icon from the list.');
    if (d.category.length > 60 || control.test(d.category))
      throw Error('Keep the category to 60 characters.');
    const code = d.code === undefined ? (s.code ?? '') : cleanCode(d.code);
    const tags = d.tags === undefined ? (s.tags ?? []) : cleanTags(d.tags);
    if (
      code &&
      ledger.services.some((x) => x.id !== s.id && (x.code ?? '').toLowerCase() === code.toLowerCase())
    )
      throw Error(`Another item already has the code ${code}.`);
    const minQuantity = d.minQuantity === undefined ? (s.minQuantity ?? 0) : cleanMinQuantity(d.minQuantity);
    const next = { ...bump(s, d, event.id), icon: d.icon, category: d.category, code, tags, minQuantity };
    return { ...ledger, services: ledger.services.map((x) => (x.id === s.id ? next : x)) };
  }
  if (event.kind === 'customer.called_as_set') {
    const c = ledger.customers.find((x) => x.id === d.id);
    if (!c) throw Error('Customer not found.');
    if (c.lastEventId === event.id) return ledger;
    if ((c.version ?? 1) !== d.baseVersion)
      throw Error('Customer changed elsewhere. Review the latest version.');
    if (d.calledAs.length > 80 || control.test(d.calledAs)) throw Error('Keep "Called as" to 80 characters.');
    const next = { ...bump(c, d, event.id), calledAs: d.calledAs };
    return { ...ledger, customers: ledger.customers.map((x) => (x.id === c.id ? next : x)) };
  }
  throw Error('Unknown operation.');
}

/** Categories already used, for suggestions (most used first). */
export function itemCategories(services) {
  const count = new Map();
  for (const s of services ?? []) {
    const c = String(s.category ?? '').trim();
    if (c && !s.archived) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/** Initials for a round avatar: the person's own (up to 2), else first and last word of the name. */
export function initialsFor(name, own = '') {
  const set = String(own ?? '')
    .trim()
    .toUpperCase();
  if (/^[\p{L}\p{N}]{1,2}$/u.test(set)) return set;
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return '?';
  const first = (w) => [...w].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '';
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '')).toUpperCase();
}
