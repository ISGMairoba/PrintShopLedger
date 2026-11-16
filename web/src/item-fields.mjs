// Small fields set with their own operations (server: migration 20261116190000_item_fields.sql):
// * an item's icon and category, for the Quick sale screen (service.display_set);
// * a customer's "Called as" name, used to greet them in messages (customer.called_as_set).

const control = /[\x00-\x1f\x7f]/;

/** The event setting an item's icon (a name from the icon set, or '') and category. */
export function displayEvent(service, { icon, category }, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind: 'service.display_set',
    data: {
      id: service.id,
      baseVersion: service.version ?? 1,
      icon: String(icon ?? ''),
      category: String(category ?? '').trim(),
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
    const next = { ...bump(s, d, event.id), icon: d.icon, category: d.category };
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
