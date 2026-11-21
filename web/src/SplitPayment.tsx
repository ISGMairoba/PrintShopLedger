import Icon from './Icon';
import SearchSelect from './SearchSelect';
import CurrencyInput from './CurrencyInput';
import { currency } from './receipts.mjs';
import { money } from './domain.mjs';
import { MAX_SPLITS } from './checkout.mjs';
import { defaultMoneyAccount } from './operations.mjs';
import type { Ledger } from './types';

/** One part of a split payment as typed: the method's name and the amount (₦). */
export type SplitRow = { methodLabel: string; amount: string };
type Method = { label: string; kind: string; displayLabel?: string };

/** The value the payment-method dropdowns use for "Split between methods". */
export const SPLIT = '__split';

/** Start a split from the method chosen so far: it takes the whole amount, the next method nothing. */
export function startSplit(methods: Method[], first: string, amount: string): SplitRow[] {
  const other = methods.find((m) => m.label !== first)?.label ?? '';
  return [
    { methodLabel: first, amount },
    { methodLabel: other, amount: '' },
  ];
}

/** The rows' total in kobo (rows still being typed count as zero). */
export function splitTotal(rows: SplitRow[]) {
  return rows.reduce((n, r) => {
    try {
      return n + money(r.amount || '0');
    } catch {
      return n;
    }
  }, 0);
}

/** The rows as the checkout's split parts (method kind, name, account and amount). */
export function splitParts(ledger: Ledger, rows: SplitRow[], methods: Method[]) {
  return rows.map((r) => {
    const m = methods.find((x) => x.label === r.methodLabel);
    if (!m) throw Error('Choose a payment method for each part.');
    let amount = 0;
    try {
      amount = money(r.amount || '0');
    } catch {
      throw Error('Enter an amount for each part of the split.');
    }
    const accountId = defaultMoneyAccount(ledger, m.label);
    return { method: m.kind, methodLabel: m.label, ...(accountId ? { accountId } : {}), amount };
  });
}

/**
 * Split payment: rows of method + amount (+ Add method, × to remove). The money received is the total of the
 * rows; `target` (when given) is what the rows should add up to, e.g. the total to pay.
 */
export default function SplitPayment({
  rows,
  methods,
  onChange,
  onCancel,
  target,
}: {
  rows: SplitRow[];
  methods: Method[];
  onChange: (rows: SplitRow[]) => void;
  onCancel: () => void;
  target?: number;
}) {
  const sum = splitTotal(rows);
  const set = (index: number, patch: Partial<SplitRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const unused = methods.filter((m) => !rows.some((r) => r.methodLabel === m.label));
  return (
    <div className="split-payment" role="group" aria-label="Split payment">
      <div className="split-head">
        <strong>Split between methods</strong>
        <button type="button" className="text-button" onClick={onCancel}>
          Use one method
        </button>
      </div>
      {rows.map((row, index) => (
        <div className="split-row" key={index}>
          <label>
            {`Method ${index + 1}`}
            <SearchSelect
              label={`Split method ${index + 1}`}
              value={row.methodLabel}
              onChange={(methodLabel) => set(index, { methodLabel })}
              placeholder="Choose…"
              options={methods
                .filter((m) => m.label === row.methodLabel || !rows.some((r) => r.methodLabel === m.label))
                .map((m) => ({ value: m.label, label: m.displayLabel || m.label }))}
            />
          </label>
          <label>
            Amount (₦)
            <CurrencyInput
              aria-label={`Split amount ${index + 1}`}
              value={row.amount}
              onValueChange={(amount) => set(index, { amount })}
            />
          </label>
          <button
            type="button"
            className="secondary split-remove"
            aria-label={`Remove method ${index + 1}`}
            disabled={rows.length <= 2}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      <div className="split-foot">
        {rows.length < MAX_SPLITS && unused.length > 0 && (
          <button
            type="button"
            className="secondary"
            onClick={() => onChange([...rows, { methodLabel: unused[0].label, amount: '' }])}
          >
            <Icon name="add" /> Add method
          </button>
        )}
        <span
          role="status"
          className={target !== undefined && sum !== target ? 'stock-near-text' : undefined}
        >
          Total of the parts <strong>{currency(sum)}</strong>
          {target !== undefined && sum < target && ` · ${currency(target - sum)} left to split`}
          {target !== undefined && sum > target && ` · ${currency(sum - target)} more than the total`}
        </span>
      </div>
    </div>
  );
}
