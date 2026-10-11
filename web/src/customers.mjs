import { materialCode } from './material-display.mjs';
export const customerCode = (id, customers = []) => materialCode(id, customers).replace('MAT-', 'CUS-');
export function normalizeCustomer(customer) {
  return {
    ...customer,
    address: customer.address ?? '',
    creditLimit: customer.creditLimit ?? 0,
    archived: customer.archived ?? false,
    version: customer.version ?? 1,
    createdBy: customer.createdBy ?? null,
    createdByLabel: customer.createdByLabel ?? 'Unknown (older record)',
    modifiedBy: customer.modifiedBy ?? customer.createdBy ?? null,
    modifiedByLabel: customer.modifiedByLabel ?? customer.createdByLabel ?? 'Unknown (older record)',
    modifiedAt: customer.modifiedAt ?? customer.createdAt,
    lastEventId: customer.lastEventId ?? null,
  };
}
export function validateCustomer(data, legacy = false) {
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 160)
    throw new Error('Enter a full name (up to 160 characters).');
  if (
    typeof (data.phone ?? '') !== 'string' ||
    (!legacy && !data.phone?.trim()) ||
    (data.phone ?? '').trim().length > 40
  )
    throw new Error('Enter a phone number (up to 40 characters).');
  if (typeof (data.address ?? '') !== 'string' || (data.address ?? '').trim().length > 500)
    throw new Error('Address must be up to 500 characters.');
  const limit = data.creditLimit ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100000000000)
    throw new Error('Credit limit must be zero or greater, with at most two decimal places.');
}
export function createCustomerEvent(
  fields,
  actor,
  makeId = () => crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  validateCustomer(fields);
  return {
    id: makeId(),
    kind: 'customer.created',
    data: {
      id: makeId(),
      name: fields.name.trim(),
      phone: fields.phone.trim(),
      address: (fields.address ?? '').trim(),
      creditLimit: fields.creditLimit ?? 0,
      createdAt: now,
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}
export function customerMatches(customer, query, customers = [], extra = []) {
  const date = (value) =>
    value ? new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : '';
  const formatted = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(
    customer.creditLimit / 100,
  );
  return [
    customer.name,
    customer.id,
    customerCode(customer.id, customers),
    customer.phone,
    customer.address,
    (customer.creditLimit / 100).toFixed(2),
    formatted,
    customer.archived ? 'Archived' : 'Active',
    customer.createdBy,
    customer.createdByLabel,
    customer.createdAt,
    date(customer.createdAt),
    customer.modifiedBy,
    customer.modifiedByLabel,
    customer.modifiedAt,
    date(customer.modifiedAt),
    ...extra,
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
export function applyCustomerEvent(ledger, event) {
  const data = event.data;
  if (!event.id || !data.id) throw new Error('Customer identity is required.');
  const customers = ledger.customers.map(normalizeCustomer);
  const existing = customers.find((item) => item.id === data.id);
  if (existing?.lastEventId === event.id) return { ...ledger, customers };
  const legacy = event.kind === 'customer.created' && !data.modifiedBy;
  if (!legacy && (!data.modifiedBy || !data.modifiedAt || Number.isNaN(Date.parse(data.modifiedAt))))
    throw new Error('Customer audit information is required.');
  const at = data.modifiedAt ?? data.createdAt;
  if (!at || Number.isNaN(Date.parse(at))) throw new Error('Choose a valid creation date.');
  const audit = {
    modifiedBy: data.modifiedBy ?? null,
    modifiedByLabel: data.modifiedByLabel ?? (legacy ? 'Unknown (older record)' : data.modifiedBy),
    modifiedAt: at,
    lastEventId: event.id,
  };
  if (event.kind === 'customer.created') {
    if (existing) {
      if (legacy) return { ...ledger, customers };
      throw new Error('This customer ID is already in use.');
    }
    validateCustomer(data, legacy);
    const next = normalizeCustomer({
      id: data.id,
      name: data.name.trim(),
      phone: (data.phone ?? '').trim(),
      address: (data.address ?? '').trim(),
      creditLimit: data.creditLimit ?? 0,
      archived: false,
      version: 1,
      createdBy: audit.modifiedBy,
      createdByLabel: audit.modifiedByLabel,
      createdAt: at,
      ...audit,
    });
    return { ...ledger, customers: [...customers, next] };
  }
  if (!existing) throw new Error('Customer not found.');
  if (data.baseVersion !== existing.version)
    throw new Error('This customer changed elsewhere. Sync and review the latest version.');
  let next;
  if (event.kind === 'customer.updated') {
    if (existing.archived) throw new Error('Restore this customer before editing.');
    validateCustomer(data);
    next = {
      ...existing,
      name: data.name.trim(),
      phone: data.phone.trim(),
      address: (data.address ?? '').trim(),
      creditLimit: data.creditLimit ?? 0,
      ...audit,
      version: existing.version + 1,
    };
  } else if (event.kind === 'customer.archived' || event.kind === 'customer.restored') {
    const archived = event.kind === 'customer.archived';
    if (existing.archived === archived)
      throw new Error(archived ? 'Customer is already archived.' : 'Customer is already active.');
    next = { ...existing, archived, ...audit, version: existing.version + 1 };
  } else throw new Error('Unknown customer operation.');
  return { ...ledger, customers: customers.map((item) => (item.id === data.id ? next : item)) };
}
