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
import { expenseSources, expenseCode, expensePaid, expenseDay, makeExpenseEvent } from './expenses.mjs';
import { materialCode } from './material-display.mjs';
import type { Expense, ExpenseEvent, ExpenseMaterial, Material } from './types';
import { useWords } from './Words';
import { renameActive as wt } from './Words';
const currency = (value: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value / 100);
type Props = {
  expense?: Expense;
  materials: Material[];
  expenses: Expense[];
  actor: { id: string; label: string };
  busy: boolean;
  mode?: 'edit' | 'payment';
  /** A new purchase started elsewhere (the reorder list): description, category and stock lines. */
  prefill?: { description: string; category?: string; materials: ExpenseMaterial[] };
  onSave: (event: ExpenseEvent) => Promise<void>;
  onClose: () => void;
};
export default function ExpenseEditor({
  expense,
  materials,
  expenses,
  actor,
  busy,
  mode = 'edit',
  prefill,
  onSave,
  onClose,
}: Props) {
  const formId = useId();
  const { w } = useWords();
  const options = useBusinessOptions(),
    expenseCategories = options.expenseCategories,
    paymentMethods = options.paymentMethods.filter((item) => item.enabled);
  const categoryOptions = [...new Set([...expenseCategories, ...(expense ? [expense.category] : [])])];
  const [category, setCategory] = useState(
    expense?.category ??
      (prefill?.category && expenseCategories.includes(prefill.category)
        ? prefill.category
        : expenseCategories.includes('Other')
          ? 'Other'
          : expenseCategories[0]),
  );
  const paymentOnly = mode === 'payment';
  const [error, setError] = useFeedbackMessage('error');
  const [stock, setStock] = useState(!!(expense?.materials.length || prefill?.materials.length));
  const [lines, setLines] = useState<ExpenseMaterial[]>(expense?.materials ?? prefill?.materials ?? []);
  const [recordPayment, setRecordPayment] = useState(!expense);
  const [total, setTotal] = useState(expense ? (expense.amount / 100).toFixed(2) : '');
  const [paidOverride, setPaidOverride] = useState<string | null>(null);
  const recommendedPaid =
    paymentOnly && expense ? ((expense.amount - expensePaid(expense)) / 100).toFixed(2) : total;
  const paid = paidOverride ?? (!amountError(recommendedPaid) ? normalizeAmount(recommendedPaid) : '');
  const paymentMaximum =
    recommendedPaid && !amountError(recommendedPaid) ? Number(recommendedPaid) : 1000000000;
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
      const payment =
        paymentOnly || (!expense && recordPayment && money(paid || '0') > 0)
          ? {
              id: crypto.randomUUID(),
              amount: money(paid),
              paidOn: String(f.get('paidOn')),
              method: paymentMethods.find((item) => item.label === String(f.get('method')))?.kind ?? '',
              methodLabel: String(f.get('method')),
              source: String(f.get('source')),
              reference: String(f.get('reference')).trim(),
            }
          : undefined;
      if (paymentOnly && money(paid || '0') === 0) throw Error('Enter an amount greater than zero.');
      const data = paymentOnly
        ? { payment }
        : {
            description: String(f.get('description')),
            category: String(f.get('category')),
            incurredOn: String(f.get('incurredOn')),
            amount: money(total),
            payee: String(f.get('payee')),
            note: String(f.get('note')),
            receiptReference: String(f.get('receiptReference')),
            materials: stock ? lines : [],
            ...(payment ? { payment } : {}),
          };
      await onSave(
        makeExpenseEvent(
          paymentOnly ? 'expense.payment_recorded' : expense ? 'expense.updated' : 'expense.created',
          data,
          expense,
          actor,
        ) as ExpenseEvent,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save expense.');
    }
  }
  return (
    <Modal
      title={paymentOnly ? 'Record expense payment' : expense ? 'Edit expense' : 'Add expense'}
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {paymentOnly ? 'Save payment' : 'Save expense'}
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
                  onChange={setCategory}
                />
                <label>
                  Date incurred
                  <input
                    name="incurredOn"
                    type="date"
                    defaultValue={expense?.incurredOn ?? expenseDay(new Date().toISOString())}
                    required
                  />
                </label>
                <label>
                  Total cost (₦)
                  <CurrencyInput name="amount" value={total} onValueChange={setTotal} required />
                </label>
                <label>
                  Supplier / paid to
                  <input
                    name="payee"
                    maxLength={160}
                    defaultValue={expense?.payee ?? ''}
                    list="expense-payee-options"
                  />
                  <datalist id="expense-payee-options">
                    {[...new Set(expenses.map((item) => item.payee).filter(Boolean))].map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Receipt / invoice reference
                  <input
                    name="receiptReference"
                    maxLength={160}
                    defaultValue={expense?.receiptReference ?? ''}
                  />
                </label>
              </div>
              <label>
                Notes
                <textarea name="note" maxLength={1000} defaultValue={expense?.note ?? ''} />
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
                          <select
                            aria-label={wt(`Material ${index + 1}`)}
                            value={line.materialId}
                            required
                            onChange={(e) => {
                              const m = materials.find((item) => item.id === e.target.value);
                              update(index, {
                                materialId: e.target.value,
                                name: m?.name ?? '',
                                measurementUnit: m?.measurementUnit ?? '',
                              });
                            }}
                          >
                            <option value="">{wt('Choose material')}</option>
                            {materials
                              .filter((m) => !m.archived || m.id === line.materialId)
                              .map((m) => (
                                <option
                                  key={m.id}
                                  value={m.id}
                                  disabled={lines.some((l, i) => i !== index && l.materialId === m.id)}
                                >
                                  {m.name} ({materialCode(m.id, materials)}){m.archived ? ' · Archived' : ''}
                                </option>
                              ))}
                          </select>
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
                        <button
                          type="button"
                          className="text-button danger-text"
                          aria-label={wt(`Remove material ${index + 1}`)}
                          onClick={() => setLines((items) => items.filter((_, i) => i !== index))}
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
                  Payment date
                  <input
                    name="paidOn"
                    type="date"
                    defaultValue={expenseDay(new Date().toISOString())}
                    required
                  />
                </label>
                <label>
                  Payment method
                  <select aria-label="Payment method" name="method" defaultValue={paymentMethods[0].label}>
                    {paymentMethods.map((item) => (
                      <option key={item.label}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Paid from
                  <select name="source" defaultValue="Business cash">
                    {expenseSources.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Payment reference
                  <input name="reference" maxLength={160} />
                </label>
              </div>
              <p className="muted">
                Leave the amount at zero for an unpaid expense. Record later payments from the expense list.
              </p>
            </section>
          )}
          {expense && !paymentOnly && (
            <p className="muted">Recorded payments are retained. Use Record payment to add a payment.</p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
