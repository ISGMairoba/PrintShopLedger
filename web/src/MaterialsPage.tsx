import DialogActions from './DialogActions';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import ResponsiveTable from './ResponsiveTable';
import { auditCells, auditHeaders } from './AuditColumns';
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
  payees?: import('./types').Payee[];
  accounts?: import('./types').MoneyAccount[];
  businessName?: string;
  canRecordPurchase?: boolean;
  onSaveExpense?: (event: ExpenseEvent) => Promise<void>;
  /** With branches or stores: stock per location and transfers between them. */
  locations?: {
    /** The location this device works in. */
    here: string;
    list: { id: string; name: string; kind?: string }[];
    /** The owner's view: every location's quantity. */
    stock?: { materialId: string; location: string; available: number }[];
    /** Send stock from one location to another. */
    transfer: (materialId: string, from: string, to: string, quantity: number, reason: string) => Promise<void>;
  };
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
  payees = [],
  accounts = [],
  businessName = '',
  canRecordPurchase = false,
  onSaveExpense,
  locations,
}: Props) {
  const [moving, setMoving] = useState<Material | null>(null);
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moveQty, setMoveQty] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const locationName = (id: string) => locations?.list.find((l) => l.id === id)?.name ?? 'Main branch';
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
      <section className="stats catalogue-stats">
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
                { index: 0, label: w('Material'), details: [3] },
                { index: 1, label: 'Available', details: [2] },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={{ 2: 'Unit' }}
              extraSortOptions={[
                { key: 'id', label: w('Material ID') },
                { key: 'requireSize', label: 'Require size' },
              ]}
            >
              <table className="materials-table">
                <thead>
                  <tr>
                    <SortHeader label={w('Material')} column="name" sort={sorting} />
                    <SortHeader label="Available" column="available" sort={sorting} />
                    <SortHeader label="Unit · size" column="unit" sort={sorting} />
                    <SortHeader label="Status" column="status" sort={sorting} />
                    {audit && auditHeaders(sorting)}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((material) => (
                    <tr key={material.id}>
                      <td>
                        <strong>{material.name}</strong>
                        <small className="record-id">{materialCode(material.id, materials)}</small>
                      </td>
                      <td className="cell-fit">
                        {material.available.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                        <small>
                          Minimum: {material.minimumStock ?? 0} {material.measurementUnit}
                        </small>
                        {locations?.stock && (
                          <small>
                            {locations.list
                              .map(
                                (l) =>
                                  `${l.name} ${(
                                    locations.stock!.find((s) => s.materialId === material.id && s.location === l.id)
                                      ?.available ?? 0
                                  ).toLocaleString(undefined, { maximumFractionDigits: 3 })}`,
                              )
                              .join(' · ')}
                          </small>
                        )}
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
                      <td className="cell-fit">
                        {material.measurementUnit}
                        <small>{material.requireSize ? 'Size required' : 'No size'}</small>
                      </td>
                      <td className="cell-fit">
                        <span className={`badge ${material.archived ? 'unpaid' : 'paid'}`}>
                          {material.archived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      {audit && auditCells(material, timestamp)}
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
                              {locations && locations.list.length > 1 && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setMoving(material);
                                    setMoveFrom(locations.here);
                                    setMoveTo(locations.list.find((l) => l.id !== locations.here)?.id ?? '');
                                    setMoveQty('');
                                    setMoveReason('');
                                    setError('');
                                  }}
                                >
                                  <Icon name="share" /> Transfer
                                </button>
                              )}
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
              <Icon name="archive" />{' '}
              {busy ? 'Saving...' : w(confirmation.archived ? 'Restore material' : 'Archive material')}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              <Icon name="close" /> Cancel
            </button>
          </div>
        </Modal>
      )}
      {moving && locations && (
        <Modal title={`Transfer ${moving.name}`} busy={busy} onClose={() => setMoving(null)}>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const qty = Number(moveQty);
              if (!(qty > 0)) {
                setError('Enter a quantity greater than zero.');
                return;
              }
              try {
                await locations.transfer(moving.id, moveFrom, moveTo, qty, moveReason.trim());
                setMoving(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                From
                <select
                  aria-label="From"
                  value={moveFrom}
                  disabled={!locations.stock}
                  onChange={(e) => setMoveFrom(e.target.value)}
                >
                  {locations.list.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {!locations.stock && <small>Stock is sent from the location this device works in.</small>}
              </label>
              <label>
                To
                <select aria-label="To" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {locations.list
                    .filter((l) => l.id !== moveFrom)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.kind === 'store' ? ' (store)' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantity ({moving.measurementUnit})
                <input
                  aria-label="Quantity to transfer"
                  inputMode="decimal"
                  required
                  value={moveQty}
                  onChange={(e) => setMoveQty(e.target.value)}
                />
                {moveFrom === locations.here && !locations.stock && (
                  <small>
                    {moving.available.toLocaleString(undefined, { maximumFractionDigits: 3 })} {moving.measurementUnit}{' '}
                    here now
                  </small>
                )}
              </label>
              <label>
                Note
                <input maxLength={500} value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
              </label>
              <p className="muted">
                Moves the stock now: {locationName(moveFrom)} goes down and {locationName(moveTo)} goes up. Both are
                recorded in Stock History.
              </p>
              <div className="material-actions">
                <button type="button" className="secondary" onClick={() => setMoving(null)}>
                  Cancel
                </button>
                <button type="submit">Transfer</button>
              </div>
            </fieldset>
          </form>
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
          ledger={{ materials, materialHistory: history, expenses, payees, moneyAccounts: accounts }}
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
