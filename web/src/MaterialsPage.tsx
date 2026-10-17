import DialogActions from './DialogActions';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import ResponsiveTable from './ResponsiveTable';
import Icon from './Icon';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { useId, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { SortHeader, useTableSort } from './TableSort';
import { materialCode, stockLevel } from './material-display.mjs';
import type { Expense, ExpenseEvent, Material, MaterialEvent, MaterialHistoryEntry } from './types';
import { useWords } from './Words';
import ReorderList from './ReorderList';
import { reorderList } from './reorder.mjs';
import { renameActive as wt } from './Words';

type Props = {
  history: MaterialHistoryEntry[];
  materials: Material[];
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: MaterialEvent) => Promise<void>;
  /** For the reorder list: recording a purchase saves an expense that adds stock. */
  expenses?: Expense[];
  businessName?: string;
  canRecordPurchase?: boolean;
  onSaveExpense?: (event: ExpenseEvent) => Promise<void>;
};
const timestamp = (value: string) => new Date(value).toLocaleString();
export default function MaterialsPage({
  materials,
  history,
  ready,
  busy,
  actor,
  onSave,
  expenses = [],
  businessName = '',
  canRecordPurchase = false,
  onSaveExpense,
}: Props) {
  const formId = useId();
  const [reorder, setReorder] = useState(false);
  const toReorder = reorderList({ materials, materialHistory: history } as never).length;
  const { w } = useWords();
  const { stockReasons: stockReasonDefaults, materialUnits } = useBusinessOptions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [editor, setEditor] = useState<Material | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Material | null>(null);
  const [error, setError] = useFeedbackMessage('error');
  const [audit, setAudit] = useState(false);
  const [stock, setStock] = useState<{ material: Material; mode: 'add' | 'set' } | null>(null);
  const [stockReason, setStockReason] = useState('');
  const noteSuggestions = [
    ...new Set([
      ...stockReasonDefaults,
      ...history
        .filter((item) => item.action.startsWith('material.stock_'))
        .map((item) => item.reason)
        .filter(Boolean),
    ]),
  ];
  const editing = editor && editor !== 'new' ? editor : null;
  const sorting = useTableSort<Material>('name');
  const visible = sorting.sortRows(
    materials.filter(
      (material) =>
        (filter === 'all' || material.archived === (filter === 'archived')) &&
        `${material.name} ${material.id} ${materialCode(material.id, materials)} ${material.measurementUnit}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    {
      name: (item) => item.name,
      id: (item) => materialCode(item.id, materials),
      available: (item) => item.available,
      unit: (item) => item.measurementUnit,
      requireSize: (item) => item.requireSize,
      status: (item) => (item.archived ? 'Archived' : 'Active'),
      createdBy: (item) => item.createdByLabel,
      createdAt: (item) => Date.parse(item.createdAt),
      modifiedBy: (item) => item.modifiedByLabel,
      modifiedAt: (item) => Date.parse(item.modifiedAt),
    },
  );
  async function commit(kind: MaterialEvent['kind'], data: MaterialEvent['data']) {
    setError('');
    try {
      await onSave({
        id: crypto.randomUUID(),
        kind,
        data: {
          ...data,
          modifiedBy: actor.id,
          modifiedByLabel: actor.label,
          modifiedAt: new Date().toISOString(),
        },
      });
      setEditor(null);
      setConfirmation(null);
      setStock(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save material.');
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    await commit(editing ? 'material.updated' : 'material.created', {
      id: editing?.id ?? crypto.randomUUID(),
      baseVersion: editing?.version,
      minimumStock: Number(data.get('minimumStock')),
      name: String(data.get('name')).trim(),
      available: editing?.available ?? 0,
      measurementUnit: String(data.get('measurementUnit')).trim(),
      requireSize: data.get('requireSize') === 'on',
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: '',
    });
  }
  return (
    <>
      <section className="stats">
        <article>
          <span>{w('Active materials')}</span>
          <strong>{materials.filter((item) => !item.archived).length}</strong>
          <small>{w('Available for future jobs')}</small>
        </article>
        <article>
          <span>Require size</span>
          <strong>{materials.filter((item) => !item.archived && item.requireSize).length}</strong>
          <small>Size-based pricing</small>
        </article>
        <article>
          <span>{w('Archived materials')}</span>
          <strong>{materials.filter((item) => item.archived).length}</strong>
          <small>Records and quantities retained</small>
        </article>
      </section>
      {error && !stock && !confirmation && !editor && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="toolbar material-toolbar">
          <input
            aria-label={w('Search materials')}
            placeholder="Search name, ID or unit"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label={wt('Material status')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">{w('All materials')}</option>
          </select>
          <ToolbarActions
            more={
              <MenuToggle pressed={audit} icon="audit" onClick={() => setAudit(!audit)}>
                Audit view
              </MenuToggle>
            }
          >
            <button className="secondary" disabled={!ready} onClick={() => setReorder(true)}>
              <Icon name="materials" /> Reorder list{toReorder ? ` (${toReorder})` : ''}
            </button>
            <button
              disabled={!ready || busy}
              onClick={() => {
                setEditor('new');
                setConfirmation(null);
                setStock(null);
                setError('');
              }}
            >
              <Icon name="add" /> {w('Add material')}
            </button>
          </ToolbarActions>
        </div>
        {!ready ? (
          <div className="empty">{w('Loading materials.')}</div>
        ) : !visible.length ? (
          <div className="empty">
            <h2>
              {query
                ? w('No matching materials')
                : filter === 'archived'
                  ? w('No archived materials')
                  : w('No materials yet')}
            </h2>
            <p>
              {query
                ? 'Try another name, ID or unit.'
                : w('Add materials to manage stock and define how each one is priced.')}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: w('Material'), details: [1, 4, 5] },
                { index: 2, label: 'Available', details: [3] },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={{ 1: 'ID', 3: 'Unit' }}
            >
              <table className="materials-table">
                <thead>
                  <tr>
                    <SortHeader label={w('Material')} column="name" sort={sorting} />
                    <SortHeader label={w('Material ID')} column="id" sort={sorting} />
                    <SortHeader label="Available" column="available" sort={sorting} />
                    <SortHeader label="Measurement unit" column="unit" sort={sorting} />
                    <SortHeader label="Require size" column="requireSize" sort={sorting} />
                    <SortHeader label="Status" column="status" sort={sorting} />
                    {audit && (
                      <>
                        <SortHeader label="Created by" column="createdBy" sort={sorting} />
                        <SortHeader label="Created at" column="createdAt" sort={sorting} />
                        <SortHeader label="Modified by" column="modifiedBy" sort={sorting} />
                        <SortHeader label="Modified at" column="modifiedAt" sort={sorting} />
                      </>
                    )}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((material) => (
                    <tr key={material.id}>
                      <td>
                        <strong>{material.name}</strong>
                      </td>
                      <td className="material-id">{materialCode(material.id, materials)}</td>

                      <td>
                        {material.available.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                        <small>
                          Minimum: {material.minimumStock ?? 0} {material.measurementUnit}
                        </small>
                        {stockLevel(material) && (
                          <small
                            className={
                              stockLevel(material) === 'Critical' ? 'danger-text' : 'stock-near-text'
                            }
                          >
                            {stockLevel(material)}
                          </small>
                        )}
                      </td>
                      <td>{material.measurementUnit}</td>
                      <td>{material.requireSize ? 'Yes' : 'No'}</td>
                      <td>
                        <span className={`badge ${material.archived ? 'unpaid' : 'paid'}`}>
                          {material.archived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      {audit && (
                        <>
                          <td>{material.createdByLabel}</td>
                          <td>{timestamp(material.createdAt)}</td>
                          <td>{material.modifiedByLabel}</td>
                          <td>{timestamp(material.modifiedAt)}</td>
                        </>
                      )}
                      <td>
                        <div className="material-actions">
                          {!material.archived && (
                            <>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setEditor(material);
                                  setConfirmation(null);
                                  setStock(null);
                                  setError('');
                                }}
                              >
                                <Icon name="edit" /> Edit
                              </button>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setStock({ material, mode: 'add' });
                                  setStockReason(
                                    stockReasonDefaults.includes('Restocking')
                                      ? 'Restocking'
                                      : stockReasonDefaults[0],
                                  );
                                  setEditor(null);
                                  setConfirmation(null);
                                  setError('');
                                }}
                              >
                                <Icon name="add" /> Add to stock
                              </button>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setStock({ material, mode: 'set' });
                                  setStockReason(
                                    stockReasonDefaults.includes('Stock Count Correction')
                                      ? 'Stock Count Correction'
                                      : stockReasonDefaults[0],
                                  );
                                  setEditor(null);
                                  setConfirmation(null);
                                  setError('');
                                }}
                              >
                                <Icon name="quantity" /> Set quantity
                              </button>
                            </>
                          )}
                          <button
                            className={`text-button ${material.archived ? '' : 'danger-text'}`}
                            disabled={busy}
                            onClick={() => {
                              setConfirmation(material);
                              setEditor(null);
                              setStock(null);
                              setError('');
                            }}
                          >
                            <Icon name={material.archived ? 'restore' : 'archive'} />{' '}
                            {material.archived ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        )}
      </section>
      {stock && (
        <Modal
          title={`${stock.mode === 'add' ? 'Add to stock' : 'Set quantity'}: ${stock.material.name}`}
          busy={busy}
          onClose={() => setStock(null)}
        >
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <p>
            Current available: {stock.material.available} {stock.material.measurementUnit}
          </p>
          <form
            key={stock.material.id + stock.mode}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const data = new FormData(e.currentTarget);
              await commit(stock.mode === 'add' ? 'material.stock_added' : 'material.stock_set', {
                id: stock.material.id,
                baseVersion: stock.material.version,
                quantity: Number(data.get('quantity')),
                reason: String(data.get('reason') ?? '').trim(),
                modifiedBy: actor.id,
                modifiedByLabel: actor.label,
                modifiedAt: '',
              });
            }}
          >
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  {stock.mode === 'add' ? 'Quantity to add' : 'New available quantity'}
                  <input
                    name="quantity"
                    type="number"
                    inputMode="decimal"
                    min={stock.mode === 'add' ? '0.001' : '-1000000000000'}
                    max="1000000000000"
                    step="0.001"
                    defaultValue={stock.mode === 'set' ? stock.material.available : ''}
                    required
                  />
                </label>
                <label>
                  Reason / note
                  <input
                    name="reason"
                    list="stock-reason-suggestions"
                    maxLength={500}
                    value={stockReason}
                    onChange={(e) => setStockReason(e.target.value)}
                    placeholder="Choose a suggestion or enter your own note"
                  />
                </label>
              </div>
              <datalist id="stock-reason-suggestions">
                {noteSuggestions.map((reason) => (
                  <option key={reason} value={reason} />
                ))}
              </datalist>
              <div className="reason-options" aria-label="Suggested stock notes">
                {stockReasonDefaults.map((reason) => (
                  <button
                    type="button"
                    className="secondary"
                    key={reason}
                    onClick={() => setStockReason(reason)}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <p className="muted">
                {stock.mode === 'add'
                  ? 'This quantity will be added to the existing stock.'
                  : 'This will replace the available quantity with the number you enter.'}
              </p>
              <button type="submit">
                <Icon name="save" />{' '}
                {busy ? 'Saving...' : stock.mode === 'add' ? 'Add to stock' : 'Set quantity'}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={`${confirmation.archived ? 'Restore' : 'Archive'} ${confirmation.name}?`}
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <p>
            {confirmation.archived
              ? wt('The material will be active again.')
              : 'Its quantity and audit information will be kept. You can restore it later.'}
          </p>
          <div className="material-actions">
            <button
              className={confirmation.archived ? '' : 'danger-button'}
              disabled={busy}
              onClick={() =>
                void commit(confirmation.archived ? 'material.restored' : 'material.archived', {
                  id: confirmation.id,
                  baseVersion: confirmation.version,
                  modifiedBy: actor.id,
                  modifiedByLabel: actor.label,
                  modifiedAt: '',
                })
              }
            >
              {busy ? 'Saving...' : w(confirmation.archived ? 'Restore material' : 'Archive material')}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={w(editing ? 'Edit material' : 'Add material')}
          busy={busy}
          footer={
            <DialogActions form={formId} busy={busy} onCancel={() => setEditor(null)}>
              {wt('Save material')}
            </DialogActions>
          }
          onClose={() => setEditor(null)}
        >
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <form id={formId} key={editing ? `${editing.id}:${editing.version}` : 'new'} onSubmit={submit}>
            {editing ? (
              <p className="material-id">
                {wt('Material ID')}: {materialCode(editing.id, materials)}
              </p>
            ) : (
              <p className="muted">
                {wt(
                  'A permanent unique ID is generated when you save. New materials start with zero stock; use Add to stock afterwards.',
                )}
              </p>
            )}
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Name
                  <input name="name" defaultValue={editing?.name ?? ''} maxLength={160} required />
                </label>
                <label>
                  Measurement unit
                  <input
                    name="measurementUnit"
                    list="material-units"
                    placeholder="e.g. sheet, metre, square metre"
                    maxLength={40}
                    defaultValue={editing?.measurementUnit ?? ''}
                    required
                  />
                </label>
                <label>
                  Minimum stock level
                  <input
                    name="minimumStock"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="1000000000000"
                    step="0.001"
                    defaultValue={editing?.minimumStock ?? 0}
                    required
                  />
                  <small>
                    {wt(
                      'In this material’s measurement unit. Stock up to 20% above this level is near minimum.',
                    )}
                  </small>
                </label>
                <label className="material-checkbox">
                  <span>
                    <input
                      name="requireSize"
                      type="checkbox"
                      defaultChecked={editing?.requireSize ?? false}
                    />{' '}
                    Require size
                  </span>
                  <small>
                    {wt(
                      'Enable when the service price depends on dimensions. Otherwise pricing uses quantity only. Checkout uses quantity × width × height when size is required.',
                    )}
                  </small>
                </label>
              </div>
              <datalist id="material-units">
                {materialUnits.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </fieldset>
          </form>
        </Modal>
      )}
      {reorder && (
        <ReorderList
          ledger={{ materials, materialHistory: history, expenses }}
          businessName={businessName}
          actor={actor}
          busy={busy}
          canRecordPurchase={canRecordPurchase && !!onSaveExpense}
          onSaveExpense={async (event) => {
            await onSaveExpense!(event);
          }}
          onClose={() => setReorder(false)}
        />
      )}
    </>
  );
}
