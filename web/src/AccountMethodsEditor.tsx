import type { AccountPaymentMethod } from './types';
import { methodTypes, typeName } from './account-methods.mjs';
export default function AccountMethodsEditor({
  value,
  onChange,
  savedIds = [],
}: {
  value: AccountPaymentMethod[];
  onChange: (methods: AccountPaymentMethod[]) => void;
  savedIds?: string[];
}) {
  const patch = (id: string, change: Partial<AccountPaymentMethod>) =>
    onChange(value.map((m) => (m.id === id ? { ...m, ...change } : m)));
  return (
    <fieldset>
      <legend>Payment methods in this account</legend>
      <p>
        Create the first method with the account. Add more here when money reaches the same account through
        another channel.
      </p>
      {value.map((m, i) => (
        <div className="form-grid" key={m.id}>
          <label>
            Method name
            <input
              aria-label={'Method name ' + (i + 1)}
              required
              maxLength={40}
              value={m.name}
              onChange={(e) => patch(m.id, { name: e.target.value })}
            />
          </label>
          <label>
            Payment type
            <select
              aria-label={'Payment type ' + (i + 1)}
              value={m.kind}
              onChange={(e) =>
                patch(m.id, {
                  kind: e.target.value,
                  name: m.name === typeName(m.kind) ? typeName(e.target.value) : m.name,
                })
              }
            >
              {methodTypes.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input
              aria-label={'Enable method ' + (i + 1)}
              type="checkbox"
              checked={m.enabled}
              onChange={(e) => patch(m.id, { enabled: e.target.checked })}
            />
            Enabled
          </label>
          {value.length > 1 && !savedIds.includes(m.id) && (
            <button
              className="secondary"
              type="button"
              onClick={() => onChange(value.filter((v) => v.id !== m.id))}
            >
              Remove new method
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={value.length >= 30}
        onClick={() => {
          const next = methodTypes.find((t) => !value.some((m) => m.kind === t.kind));
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              name: next?.name ?? 'Method ' + (value.length + 1),
              label: '',
              kind: next?.kind ?? 'Other',
              enabled: true,
              aliases: [],
            },
          ]);
        }}
      >
        Add payment method
      </button>
      <small>Disable a saved method to stop new payments. Past receipts and balances remain available.</small>
    </fieldset>
  );
}
