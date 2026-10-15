import { useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import ResponsiveTable from './ResponsiveTable';
import type { Ledger, Service, ServiceEvent } from './types';
import { costImportEvents, reviewCostImport } from './cost-transfer.mjs';
import { currency } from './receipts.mjs';

export type ImportedCosts = {
  description: string;
  costing: { key: string; amount: number; per: number; unit?: string };
}[];

export default function CostImportDialog({
  costs,
  ledger,
  actor,
  canSave,
  onSave,
  onClose,
  onDone,
}: {
  costs: ImportedCosts;
  ledger: Ledger;
  actor: { id: string; label: string };
  canSave: boolean;
  onSave: (events: ServiceEvent[]) => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const review = useMemo<{
    rows: (ImportedCosts[number] & {
      existing: (Service & { costing: ImportedCosts[number]['costing'] }) | null;
    })[];
    error: string;
  }>(() => {
    try {
      return { rows: reviewCostImport(costs, ledger), error: '' };
    } catch (e) {
      return { rows: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [costs, ledger]);
  const added = review.rows.filter((r) => !r.existing).length;
  const kept = review.rows.length - added;
  async function confirm() {
    if (busy || !canSave || review.error) return;
    setBusy(true);
    setError('');
    try {
      const events = costImportEvents(costs, ledger, actor) as ServiceEvent[];
      if (events.length) await onSave(events);
      onDone(
        `${events.length} saved costs created; ${kept} existing costs kept. Wait for Saved before importing templates.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Import saved costs" wide busy={busy} onClose={onClose}>
      <p>
        Create {added} private costs and keep {kept} existing costs. Existing amounts are never overwritten.
        These costs calculate prices only; they do not create stock items or change stock balances.
      </p>
      <p>
        Check the amounts before saving. Once they have synced, import the template file and review its item
        matches. A template using an existing cost will use that cost's current amount.
      </p>
      {!review.error && (
        <div className="table-wrap">
          <ResponsiveTable
            columns={[
              { index: 0, label: 'Cost', details: [1] },
              { index: 2, label: 'Amount', details: [3] },
              { index: 4, label: 'Action' },
            ]}
          >
            <table aria-label="Saved costs to import">
              <thead>
                <tr>
                  <th>Cost</th>
                  <th>Formula name</th>
                  <th>File amount</th>
                  <th>Current amount</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => (
                  <tr key={row.costing.key}>
                    <td>{row.description}</td>
                    <td>
                      <code>{row.costing.key}</code>
                    </td>
                    <td>
                      {currency(row.costing.amount!)} / {row.costing.per} {row.costing.unit || 'item'}
                    </td>
                    <td>
                      {row.existing
                        ? `${currency(row.existing.costing.amount)} / ${row.existing.costing.per} ${row.existing.costing.unit || 'item'}`
                        : '—'}
                    </td>
                    <td>{row.existing ? 'Keep existing' : 'Create private cost'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </div>
      )}
      {(review.error || error) && (
        <p role="alert" className="danger-text">
          {review.error || error}
        </p>
      )}
      <div className="material-actions">
        <button type="button" disabled={busy || !canSave || !!review.error} onClick={() => void confirm()}>
          <Icon name="import" /> {busy ? 'Importing…' : 'Save imported costs'}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
