import { normalizeLedger, validateMaterial } from './materials.mjs';
import { materialCode, materialSnapshot } from './material-display.mjs';
export const expenseCategories = ['Materials', 'Electricity', 'Fuel', 'Rent', 'Wages', 'Maintenance', 'Delivery', 'Outsourcing', 'Internet / phone', 'Other'];
export const expenseSources = ['Business cash', 'Business bank account', 'Personal funds', 'Other'];
export const expenseCode = (id, expenses = []) => materialCode(id, expenses).replace('MAT-', 'EXP-');
export const expensePaid = expense => expense.payments.reduce((sum, payment) => sum + payment.amount, 0);
export const expenseStatus = expense => expense.voided ? 'Voided' : expensePaid(expense) === expense.amount ? 'Paid' : expensePaid(expense) ? 'Partly paid' : 'Unpaid';
export const expenseDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error('Choose a valid date.');
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw Error(`${label} ${required ? 'is required and' : 'must be'} up to ${max} characters.`);
  return value.trim();
}
function amount(value) { if (!Number.isSafeInteger(value) || value <= 0 || value > 100000000000) throw Error('Enter an amount greater than zero, with at most two decimal places.'); }
function payment(data, audit) {
  if (!data?.id) throw Error('Payment identifier is required.');
  amount(data.amount); date(data.paidOn);
  if (!['Cash', 'POS', 'Transfer'].includes(data.method) || !expenseSources.includes(data.source)) throw Error('Choose a payment method and source.');
  return { id: data.id, amount: data.amount, paidOn: data.paidOn, method: data.method, source: data.source, reference: text(data.reference, 'Reference', 160), createdBy: audit.modifiedBy, createdByLabel: audit.modifiedByLabel, createdAt: audit.modifiedAt };
}
export function stockDeltas(existing, lines, voided = false) {
  const old = new Map((existing?.materials ?? []).map(line => [line.materialId, line.quantity]));
  const next = new Map((voided ? [] : lines).map(line => [line.materialId, line.quantity]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().map(materialId => ({ materialId, quantity: Math.round(((next.get(materialId) ?? 0) - (old.get(materialId) ?? 0)) * 1000) / 1000 })).filter(line => line.quantity !== 0);
}
export function makeExpenseEvent(kind, data, existing, actor, id = () => crypto.randomUUID()) {
  const lines = kind === 'expense.voided' ? [] : kind === 'expense.payment_recorded' ? existing.materials : data.materials;
  const stockIds = Object.fromEntries(stockDeltas(existing, lines, kind === 'expense.voided').map(line => [line.materialId, id()]));
  return { id: id(), kind, data: { ...data, id: existing?.id ?? data.id ?? id(), baseVersion: existing?.version, stockIds, modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: new Date().toISOString() } };
}
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function applyExpenseEvent(input, event) {
  const ledger = normalizeLedger(input), data = event.data;
  if (!event.id || !data.id || !data.modifiedBy || !data.modifiedAt || Number.isNaN(Date.parse(data.modifiedAt))) throw Error('Expense identity and audit information are required.');
  const seen = ledger.expenseHistory.find(entry => entry.id === event.id);
  if (seen) { if (canonical(seen.event) !== canonical(event)) throw Error('Operation ID already used for different data.'); return ledger; }
  const existing = ledger.expenses.find(item => item.id === data.id);
  const audit = { modifiedBy: data.modifiedBy, modifiedByLabel: data.modifiedByLabel ?? data.modifiedBy, modifiedAt: data.modifiedAt, lastEventId: event.id };
  if (event.kind === 'expense.created') { if (existing) throw Error('Expense ID already exists.'); }
  else { if (!existing) throw Error('Expense not found.'); if (data.baseVersion !== existing.version) throw Error('This expense changed elsewhere. Review the business version.'); if (existing.voided) throw Error('A voided expense cannot be changed.'); }
  let next;
  if (event.kind === 'expense.created' || event.kind === 'expense.updated') {
    amount(data.amount); date(data.incurredOn);
    const lines = data.materials;
    if (!Array.isArray(lines) || lines.length > 50 || new Set(lines.map(line => line.materialId)).size !== lines.length) throw Error('Choose each material once, with a maximum of 50 materials.');
    const materials = lines.map(line => {
      const material = ledger.materials.find(item => item.id === line.materialId);
      if (!material) throw Error('Choose a material from this business.');
      const old = existing?.materials.find(item => item.materialId === line.materialId);
      text(line.measurementUnit, 'Measurement unit', 40, true);
      if (material.archived && (!old || old.quantity !== line.quantity)) throw Error('Restore this material before changing its purchased quantity.');
      if (line.measurementUnit !== material.measurementUnit && (!old || old.quantity !== line.quantity)) throw Error('Material unit changed. Review the quantity before saving.');
      validateMaterial({ ...material, available: line.quantity }); if (line.quantity <= 0) throw Error('Purchased quantity must be greater than zero.');
      return { materialId: material.id, name: old?.name ?? material.name, measurementUnit: line.measurementUnit, quantity: line.quantity };
    });
    const payments = existing?.payments ?? (data.payment ? [payment(data.payment, audit)] : []);
    next = { ...existing, id: data.id, description: text(data.description, 'Description', 500, true), category: text(data.category, 'Category', 80, true), incurredOn: data.incurredOn, amount: data.amount, payee: text(data.payee, 'Paid to', 160), note: text(data.note, 'Note', 1000), receiptReference: text(data.receiptReference, 'Receipt reference', 160), materials, payments, voided: false, voidReason: '', version: (existing?.version ?? 0) + 1, createdBy: existing?.createdBy ?? data.modifiedBy, createdByLabel: existing?.createdByLabel ?? audit.modifiedByLabel, createdAt: existing?.createdAt ?? data.modifiedAt, ...audit };
    if (expensePaid(next) > next.amount) throw Error('Expense amount cannot be less than its recorded payments.');
    if (existing && data.payment) throw Error('Record additional payments using Record payment.');
  } else if (event.kind === 'expense.payment_recorded') {
    const p = payment(data.payment, audit);
    if (existing.payments.some(item => item.id === p.id)) throw Error('Payment ID already used.');
    next = { ...existing, payments: [...existing.payments, p], version: existing.version + 1, ...audit };
    if (expensePaid(next) > next.amount) throw Error('Payment exceeds the outstanding expense amount.');
  } else if (event.kind === 'expense.voided') {
    next = { ...existing, voided: true, voidReason: text(data.reason, 'Void reason', 500, true), version: existing.version + 1, ...audit };
  } else throw Error('Unknown expense operation.');
  const deltas = event.kind === 'expense.payment_recorded' ? [] : stockDeltas(existing, next.materials, next.voided);
  if (!data.stockIds || Object.keys(data.stockIds).length !== deltas.length || new Set(Object.values(data.stockIds)).size !== deltas.length) throw Error('Stock update identifiers are incomplete.');
  let materials = ledger.materials, materialHistory = ledger.materialHistory;
  for (const delta of deltas) {
    const before = materials.find(item => item.id === delta.materialId);
    const stockId = data.stockIds[delta.materialId];
    const oldLine = existing?.materials.find(item => item.materialId === delta.materialId);
    if (oldLine && oldLine.measurementUnit !== before?.measurementUnit) throw Error('Material unit changed. Restore the original unit before adjusting this purchase.');
    if (!before || !stockId || stockId === event.id || materialHistory.some(item => item.id === stockId)) throw Error('Stock update identifier is invalid.');
    const after = { ...before, available: Math.round((before.available + delta.quantity) * 1000) / 1000, version: before.version + 1, ...audit, lastEventId: stockId };
    validateMaterial(after);
    materials = materials.map(item => item.id === after.id ? after : item);
    materialHistory = [...materialHistory, { id: stockId, expenseId: next.id, materialId: after.id, materialName: after.name, measurementUnit: after.measurementUnit, action: 'material.expense_stock_changed', beforeAvailable: before.available, afterAvailable: after.available, reason: `${next.voided ? 'Voided purchase' : existing ? 'Purchase correction' : 'Purchase restocking'} · ${expenseCode(next.id)}${next.voided ? ' · ' + next.voidReason : ''}`.slice(0, 500), changedBy: audit.modifiedBy, changedByLabel: audit.modifiedByLabel, changedAt: audit.modifiedAt, before: materialSnapshot(before), after: materialSnapshot(after), detailsComplete: true }];
  }
  return { ...ledger, materials, materialHistory, expenses: existing ? ledger.expenses.map(item => item.id === next.id ? next : item) : [...ledger.expenses, next], expenseHistory: [...ledger.expenseHistory, { id: event.id, expenseId: next.id, action: event.kind, before: existing ?? null, after: next, changedBy: audit.modifiedBy, changedByLabel: audit.modifiedByLabel, changedAt: audit.modifiedAt, event }] };
}
export function expenseSummary(ledger, from = '', to = '') {
  const within = day => (!from || day >= from) && (!to || day <= to);
  const active = ledger.expenses.filter(item => !item.voided && within(item.incurredOn));
  const incurred = active.reduce((sum, item) => sum + item.amount, 0);
  const paid = ledger.expenses.reduce((sum, item) => sum + item.payments.filter(p => within(p.paidOn)).reduce((total, p) => total + p.amount, 0), 0);
  const sales = ledger.jobs.filter(item => within(expenseDay(item.createdAt))).reduce((sum, item) => sum + item.amount, 0);
  return { incurred, paid, unpaid: active.reduce((sum, item) => sum + item.amount - expensePaid(item), 0), sales, result: sales - incurred };
}
