import { PERIOD_CHOICES, PERIOD_MONTHS, coversFor } from './expense-periods.mjs';
import DialogActions from './DialogActions';
import { useFeedbackMessage } from './Feedback';
import ListedCombobox from './ListedCombobox';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useId, useState, type FormEvent } from 'react';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import Icon from './Icon';
import { amountError, normalizeAmount } from './currency-input.mjs';
import { money } from './domain.mjs';
import { expenseCode, expensePaid, fromLagosLocal, lagosLocal, makeExpenseEvent } from './expenses.mjs';
import { advanceOption, usePaidFromOptions } from './paid-from';
import { usePayeeRules } from './PayeeRulesContext';
import { materialCode } from './material-display.mjs';
import type {
  Expense,
  ExpenseEvent,
  ExpenseMaterial,
  ExpensePayment,
  Material,
  Payee,
  MoneyAccount,
} from './types';
import { useWords } from './Words';
import { renameActive as wt } from './Words';
import SearchSelect from './SearchSelect';
import { useCostMethod } from './CostMethodContext';
const currency = (value: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value / 100);
type Props = {
  expense?: Expense;
  materials: Material[];
  expenses: Expense[];
  payees?: Payee[];
  accounts?: MoneyAccount[];
  /** What each payee holds as an advance (money-moves.mjs payeeAdvances): kobo by payee id. */
  advances?: Record<string, number>;
  actor: { id: string; label: string };
  busy: boolean;
  mode?: 'edit' | 'payment' | 'correct';
  /** mode 'correct': the payment being corrected. */
  correcting?: ExpensePayment;
  /** Saves a new payee and returns its id (Payee → New payee). */
  onCreatePayee?: (payee: { name: string; phone: string }) => Promise<string>;
  /** A new purchase started elsewhere (the reorder list): description, category and stock lines. */
  prefill?: {
    description: string;
    category?: string;
    materials: ExpenseMaterial[];
    amount?: number;
    payeeId?: string;
    note?: string;
    /** Paid from this money account (e.g. a difference found when reconciling it). */
    accountId?: string;
    /** The day it happened (YYYY-MM-DD), when not today. */
    on?: string;
  };
  /** Orders this expense can be linked to (For orders), newest first. */
  orders?: { id: string; label: string }[];
  /** Restocks this expense can be for (For restocks): delivery, clearance… */
  restocks?: { id: string; label: string }[];
  /** The id a new expense must get (a repeating expense's due date: the same on every device). */
  newId?: string;
  /** Called with the new expense's id once it is saved (e.g. to mark a repeating expense recorded). */
  onSaved?: (id: string) => Promise<void>;
  onSave: (event: ExpenseEvent) => Promise<void>;
  onClose: () => void;
};
export default function ExpenseEditor({
  expense,
  materials,
  expenses,
  payees = [],
  accounts = [],
  advances = {},
  actor,
  busy,
  mode = 'edit',
  correcting,
  onCreatePayee,
  prefill,
  newId,
  orders = [],
  restocks = [],
  onSave,
  onSaved,
  onClose,
}: Props) {
  const formId = useId();
  const [payeeId, setPayeeId] = useState(expense?.payeeId ?? prefill?.payeeId ?? '');
  // The orders this expense was for (its cost counts in their profit).
  const [jobIds, setJobIds] = useState<string[]>(expense?.jobIds ?? []);
  const [restockIds, setRestockIds] = useState<string[]>(expense?.restockIds ?? []);
  const costMethod = useCostMethod();
  const [newPayee, setNewPayee] = useState<{ name: string; phone: string } | null>(null);
  const { w } = useWords();
  const options = useBusinessOptions(),
    expenseCategories = options.expenseCategories;
  // One "Paid from" list (paid-from.ts), plus the payee's advance when they hold one.
  const rules = usePayeeRules();
  const held = !correcting && rules.useAdvance !== 'never' ? (advances[payeeId] ?? 0) : 0;
  const baseOptions = usePaidFromOptions(accounts);
  const paidFromOptions = held > 0 ? [advanceOption(currency(held)), ...baseOptions] : baseOptions;
  const correctingKey = correcting
    ? correcting.source === 'Personal funds'
      ? 'personal'
      : (paidFromOptions.find(
          (o) =>
            o.accountId === (correcting.accountId ?? '') &&
            o.label === (correcting.methodLabel || correcting.method),
        )?.key ??
        paidFromOptions.find((o) => o.label === (correcting.methodLabel || correcting.method))?.key ??
        '')
    : '';
  // The business's usual "paid from" for expenses (Business Settings), else the first.
  const [paidFrom, setPaidFrom] = useState(
    correctingKey ||
      (prefill?.accountId ? paidFromOptions.find((o) => o.accountId === prefill.accountId)?.key : '') ||
      (held > 0 && rules.useAdvance === 'auto' ? 'advance' : '') ||
      paidFromOptions.find((o) => o.key === options.defaultExpenseMethod)?.key ||
      paidFromOptions[0]?.key ||
      'personal',
  );
  const chosenFrom = paidFromOptions.find((o) => o.key === paidFrom) ?? paidFromOptions[0];
  const nowLocal =
    prefill?.on && prefill.on !== lagosLocal(new Date().toISOString()).slice(0, 10)
      ? `${prefill.on}T12:00`
      : lagosLocal(new Date().toISOString());
  const [when, setWhen] = useState(
    expense?.incurredAt ? lagosLocal(expense.incurredAt) : expense ? `${expense.incurredOn}T00:00` : nowLocal,
  );
  const [whenTouched, setWhenTouched] = useState(false);
  const [paidWhen, setPaidWhen] = useState(
    correcting
      ? correcting.paidAt
        ? lagosLocal(correcting.paidAt)
        : `${correcting.paidOn}T00:00`
      : nowLocal,
  );
  const [paidWhenTouched, setPaidWhenTouched] = useState(false);
  const [remove, setRemove] = useState(false);
  const categoryOptions = [...new Set([...expenseCategories, ...(expense ? [expense.category] : [])])];
  const [category, setCategory] = useState(
    expense?.category ??
      (prefill?.category && expenseCategories.includes(prefill.category)
        ? prefill.category
        : expenseCategories.includes('Other')
          ? 'Other'
          : expenseCategories[0]),
  );
  // The period it covers (profit & loss spreads it by day): months from the expense date, or own dates.
  const initialPeriod = (): number | 'custom' => {
    if (!expense) return options.categoryPeriods?.[category] ?? 0;
    if (!expense.covers) return 0;
    const match = PERIOD_MONTHS.find(
      (n) => n > 0 && JSON.stringify(coversFor(expense.incurredOn, n)) === JSON.stringify(expense.covers),
    );
    return match ?? 'custom';
  };
  const [period, setPeriod] = useState<number | 'custom'>(initialPeriod);
  const [periodTouched, setPeriodTouched] = useState(false);
  const [coverFrom, setCoverFrom] = useState(expense?.covers?.from ?? when.slice(0, 10));
  const [coverTo, setCoverTo] = useState(expense?.covers?.to ?? when.slice(0, 10));
  const chooseCategory = (next: string) => {
    setCategory(next);
    // A new expense starts with its category's usual period, until the period is chosen by hand.
    if (!expense && !periodTouched) setPeriod(options.categoryPeriods?.[next] ?? 0);
  };
  const correctOnly = mode === 'correct';
  const paymentOnly = mode === 'payment' || correctOnly;
  const [error, setError] = useFeedbackMessage('error');
  const [stock, setStock] = useState(!!(expense?.materials.length || prefill?.materials.length));
  const [lines, setLines] = useState<ExpenseMaterial[]>(expense?.materials ?? prefill?.materials ?? []);
  const [recordPayment, setRecordPayment] = useState(!expense);
  const [total, setTotal] = useState(
    expense ? (expense.amount / 100).toFixed(2) : prefill?.amount ? (prefill.amount / 100).toFixed(2) : '',
  );
  const [paidOverride, setPaidOverride] = useState<string | null>(null);
  const recommendedPaid =
    correctOnly && correcting
      ? (correcting.amount / 100).toFixed(2)
      : paymentOnly && expense
        ? ((expense.amount - expensePaid(expense)) / 100).toFixed(2)
        : total;
  const paid = paidOverride ?? (!amountError(recommendedPaid) ? normalizeAmount(recommendedPaid) : '');
  const paymentMaximum =
    correctOnly && expense && correcting
      ? (expense.amount - expensePaid(expense) + correcting.amount) / 100
      : recommendedPaid && !amountError(recommendedPaid)
        ? Number(recommendedPaid)
        : 1000000000;
  // What each material cost (Actual cost method, or kept when already entered): on every line or none.
  const [lineAmounts, setLineAmounts] = useState<string[]>(() =>
    (expense?.materials ?? prefill?.materials ?? []).map((line) =>
      line.amount === undefined ? '' : String(line.amount / 100),
    ),
  );
  const showLineAmounts = costMethod === 'actual' || lineAmounts.some((text) => text.trim());
  const pricedLines = () => {
    const priced = showLineAmounts && lineAmounts.slice(0, lines.length).some((text) => text.trim());
    return lines.map((line, i) => {
      const { amount: _old, ...rest } = line;
      return priced ? { ...rest, amount: money(lineAmounts[i] || '0') } : rest;
    });
  };
  const update = (index: number, patch: Partial<ExpenseMaterial>) =>
    setLines((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      if (!paymentOnly && !categoryOptions.includes(category))
        throw Error('Choose a category from the list.');
      if (!paymentOnly && stock && !lines.length)
        throw Error('Add at least one purchased material, or turn off Add purchased materials to stock.');
      // Old records saved without a time keep only their day unless the time is changed.
      const paidAt =
        correctOnly && correcting && !correcting.paidAt && !paidWhenTouched ? null : fromLagosLocal(paidWhen);
      const paidOn = correctOnly && correcting && paidAt === null ? correcting.paidOn : paidWhen.slice(0, 10);
      const payment =
        paymentOnly || (!expense && recordPayment && money(paid || '0') > 0)
          ? {
              id: correcting?.id ?? crypto.randomUUID(),
              accountId: chosenFrom.accountId,
              amount: money(paid || '0'),
              paidOn,
              paidAt,
              method: chosenFrom.kind,
              methodLabel: chosenFrom.label,
              source: chosenFrom.source,
              reference: String(f.get('reference') ?? '').trim(),
            }
          : undefined;
      if (correctOnly) {
        const reason = String(f.get('reason') ?? '').trim();
        if (!reason) throw Error('Enter the reason for the correction.');
        await onSave(
          makeExpenseEvent(
            'expense.payment_corrected',
            remove
              ? { paymentId: correcting!.id, remove: true, reason }
              : { paymentId: correcting!.id, payment, reason },
            expense,
            actor,
          ) as ExpenseEvent,
        );
        onClose();
        return;
      }
      if (paymentOnly && money(paid || '0') === 0) throw Error('Enter an amount greater than zero.');
      const data = paymentOnly
        ? { payment }
        : {
            description: String(f.get('description')),
            category: String(f.get('category')),
            incurredOn:
              expense && !expense.incurredAt && !whenTouched ? expense.incurredOn : when.slice(0, 10),
            incurredAt: expense && !expense.incurredAt && !whenTouched ? null : fromLagosLocal(when),
            amount: money(total),
            payeeId,
            payee: payeeId
              ? (payees.find((p) => p.id === payeeId)?.name ?? '')
              : expense && !expense.payeeId
                ? expense.payee
                : '',
            note: String(f.get('note')),
            receiptReference: String(f.get('receiptReference')),
            jobIds: stock ? [] : jobIds,
            restockIds: stock ? [] : restockIds,
            covers:
              stock || restockIds.length || jobIds.length || period === 0
                ? null
                : period === 'custom'
                  ? { from: coverFrom, to: coverTo }
                  : coversFor(
                      expense && !expense.incurredAt && !whenTouched ? expense.incurredOn : when.slice(0, 10),
                      period,
                    ),
            materials: stock ? pricedLines() : [],
            ...(payment ? { payment } : {}),
            ...(newId && !expense ? { id: newId } : {}),
          };
      const event = makeExpenseEvent(
        paymentOnly ? 'expense.payment_recorded' : expense ? 'expense.updated' : 'expense.created',
        data,
        expense,
        actor,
      ) as ExpenseEvent;
      await onSave(event);
      if (onSaved && !expense) await onSaved(event.data.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save expense.');
    }
  }
  // Linking bills to restocks is part of the Actual cost method (kept when already linked).
  const showRestocks =
    !stock && !jobIds.length && restocks.length > 0 && (costMethod === 'actual' || restockIds.length > 0);
  return (
    <Modal
      title={
        correctOnly
          ? 'Correct expense payment'
          : paymentOnly
            ? 'Record expense payment'
            : expense
              ? 'Edit expense'
              : 'Add expense'
      }
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {correctOnly
            ? remove
              ? 'Remove payment'
              : 'Save correction'
            : paymentOnly
              ? 'Save payment'
              : 'Save expense'}
        </DialogActions>
      }
    >
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {expense && (
        <p>
          <strong>{expenseCode(expense.id, expenses)}</strong> · {expense.description}
          <br />
          Paid: {currency(expensePaid(expense))} · Outstanding:{' '}
          {currency(expense.amount - expensePaid(expense))}
        </p>
      )}
      <form id={formId} onSubmit={submit}>
        <fieldset disabled={busy}>
          {!paymentOnly && (
            <>
              <div className="form-grid">
                <label>
                  Description
                  <input
                    name="description"
                    maxLength={500}
                    defaultValue={expense?.description ?? prefill?.description ?? ''}
                    required
                    placeholder="e.g. Paper purchase or generator fuel"
                  />
                </label>
                <ListedCombobox
                  label="Category"
                  name="category"
                  options={categoryOptions}
                  value={category}
                  onChange={chooseCategory}
                />
                <label>
                  Date and time
                  <input
                    name="incurredAt"
                    type="datetime-local"
                    value={when}
                    onChange={(e) => {
                      setWhen(e.target.value);
                      setWhenTouched(true);
                    }}
                    required
                  />
                </label>
                <label>
                  Total cost (₦)
                  <CurrencyInput name="amount" value={total} onValueChange={setTotal} required />
                </label>
                {!stock && !restockIds.length && !jobIds.length && (
                  <label>
                    Covers
                    <select
                      value={String(period)}
                      onChange={(e) => {
                        setPeriodTouched(true);
                        setPeriod(e.target.value === 'custom' ? 'custom' : Number(e.target.value));
                      }}
                    >
                      {PERIOD_CHOICES.map(([n, text]) => (
                        <option key={n} value={String(n)}>
                          {text}
                        </option>
                      ))}
                      <option value="custom">Choose dates…</option>
                    </select>
                    <small>
                      {period === 0
                        ? 'Counted in profit on the day it was incurred.'
                        : period === 'custom'
                          ? 'Profit counts it evenly, day by day, over these dates.'
                          : (() => {
                              const c = coversFor(when.slice(0, 10), period);
                              return `Profit counts it evenly, day by day, ${c?.from} to ${c?.to}.`;
                            })()}
                    </small>
                  </label>
                )}
                {!stock && !restockIds.length && !jobIds.length && period === 'custom' && (
                  <div className="form-grid">
                    <label>
                      Covers from
                      <input
                        type="date"
                        value={coverFrom}
                        onChange={(e) => setCoverFrom(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Covers to
                      <input
                        type="date"
                        value={coverTo}
                        onChange={(e) => setCoverTo(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                )}
                <div className="payee-pick">
                  <label>
                    Payee
                    <SearchSelect
                      label="Expense payee"
                      value={payeeId}
                      onChange={setPayeeId}
                      pinned={[
                        {
                          value: '',
                          label:
                            expense && !expense.payeeId && expense.payee
                              ? `${expense.payee} (not saved as a payee)`
                              : 'One-off / no saved payee',
                        },
                      ]}
                      options={payees
                        .filter((p) => !p.archived || p.id === expense?.payeeId)
                        .map((p) => ({
                          value: p.id,
                          label: p.name + (p.archived ? ' · Archived' : ''),
                          keywords: p.phone + ' ' + p.address,
                        }))}
                    />
                  </label>
                  {onCreatePayee && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setNewPayee({ name: '', phone: '' })}
                    >
                      <Icon name="add" /> New payee
                    </button>
                  )}
                </div>
                <label>
                  Receipt / invoice reference
                  <input
                    name="receiptReference"
                    maxLength={160}
                    defaultValue={expense?.receiptReference ?? ''}
                  />
                </label>
              </div>
              {/* Linking bills to restocks is part of the Actual cost method (kept when already linked). */}
              {showRestocks && (
                <div className="expense-orders">
                  <SearchSelect
                    label="For restocks (optional)"
                    value=""
                    placeholder="Search a restock to link"
                    options={restocks
                      .filter((r) => !restockIds.includes(r.id))
                      .map((r) => ({ value: r.id, label: r.label }))}
                    disabled={restockIds.length >= 20}
                    onChange={(id) => id && setRestockIds([...restockIds, id])}
                  />
                  {restockIds.length > 0 && (
                    <ul className="expense-order-list">
                      {restockIds.map((id) => (
                        <li key={id}>
                          <span>
                            {restocks.find((r) => r.id === id)?.label ?? `#${id.slice(0, 8).toUpperCase()}`}
                          </span>
                          <button
                            type="button"
                            className="text-button danger-text"
                            aria-label={`Unlink restock ${id.slice(0, 8).toUpperCase()}`}
                            onClick={() => setRestockIds(restockIds.filter((x) => x !== id))}
                          >
                            <Icon name="close" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <small className="muted">
                    Delivery, clearance, cutting and the like: its cost joins these restocks' cost per unit
                    (shared by their supplier price), or a split's pieces, not under expenses.
                  </small>
                </div>
              )}
              {!stock && !restockIds.length && orders.length > 0 && (
                <div className="expense-orders">
                  <SearchSelect
                    label={wt('For orders (optional)')}
                    value=""
                    placeholder={wt('Search an order to link')}
                    options={orders
                      .filter((o) => !jobIds.includes(o.id))
                      .map((o) => ({ value: o.id, label: o.label }))}
                    disabled={jobIds.length >= 20}
                    onChange={(id) => id && setJobIds([...jobIds, id])}
                  />
                  {jobIds.length > 0 && (
                    <ul className="expense-order-list">
                      {jobIds.map((id) => (
                        <li key={id}>
                          <span>
                            {orders.find((o) => o.id === id)?.label ?? `#${id.slice(0, 8).toUpperCase()}`}
                          </span>
                          <button
                            type="button"
                            className="text-button danger-text"
                            aria-label={`Unlink order ${id.slice(0, 8).toUpperCase()}`}
                            onClick={() => setJobIds(jobIds.filter((x) => x !== id))}
                          >
                            <Icon name="close" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <small className="muted">
                    {wt(
                      'Its cost counts in these orders’ profit (shared by order amount), not under expenses.',
                    )}
                  </small>
                </div>
              )}
              <label>
                Notes
                <textarea name="note" maxLength={1000} defaultValue={expense?.note ?? prefill?.note ?? ''} />
              </label>
              <section className="expense-stock">
                <label className="check-label">
                  <input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} />
                  {wt('Add purchased materials to stock')}
                </label>
                {stock && (
                  <>
                    <p className="muted">
                      {wt(
                        'Enter quantities received in the displayed units. Save here once; stock and history update together. Do not add this purchase again through Materials.',
                      )}
                    </p>
                    {lines.map((line, index) => (
                      <div className="expense-stock-line" key={index}>
                        <label>
                          {wt('Material')}
                          <SearchSelect
                            label={wt(`Material ${index + 1}`)}
                            value={line.materialId}
                            required
                            placeholder={wt('Choose material')}
                            options={materials
                              .filter((m) => !m.archived || m.id === line.materialId)
                              .map((m) => ({
                                value: m.id,
                                label: `${m.name} (${materialCode(m.id, materials)})${m.archived ? ' · Archived' : ''}`,
                                disabled: lines.some((l, i) => i !== index && l.materialId === m.id),
                              }))}
                            onChange={(next) => {
                              const m = materials.find((item) => item.id === next);
                              update(index, {
                                materialId: next,
                                name: m?.name ?? '',
                                measurementUnit: m?.measurementUnit ?? '',
                              });
                            }}
                          />
                        </label>
                        <label>
                          Quantity received{line.measurementUnit && ` (${line.measurementUnit})`}
                          <input
                            aria-label={`Quantity received ${index + 1}`}
                            type="number"
                            inputMode="decimal"
                            step="0.001"
                            min="0.001"
                            max="1000000000000"
                            value={line.quantity || ''}
                            onChange={(e) => update(index, { quantity: Number(e.target.value) })}
                            required
                          />
                        </label>
                        {showLineAmounts && (
                          <label>
                            Amount (₦, optional)
                            <CurrencyInput
                              aria-label={`Amount ${index + 1}`}
                              value={lineAmounts[index] ?? ''}
                              onValueChange={(text) =>
                                setLineAmounts((list) => {
                                  const next = [...list];
                                  next[index] = text;
                                  return next;
                                })
                              }
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="text-button danger-text"
                          aria-label={wt(`Remove material ${index + 1}`)}
                          onClick={() => {
                            setLines((items) => items.filter((_, i) => i !== index));
                            setLineAmounts((list) => list.filter((_, i) => i !== index));
                          }}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="secondary"
                      disabled={!materials.some((m) => !m.archived) || lines.length >= 50}
                      onClick={() =>
                        setLines((items) => [
                          ...items,
                          { materialId: '', name: '', measurementUnit: '', quantity: 0 },
                        ])
                      }
                    >
                      <Icon name="add" /> {wt('Add material')}
                    </button>
                    {showLineAmounts && (
                      <p className="muted">
                        {lineAmounts.some((text) => text.trim())
                          ? `Materials add up to ${currency(lines.reduce((n, _, i) => n + money(lineAmounts[i] || '0'), 0))} of ${currency(money(total || '0'))}.`
                          : 'Enter what each material cost to value the stock at what it really cost (every line or none, adding up to the amount).'}
                      </p>
                    )}
                    {!materials.some((m) => !m.archived) && (
                      <p className="notice">{wt('Create a material on the Materials page first.')}</p>
                    )}
                    {expense && (
                      <p className="muted">
                        {w(
                          'Changing or removing a quantity adjusts stock by the difference. Existing job deductions remain in place.',
                        )}
                      </p>
                    )}
                  </>
                )}
              </section>
            </>
          )}
          {!expense && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={recordPayment}
                onChange={(e) => {
                  setRecordPayment(e.target.checked);
                  setPaidOverride(null);
                }}
              />
              Record money paid now
            </label>
          )}
          {(paymentOnly || (!expense && recordPayment)) && (
            <section className="expense-payment">
              <h3>Payment details</h3>
              <div className="form-grid">
                <label>
                  Amount paid (₦)
                  <CurrencyInput
                    value={paid}
                    max={paymentMaximum}
                    onValueChange={setPaidOverride}
                    required={paymentOnly}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Paid on (date and time)
                  <input
                    aria-label="Payment date and time"
                    type="datetime-local"
                    value={paidWhen}
                    onChange={(e) => {
                      setPaidWhen(e.target.value);
                      setPaidWhenTouched(true);
                    }}
                    required
                  />
                </label>
                <label>
                  Paid from
                  <SearchSelect
                    label="Paid from"
                    value={paidFrom}
                    onChange={setPaidFrom}
                    options={paidFromOptions.map((o) => ({ value: o.key, label: o.text }))}
                  />
                </label>
                <label>
                  Payment reference
                  <input name="reference" maxLength={160} defaultValue={correcting?.reference ?? ''} />
                </label>
              </div>
              {correctOnly ? (
                <>
                  <label>
                    Reason for the correction
                    <input
                      name="reason"
                      maxLength={500}
                      required
                      placeholder="e.g. Paid by transfer, not cash"
                    />
                  </label>
                  <label className="check-label">
                    <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
                    Remove this payment (it was entered by mistake)
                  </label>
                  <p className="muted">
                    The account balances follow the correction. The original payment stays in the change
                    history.
                  </p>
                </>
              ) : (
                <p className="muted">
                  Leave the amount at zero for an unpaid expense. Record later payments from the expense list.
                </p>
              )}
            </section>
          )}
          {expense && !paymentOnly && (
            <p className="muted">
              Recorded payments are retained. Use Record payment to add one, or Details → Correct to fix one.
            </p>
          )}
        </fieldset>
      </form>
      {newPayee && onCreatePayee && (
        <Modal title="New payee" busy={busy} onClose={() => setNewPayee(null)}>
          <label>
            Payee name
            <input
              aria-label="New payee name"
              maxLength={160}
              value={newPayee.name}
              onChange={(e) => setNewPayee({ ...newPayee, name: e.target.value })}
              autoFocus
            />
          </label>
          <label>
            Phone
            <input
              maxLength={40}
              value={newPayee.phone}
              onChange={(e) => setNewPayee({ ...newPayee, phone: e.target.value })}
            />
          </label>
          <div className="material-actions">
            <button type="button" className="secondary" onClick={() => setNewPayee(null)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !newPayee.name.trim()}
              onClick={async () => {
                setError('');
                try {
                  setPayeeId(
                    await onCreatePayee({ name: newPayee.name.trim(), phone: newPayee.phone.trim() }),
                  );
                  setNewPayee(null);
                } catch (cause) {
                  setNewPayee(null);
                  setError(cause instanceof Error ? cause.message : 'Could not save the payee.');
                }
              }}
            >
              Save payee
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
