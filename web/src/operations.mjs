import { prepareAccountMethods, routingLabels } from './account-methods.mjs';
import { validDueAt } from './job-deadlines.mjs';
import { businessDay } from './dashboard.mjs';
import { localBranchId } from './branches.mjs';
import { MONEY_TYPES, lenderBalances } from './money-moves.mjs';

// Money accounts belong to a branch ('main' when not set) or are shared by all branches ('*').
export const accountBranch = (a) => a?.branch || 'main';
/** Whether a branch can use an account: its own accounts and the shared ones. */
export const usableInBranch = (a, id = localBranchId()) =>
  accountBranch(a) === '*' || accountBranch(a) === id;
/** Two accounts can be used in the same branch (so their default payment methods must differ). */
const sameScope = (a, b) =>
  accountBranch(a) === '*' || accountBranch(b) === '*' || accountBranch(a) === accountBranch(b);

const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const text = (v, max, required = false) => {
  if (
    typeof v !== 'string' ||
    v.trim().length > max ||
    (required && !v.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
  )
    throw Error('Enter valid text within the field limit.');
  return v.trim();
};
const amount = (v, signed = false) => {
  if (!Number.isSafeInteger(v) || Math.abs(v) > 100000000000 || (!signed && v < 0))
    throw Error('Enter a valid amount.');
  return v;
};
const day = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v).toISOString().slice(0, 10) !== v)
    throw Error('Choose a valid date.');
  return v;
};
export function operationEvent(kind, data, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind,
    data: { ...data, modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now },
  };
}
export function applyOperation(ledger, event) {
  const d = event.data,
    kind = event.kind;
  if (!event.id || !d.id || !d.modifiedBy || Number.isNaN(Date.parse(d.modifiedAt)))
    throw Error('Operation identity and audit are required.');
  const seen = (ledger.operationHistory ?? []).find((h) => h.id === event.id);
  if (seen) {
    if (seen.event && canonical(seen.event) !== canonical(event))
      throw Error('Operation ID reused for different data.');
    return ledger;
  }
  const audit = {
    modifiedBy: d.modifiedBy,
    modifiedByLabel: d.modifiedByLabel,
    modifiedAt: d.modifiedAt,
    lastEventId: event.id,
  };
  let next = { ...ledger };
  let before = null,
    after = null;
  if (kind === 'job.due_changed') {
    const ids = d.jobIds ?? [d.id];
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
      throw Error('Select 1 to 100 jobs.');
    const reason = text(d.reason, 500, true),
      dueAt = validDueAt(d.dueAt, d.modifiedAt);
    const jobs = ledger.jobs.map((j) => {
      if (!ids.includes(j.id)) return j;
      if (['Completed', 'Collected', 'Cancelled'].includes(j.productionStatus))
        throw Error('Only active jobs can have their due date changed.');
      if ((d.expectedDueDates?.[j.id] ?? '') !== (j.dueAt ?? ''))
        throw Error('A due date changed elsewhere. Refresh before postponing.');
      return {
        ...j,
        dueAt,
        version: (j.version ?? 1) + 1,
        dueHistory: [
          ...(j.dueHistory ?? []),
          {
            id: event.id,
            from: j.dueAt ?? '',
            to: dueAt,
            reason,
            changedBy: d.modifiedByLabel,
            changedAt: d.modifiedAt,
          },
        ],
        ...audit,
      };
    });
    if (ids.some((id) => !ledger.jobs.some((j) => j.id === id))) throw Error('Job not found.');
    next.jobs = jobs;
  } else if (
    kind.startsWith('payee.') ||
    ['account.created', 'account.updated', 'account.archived', 'account.restored'].includes(kind)
  ) {
    const payee = kind.startsWith('payee.'),
      collection = payee ? 'payees' : 'moneyAccounts';
    const rows = ledger[collection] ?? [],
      old = rows.find((r) => r.id === d.id);
    before = old ?? null;
    if (kind.endsWith('.created')) {
      if (old) throw Error('Record already exists.');
    } else if (!old || old.version !== d.baseVersion)
      throw Error('This record changed elsewhere. Reopen it.');
    if (kind.endsWith('.archived') || kind.endsWith('.restored'))
      after = { ...old, archived: kind.endsWith('.archived'), version: old.version + 1, ...audit };
    else {
      const name = text(d.name, 160, true);
      if (rows.some((r) => r.id !== d.id && !r.archived && r.name.toLowerCase() === name.toLowerCase()))
        throw Error('An active record already has that name.');
      after = {
        ...old,
        id: d.id,
        name,
        archived: old?.archived ?? false,
        version: (old?.version ?? 0) + 1,
        createdBy: old?.createdBy ?? d.modifiedBy,
        createdByLabel: old?.createdByLabel ?? d.modifiedByLabel,
        createdAt: old?.createdAt ?? d.modifiedAt,
        ...audit,
      };
      if (payee)
        Object.assign(after, {
          phone: text(d.phone ?? '', 40),
          address: text(d.address ?? '', 500),
          note: text(d.note ?? '', 1000),
        });
      else {
        if (!['cash', 'bank', 'pos', 'other'].includes(d.accountType)) throw Error('Choose an account type.');
        const branch = d.branch || old?.branch || (old ? 'main' : localBranchId());
        if (!/^(main|b-[a-z0-9]{6,20}|\*)$/.test(branch)) throw Error('Choose a valid branch.');
        Object.assign(after, {
          accountType: d.accountType,
          openingDate: day(d.openingDate ?? old?.openingDate),
          openingBalance: amount(d.openingBalance ?? old?.openingBalance, true),
          methods: d.methods ?? [],
          branch,
        });
        if (d.paymentMethods) {
          after.paymentMethods = prepareAccountMethods(name, d.paymentMethods, old);
          after.methods = routingLabels(after.paymentMethods);
          after.paymentMethodsVersion = 1;
        }
        if (
          !Array.isArray(after.methods) ||
          after.methods.length > 3000 ||
          after.methods.some((m) => typeof m !== 'string' || !m.trim() || m.length > 80)
        )
          throw Error('Choose valid payment methods.');
        if (
          rows.some(
            (r) =>
              r.id !== d.id &&
              !r.archived &&
              sameScope(r, after) &&
              (r.methods ?? []).some((m) => after.methods.includes(m)),
          )
        )
          throw Error('Each payment method can have only one default account in a branch.');
      }
    }
    if (
      !after.archived &&
      rows.some((r) => r.id !== after.id && !r.archived && r.name.toLowerCase() === after.name.toLowerCase())
    )
      throw Error('An active record already has that name.');
    if (
      !payee &&
      !after.archived &&
      rows.some(
        (r) =>
          r.id !== after.id &&
          !r.archived &&
          sameScope(r, after) &&
          (r.methods ?? []).some((m) => after.methods.includes(m)),
      )
    )
      throw Error('Each payment method can have only one default account in a branch.');
    next[collection] = old ? rows.map((r) => (r.id === old.id ? after : r)) : [...rows, after];
  } else if (kind === 'account.entry_corrected') {
    after = correctEntry(ledger, d, audit);
    before = (ledger.accountEntries ?? []).find((e) => e.id === d.id) ?? null;
    next.accountEntries = (ledger.accountEntries ?? []).map((e) => (e.id === d.id ? after : e));
  } else {
    const accounts = ledger.moneyAccounts ?? [],
      entries = ledger.accountEntries ?? [];
    const account = accounts.find((a) => a.id === d.accountId && !a.archived);
    if (!account) throw Error('Choose an active account.');
    const on = day(d.paidOn),
      reason = text(d.reason, 500, true);
    if (on < account.openingDate) throw Error('The entry cannot be before the account opening date.');
    const entry = { id: d.id, accountId: d.accountId, paidOn: on, reason, ...audit };
    if (entries.some((e) => e.id === d.id)) throw Error('Entry already exists.');
    if (kind === 'account.transferred') {
      const to = accounts.find((a) => a.id === d.toAccountId && !a.archived);
      if (!to || to.id === account.id || on < to.openingDate)
        throw Error('Choose a different active destination account with a valid opening date.');
      if (amount(d.amount) <= 0) throw Error('Enter an amount greater than zero.');
      Object.assign(entry, { action: 'transfer', amount: d.amount, toAccountId: to.id });
    } else if (kind === 'account.reconciled') {
      const expected = accountBalance(ledger, account.id, on).balance;
      if (expected !== d.expectedBalance)
        throw Error('The account balance changed. Review it before reconciling.');
      Object.assign(entry, {
        action: 'reconciliation',
        amount: amount(d.actualBalance, true) - expected,
        expectedBalance: expected,
        actualBalance: d.actualBalance,
      });
    } else if (kind === 'account.money_moved') {
      const type = MONEY_TYPES[d.moneyType];
      if (!type || !Object.hasOwn(MONEY_TYPES, d.moneyType))
        throw Error('Choose what kind of money this is.');
      if (amount(d.amount) <= 0) throw Error('Enter an amount greater than zero.');
      Object.assign(entry, {
        action: 'money',
        moneyType: d.moneyType,
        amount: d.amount,
        direction: type.direction,
      });
      if (type.lender) {
        const lender = (ledger.payees ?? []).find((p) => p.id === d.lenderId);
        if (!lender || (d.moneyType === 'loan_in' && lender.archived)) throw Error('Choose the lender.');
        if (d.moneyType === 'loan_repayment' && d.amount > (lenderBalances(ledger)[lender.id] ?? 0))
          throw Error(`That is more than is still owed to ${lender.name}.`);
        entry.lenderId = lender.id;
      }
    } else if (kind === 'account.assigned') {
      const transaction = moneyTransactions(ledger).find((t) => t.id === d.transactionId);
      if (!transaction || transaction.accountId || transaction.paidOn < account.openingDate)
        throw Error('Choose an unassigned transaction on or after the opening date.');
      Object.assign(entry, {
        action: 'assignment',
        transactionId: transaction.id,
        amount: 0,
        paidOn: transaction.paidOn,
      });
    } else throw Error('Unknown operation.');
    next.accountEntries = [...entries, entry];
    after = entry;
  }
  next.operationHistory = [
    ...(ledger.operationHistory ?? []),
    { id: event.id, action: kind, recordId: d.id, before, after, event, ...audit },
  ];
  return next;
}
export function moneyTransactions(ledger) {
  const assignments = new Map(
    (ledger.accountEntries ?? [])
      .filter((e) => e.action === 'assignment')
      .map((e) => [e.transactionId, e.accountId]),
  );
  const checkoutMap = new Map((ledger.checkouts ?? []).map((c) => [c.id, c]));
  const incoming = ledger.payments
    .filter((p) => !p.refundId && p.amount > 0)
    .map((p) => ({
      id: 'payment:' + p.id,
      paidOn: businessDay(p.paidOn),
      amount: p.amount,
      direction: 1,
      label: 'Collection · ' + (p.methodLabel || p.method),
      method: p.methodLabel || p.method,
      accountId:
        p.accountId ||
        checkoutMap.get(p.checkoutId || p.id)?.accountId ||
        assignments.get('payment:' + p.id) ||
        '',
      source: p,
    }));
  const expense = ledger.expenses.flatMap((e) =>
    e.payments.map((p) => ({
      id: 'expense:' + p.id,
      personal: p.source === 'Personal funds' && !p.accountId,
      paidOn: businessDay(p.paidOn),
      amount: p.amount,
      direction: -1,
      label: e.description + (e.voided ? ' · Voided expense payment retained' : ''),
      method: p.methodLabel || p.method,
      accountId: p.accountId || assignments.get('expense:' + p.id) || '',
      source: p,
    })),
  );
  const refunds = ledger.saleAdjustments
    .filter((a) => a.action === 'sale.refunded' && a.refundAmount > 0)
    .map((a) => ({
      id: 'refund:' + a.id,
      paidOn: businessDay(a.paidOn || a.changedAt),
      amount: a.refundAmount,
      direction: -1,
      label: 'Customer refund',
      method: a.methodLabel || a.method,
      accountId: a.accountId || assignments.get('refund:' + a.id) || '',
      source: a,
    }));
  return [...incoming, ...expense, ...refunds].sort(
    (a, b) => a.paidOn.localeCompare(b.paidOn) || a.id.localeCompare(b.id),
  );
}
export function accountBalance(ledger, id, to = businessDay(new Date().toISOString())) {
  const a = (ledger.moneyAccounts ?? []).find((a) => a.id === id);
  if (!a) throw Error('Account not found.');
  const transactions = moneyTransactions(ledger).filter((t) => t.accountId === id && t.paidOn <= to);
  const rows = transactions.filter((t) => t.paidOn >= a.openingDate);
  let balance = a.openingBalance,
    received = 0,
    paid = 0;
  for (const r of rows) {
    balance += r.direction * r.amount;
    if (r.direction > 0) received += r.amount;
    else paid += r.amount;
  }
  const entries = (ledger.accountEntries ?? []).filter((e) => e.paidOn >= a.openingDate && e.paidOn <= to);
  for (const e of entries) {
    if (e.action === 'transfer') {
      if (e.accountId === id) balance -= e.amount;
      if (e.toAccountId === id) balance += e.amount;
    } else if (e.action === 'reconciliation' && e.accountId === id) balance += e.amount;
    else if (e.action === 'money' && e.accountId === id) balance += e.direction * e.amount;
  }
  return {
    balance,
    received,
    paid,
    transactions,
    entries: entries.filter((e) => e.accountId === id || e.toAccountId === id),
  };
}
/** The account a payment method goes to in this device's branch: the branch's own first, then a shared one. */
export const defaultMoneyAccount = (ledger, method) => {
  const fits = (ledger.moneyAccounts ?? []).filter(
    (a) => !a.archived && a.methods?.includes(method) && usableInBranch(a),
  );
  return (fits.find((a) => accountBranch(a) !== '*') ?? fits[0])?.id ?? '';
};

/**
 * Correct a transfer, reconciliation or money in / out entry: its amount (a reconciliation's counted
 * balance), date, note, accounts or lender; or cancel it (amount 0). The entry keeps every earlier
 * version with who changed it, when and why. The server applies the same rules.
 */
export function correctEntry(ledger, d, audit) {
  const entries = ledger.accountEntries ?? [];
  const old = entries.find((e) => e.id === d.id);
  if (!old || !['transfer', 'reconciliation', 'money'].includes(old.action)) throw Error('Choose an entry to correct.');
  if ((old.version ?? 1) !== d.baseVersion) throw Error('This entry changed elsewhere. Reopen it.');
  const why = text(d.correctionReason, 500, true);
  const accounts = ledger.moneyAccounts ?? [];
  const cancel = d.cancel === true;
  const next = { ...old };
  const active = (id) => accounts.find((a) => a.id === id && !a.archived);
  if (d.reason !== undefined) next.reason = text(d.reason, 500, true);
  if (old.action === 'reconciliation') {
    // The counted balance changes; the date stays (the expected balance belongs to that day).
    next.actualBalance = cancel ? old.expectedBalance : amount(d.actualBalance ?? old.actualBalance, true);
    next.amount = next.actualBalance - old.expectedBalance;
  } else {
    if (d.paidOn !== undefined) next.paidOn = day(d.paidOn);
    if (d.accountId !== undefined) next.accountId = d.accountId;
    next.amount = cancel ? 0 : amount(d.amount ?? old.amount);
    if (!cancel && next.amount <= 0) throw Error('Enter an amount greater than zero, or cancel the entry.');
    const from = active(next.accountId);
    if (!from || next.paidOn < from.openingDate) throw Error('Choose an active account opened by that date.');
    if (old.action === 'transfer') {
      if (d.toAccountId !== undefined) next.toAccountId = d.toAccountId;
      const to = active(next.toAccountId);
      if (!to || to.id === from.id || next.paidOn < to.openingDate)
        throw Error('Choose a different active destination account opened by that date.');
    }
    if (old.action === 'money' && old.lenderId) {
      if (d.lenderId !== undefined) next.lenderId = d.lenderId;
      if (!(ledger.payees ?? []).some((p) => p.id === next.lenderId)) throw Error('Choose the lender.');
      // No lender may end up repaid more than was lent.
      const owed = {};
      for (const e of entries.map((e) => (e.id === old.id ? next : e)))
        if (e.action === 'money' && e.lenderId)
          owed[e.lenderId] = (owed[e.lenderId] ?? 0) + (e.moneyType === 'loan_in' ? e.amount : -e.amount);
      for (const id of new Set([old.lenderId, next.lenderId]))
        if ((owed[id] ?? 0) < 0)
          throw Error(
            `${(ledger.payees ?? []).find((p) => p.id === id)?.name ?? 'The lender'} would be repaid more than was lent.`,
          );
    }
  }
  const pick = ({ amount, paidOn, reason, accountId, toAccountId, lenderId, actualBalance }) =>
    Object.fromEntries(
      Object.entries({ amount, paidOn, reason, accountId, toAccountId, lenderId, actualBalance }).filter(
        ([, v]) => v !== undefined,
      ),
    );
  return {
    ...next,
    ...(cancel ? { cancelled: true } : {}),
    version: (old.version ?? 1) + 1,
    corrections: [
      ...(old.corrections ?? []),
      {
        before: pick(old),
        reason: why,
        cancelled: cancel,
        correctedBy: audit.modifiedBy,
        correctedByLabel: audit.modifiedByLabel,
        correctedAt: audit.modifiedAt,
      },
    ],
    modifiedBy: audit.modifiedBy,
    modifiedByLabel: audit.modifiedByLabel,
    modifiedAt: audit.modifiedAt,
    lastEventId: audit.lastEventId,
  };
}
