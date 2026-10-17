import ResponsiveTable from './ResponsiveTable';
import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import ExpenseEditor from './ExpenseEditor';
import { useFeedback } from './Feedback';
import { useWords } from './Words';
import { reorderList, reorderText } from './reorder.mjs';
import { whatsappLink } from './share.mjs';
import type { Expense, ExpenseEvent, Ledger } from './types';

/** Stock items at or near their minimum: choose quantities, send the list, record the purchase. */
export default function ReorderList({
  ledger,
  businessName,
  actor,
  busy,
  canRecordPurchase,
  onSaveExpense,
  onClose,
}: {
  ledger: Pick<Ledger, 'materials' | 'materialHistory'> & { expenses: Expense[] };
  businessName: string;
  actor: { id: string; label: string };
  busy: boolean;
  /** Whether this person can open Expenses (recording the purchase is an expense). */
  canRecordPurchase: boolean;
  onSaveExpense: (event: ExpenseEvent) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const notify = useFeedback();
  const rows = reorderList(ledger as Ledger);
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.materialId, String(r.suggested)])),
  );
  const [purchase, setPurchase] = useState(false);
  const selected = rows
    .filter((r) => chosen[r.materialId] !== undefined && Number(chosen[r.materialId]) > 0)
    .map((r) => ({ ...r, quantity: Math.round(Number(chosen[r.materialId]) * 1000) / 1000 }));
  async function share() {
    const text = reorderText(selected, businessName);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Order list', text });
        return;
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
    }
    window.open(whatsappLink('', text), '_blank', 'noopener');
    notify('WhatsApp is open with the order list: choose your supplier and send.', 'success');
  }
  if (purchase)
    return (
      <ExpenseEditor
        materials={ledger.materials}
        expenses={ledger.expenses}
        actor={actor}
        busy={busy}
        prefill={{
          description: `Restock: ${selected.map((r) => r.name).join(', ')}`.slice(0, 500),
          category: 'Materials',
          materials: selected.map((r) => ({
            materialId: r.materialId,
            name: r.name,
            measurementUnit: r.unit,
            quantity: r.quantity,
          })),
        }}
        onSave={onSaveExpense}
        onClose={onClose}
      />
    );
  return (
    <Modal title="Reorder list" wide busy={busy} onClose={onClose}>
      {!rows.length ? (
        <p className="empty">{w('Every material is above its minimum stock. Nothing to reorder.')}</p>
      ) : (
        <>
          <p className="muted">
            {w('Materials at or near their minimum.')} The suggested amount refills to twice the minimum, or
            the minimum plus the last 30 days' use, whichever is more. Untick or change anything before
            sending.
          </p>
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 1, label: w('Material'), details: [0] },
                { index: 2, label: 'In stock', details: [3, 4] },
                { index: 5, label: 'Buy' },
              ]}
            >
              <table aria-label="Reorder list">
                <thead>
                  <tr>
                    <th aria-label="Include" />
                    <th>{w('Material')}</th>
                    <th className="numeric">In stock</th>
                    <th className="numeric">Minimum</th>
                    <th className="numeric">Used (30 days)</th>
                    <th className="numeric">Buy</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const on = chosen[r.materialId] !== undefined;
                    return (
                      <tr key={r.materialId}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${r.name}`}
                            checked={on}
                            onChange={(e) =>
                              setChosen((c) => {
                                const next = { ...c };
                                if (e.target.checked) next[r.materialId] = String(r.suggested);
                                else delete next[r.materialId];
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>
                          {r.name}
                          <small className={r.level === 'Critical' ? 'danger-text' : 'stock-near-text'}>
                            {r.level}
                          </small>
                        </td>
                        <td className="numeric">
                          {r.available} {r.unit}
                        </td>
                        <td className="numeric">{r.minimum}</td>
                        <td className="numeric">{r.used30}</td>
                        <td className="numeric">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`Buy ${r.name}`}
                            disabled={!on}
                            value={chosen[r.materialId] ?? ''}
                            onChange={(e) => setChosen((c) => ({ ...c, [r.materialId]: e.target.value }))}
                            style={{ width: 90 }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
          <div className="material-actions">
            <button
              type="button"
              className="secondary"
              disabled={!selected.length}
              onClick={() => void share()}
            >
              <Icon name="share" /> Send list to supplier
            </button>
            {canRecordPurchase && (
              <button type="button" disabled={busy || !selected.length} onClick={() => setPurchase(true)}>
                <Icon name="expenses" /> Record purchase
              </button>
            )}
          </div>
          {canRecordPurchase && (
            <small>
              Record purchase opens a new expense with these items added to stock. Enter the amount paid
              there.
            </small>
          )}
        </>
      )}
    </Modal>
  );
}
