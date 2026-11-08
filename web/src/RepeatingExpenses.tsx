import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { businessDay } from './dashboard.mjs';
import { EVERY, dueRepeats, nextDate } from './repeating-expenses.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import type { Expense, Ledger, RepeatingExpense } from './types';

const today = () => businessDay(new Date().toISOString());
const dayText = (d: string) =>
  new Date(`${d}T12:00:00+01:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** Repeating expenses due now: record each (checking the amount) or skip it. */
export function DueRepeats({
  ledger,
  busy,
  onRecord,
  onSkip,
}: {
  ledger: Ledger;
  busy: boolean;
  onRecord: (r: RepeatingExpense) => void;
  onSkip: (r: RepeatingExpense) => void;
}) {
  const due = dueRepeats(ledger, today()) as RepeatingExpense[];
  if (!due.length) return null;
  return (
    <section className="panel due-repeats" aria-label="Due to record">
      <h2>Due to record</h2>
      <p className="muted">
        Repeating expenses are not recorded on their own. Check each amount (prices change), then record it,
        or skip it this time.
      </p>
      <ul className="due-repeat-list">
        {due.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.description}</strong>
              <small>
                Due {dayText(r.nextDue)} · {EVERY[r.every].toLowerCase()} · last {currency(r.amount)}
                {r.payee ? ` · ${r.payee}` : ''}
              </small>
            </span>
            <span className="material-actions">
              <button type="button" disabled={busy} onClick={() => onRecord(r)}>
                <Icon name="add" /> Record
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => onSkip(r)}>
                Skip this time
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Make an expense repeat, or change a repeating one (how often, next date, pause or stop). */
export function RepeatEditor({
  repeat,
  from,
  busy,
  onSave,
  onClose,
}: {
  repeat?: RepeatingExpense;
  from?: Expense;
  busy: boolean;
  onSave: (data: Record<string, unknown>, kind: 'repeat.created' | 'repeat.updated') => Promise<boolean>;
  onClose: () => void;
}) {
  const { expenseCategories } = useBusinessOptions();
  const [every, setEvery] = useState<RepeatingExpense['every']>(repeat?.every ?? 'month');
  const base = from?.incurredOn ?? today();
  const [nextDue, setNextDue] = useState(repeat?.nextDue ?? nextDate(base, 'month'));
  const [status, setStatus] = useState<RepeatingExpense['status']>(repeat?.status ?? 'active');
  const [problem, setProblem] = useState('');
  return (
    <Modal
      title={repeat ? `Repeating · ${repeat.description}` : 'Make this expense repeat'}
      busy={busy}
      onClose={onClose}
    >
      {problem && (
        <p role="alert" className="notice">
          {problem}
        </p>
      )}
      <p className="muted">
        When it is due it waits in Due to record for an Admin to check the amount and record it. Nothing is
        recorded on its own.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setProblem('');
          const f = new FormData(e.currentTarget);
          try {
            const data = {
              id: repeat?.id ?? crypto.randomUUID(),
              ...(repeat ? { baseVersion: repeat.version } : {}),
              description: String(f.get('description')),
              category: String(f.get('category')),
              amount: money(String(f.get('amount') || '0')),
              payeeId: repeat?.payeeId ?? from?.payeeId ?? '',
              payee: repeat?.payee ?? from?.payee ?? '',
              note: String(f.get('note') ?? ''),
              every,
              nextDue,
              status,
            };
            if (await onSave(data, repeat ? 'repeat.updated' : 'repeat.created')) onClose();
          } catch (cause) {
            setProblem(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Description
            <input
              name="description"
              required
              maxLength={200}
              defaultValue={repeat?.description ?? from?.description ?? ''}
            />
          </label>
          <label>
            Category
            <select name="category" defaultValue={repeat?.category ?? from?.category ?? expenseCategories[0]}>
              {[...new Set([...expenseCategories, repeat?.category ?? from?.category ?? ''])]
                .filter(Boolean)
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
          </label>
          <label>
            Usual amount (₦)
            <CurrencyInput
              name="amount"
              defaultValue={((repeat?.amount ?? from?.amount ?? 0) / 100).toFixed(2)}
            />
            <small>A guide: you check and change it each time it is recorded.</small>
          </label>
          <label>
            How often
            <select
              aria-label="How often"
              value={every}
              onChange={(e) => {
                const v = e.target.value as RepeatingExpense['every'];
                setEvery(v);
                if (!repeat) setNextDue(nextDate(base, v));
              }}
            >
              {(Object.keys(EVERY) as RepeatingExpense['every'][]).map((k) => (
                <option key={k} value={k}>
                  {EVERY[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Next due
            <input type="date" required value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </label>
          {repeat && (
            <label>
              Status
              <select
                aria-label="Repeat status"
                value={status}
                onChange={(e) => setStatus(e.target.value as RepeatingExpense['status'])}
              >
                <option value="active">Active</option>
                <option value="paused">Paused (no reminders)</option>
                <option value="stopped">Stopped</option>
              </select>
            </label>
          )}
          <label>
            Note
            <textarea name="note" maxLength={1000} defaultValue={repeat?.note ?? from?.note ?? ''} />
          </label>
          <button type="submit">{repeat ? 'Save changes' : 'Make it repeat'}</button>
        </fieldset>
      </form>
    </Modal>
  );
}

/** Every repeating expense, with its next date and status. */
export function RepeatList({
  ledger,
  busy,
  onEdit,
}: {
  ledger: Ledger;
  busy: boolean;
  onEdit: (r: RepeatingExpense) => void;
}) {
  const list = (ledger.repeatingExpenses ?? []) as RepeatingExpense[];
  if (!list.length) return null;
  const order = { active: 0, paused: 1, stopped: 2 };
  return (
    <details className="panel repeat-list">
      <summary>Repeating expenses ({list.filter((r) => r.status === 'active').length} active)</summary>
      <ul className="due-repeat-list">
        {[...list]
          .sort((a, b) => order[a.status] - order[b.status] || a.nextDue.localeCompare(b.nextDue))
          .map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.description}</strong>
                <small>
                  {EVERY[r.every]} · {r.status === 'active' ? `next ${dayText(r.nextDue)}` : r.status} · last{' '}
                  {currency(r.amount)}
                  {r.history.length
                    ? ` · ${r.history.filter((h) => h.action === 'recorded').length} recorded`
                    : ''}
                </small>
              </span>
              <button type="button" className="text-button" disabled={busy} onClick={() => onEdit(r)}>
                <Icon name="edit" /> Change
              </button>
            </li>
          ))}
      </ul>
    </details>
  );
}
