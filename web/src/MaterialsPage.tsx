import DialogActions from './DialogActions';
import { lowAtOtherLocations } from './low-stock-locations.mjs';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import ResponsiveTable from './ResponsiveTable';
import { auditCells, auditHeaders } from './AuditColumns';
import Icon from './Icon';
import { useCostMethod } from './CostMethodContext';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { useId, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { SortHeader, useTableSort } from './TableSort';
import { materialCode, stockLevel } from './material-display.mjs';
import type { Expense, ExpenseEvent, Material, MaterialEvent, MaterialHistoryEntry } from './types';
import { useWords } from './Words';
import ReorderList from './ReorderList';
import SplitStock from './SplitStock';
import StockAdjustDialog from './StockAdjustDialog';
import { RequestStockModal, StockRequestsPanel } from './StockRequests';
import { reorderList } from './reorder.mjs';
import { stockValuation } from './actual-cost.mjs';
import { currency } from './receipts.mjs';
import { renameActive as wt } from './Words';

type Props = {
  history: MaterialHistoryEntry[];
  /** Stock at actual cost (actual-cost.mjs), when known. */
  valuation?: ReturnType<typeof stockValuation>;
  /** A material's cost price per unit in kobo (its own, else a linked cost): Estimated cost method. */
  unitCost?: (materialId: string) => number | null;
  materials: Material[];
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: MaterialEvent) => Promise<void>;
  /** Reserved by jobs that take their materials in production (stock-count.mjs reservedStock). */
  reserved?: Record<string, number>;
  /** Where each material is kept, and setting it (Admin and higher). */
  shelves?: Record<string, string>;
  onSetShelf?: (materialId: string, shelf: string) => Promise<void>;
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
    /** Quantities at the other locations this person may see (the owner: every location). */
    stock?: { materialId: string; location: string; available: number }[];
    /** The locations this person may send stock from. */
    sendFrom: string[];
    /** Send stock from one location to another. */
    transfer: (
      materialId: string,
      from: string,
      to: string,
      quantity: number,
      reason: string,
    ) => Promise<void>;
    userId: string;
    seesAll: boolean;
    requests: import('./types').StockRequest[];
    request: (materialId: string, from: string, quantity: number, note: string) => Promise<void>;
    answer: (id: string, send: boolean, quantity: number | null, reply: string) => Promise<void>;
    cancel: (id: string) => Promise<void>;
    /** Each branch or store's own minimum stock (business settings stockMinimums). */
    minimums?: Record<string, Record<string, number>>;
    /** Set (or clear, null) this location's own minimum for a material (Admin and higher, not main). */
    setMinimum?: (materialId: string, minimum: number | null) => Promise<void>;
  };
};
const timestamp = (value: string) => new Date(value).toLocaleString();
export default function MaterialsPage({
  reserved = {},
  shelves = {},
  onSetShelf,
  materials,
  history,
  valuation,
  unitCost,
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
  const costMethod = useCostMethod();
  const [moving, setMoving] = useState<Material | null>(null);
  const [asking, setAsking] = useState<Material | null>(null);
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moveQty, setMoveQty] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const locationName = (id: string) => locations?.list.find((l) => l.id === id)?.name ?? 'Main branch';
  const formId = useId();
  const [reorder, setReorder] = useState(false);
  const toReorder = reorderList({ materials, materialHistory: history } as never).length;
  // Other locations this person can see (stores, the owner every location) that are low on an item.
  const lowElsewhere: {
    material: Material;
    location: string;
    available: number;
    level: string;
    minimum: number;
  }[] = locations
    ? lowAtOtherLocations(materials, locations.stock ?? [], locations.here, locations.list, {
        stockMinimums: locations.minimums,
      })
    : [];
  const { w } = useWords();
  const { materialUnits } = useBusinessOptions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [editor, setEditor] = useState<Material | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Material | null>(null);
  const [error, setError] = useFeedbackMessage('error');
  const [audit, setAudit] = useState(false);
  const [stock, setStock] = useState<{ material: Material; mode: 'add' | 'set' } | null>(null);
  const [splitting, setSplitting] = useState<Material | null>(null);
  const [minimumFor, setMinimumFor] = useState<Material | null>(null);
  const [minimumValue, setMinimumValue] = useState('');
  const hereName = locations?.list.find((l) => l.id === locations.here)?.name ?? 'this location';
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
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save material.');
      return false;
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const id = editing?.id ?? crypto.randomUUID();
    const shelf = String(data.get('shelf') ?? '').trim();
    const saved = await commit(editing ? 'material.updated' : 'material.created', {
      id,
      baseVersion: editing?.version,
      minimumStock: Number(data.get('minimumStock')),
      // Cost price per unit (₦ → kobo); empty clears it.
      costPrice:
        String(data.get('costPrice') ?? '').trim() === ''
          ? null
          : Math.round(Number(data.get('costPrice')) * 100),
      name: String(data.get('name')).trim(),
      available: editing?.available ?? 0,
      measurementUnit: String(data.get('measurementUnit')).trim(),
      requireSize: data.get('requireSize') === 'on',
      canSplit: data.get('canSplit') === 'on',
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: '',
    });
    // Where it is kept: saved after the material, which must exist first.
    if (saved && onSetShelf && shelf !== (shelves[id] ?? ''))
      await onSetShelf(id, shelf).catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not save the shelf.'),
      );
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
      {locations && lowElsewhere.length > 0 && (
        <section className="panel" aria-labelledby="low-elsewhere">
          <h2 id="low-elsewhere">Running low at other locations ({lowElsewhere.length})</h2>
          <div className="table-wrap">
            <table aria-label="Running low at other locations">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Item</th>
                  <th>There now</th>
                  <th>Minimum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lowElsewhere.map((row) => (
                  <tr key={row.location + row.material.id}>
                    <td>{locationName(row.location)}</td>
                    <td>
                      {row.material.name}
                      <small className={row.level === 'Critical' ? 'danger-text' : 'stock-near-text'}>
                        {row.level}
                      </small>
                    </td>
                    <td className="cell-fit">
                      {row.available.toLocaleString(undefined, { maximumFractionDigits: 3 })}{' '}
                      {row.material.measurementUnit}
                    </td>
                    <td className="cell-fit">{row.minimum}</td>
                    <td className="cell-fit">
                      {locations.sendFrom.some((from) => from !== row.location) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            const from = locations.sendFrom.includes(locations.here)
                              ? locations.here
                              : (locations.sendFrom.find((id) => id !== row.location) ?? locations.here);
                            setMoving(row.material);
                            setMoveFrom(from);
                            setMoveTo(row.location);
                            setMoveQty('');
                            setMoveReason('Running low');
                            setError('');
                          }}
                        >
                          <Icon name="share" /> Send
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {locations && (
        <StockRequestsPanel
          requests={locations.requests}
          materials={materials}
          locations={locations.list}
          userId={locations.userId}
          seesAll={locations.seesAll}
          canSendFrom={(id) => locations.sendFrom.includes(id)}
          busy={busy}
          onAnswer={locations.answer}
          onCancel={locations.cancel}
        />
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
                        {(reserved[material.id] ?? 0) > 0 && (
                          <small>
                            Reserved{' '}
                            {reserved[material.id].toLocaleString(undefined, { maximumFractionDigits: 3 })} ·
                            free{' '}
                            {(material.available - reserved[material.id]).toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                          </small>
                        )}
                        {shelves[material.id] && <small>Shelf: {shelves[material.id]}</small>}
                        <small>
                          Minimum: {material.minimumHere ?? material.minimumStock ?? 0}{' '}
                          {material.measurementUnit}
                          {material.minimumHere !== undefined && ` (set for ${hereName})`}
                        </small>
                        {locations?.stock && (
                          <small>
                            {locations.list
                              .filter(
                                (l) =>
                                  l.id !== locations.here &&
                                  locations.stock!.some((s) => s.location === l.id),
                              )
                              .map(
                                (l) =>
                                  `${l.name} ${(
                                    locations.stock!.find(
                                      (s) => s.materialId === material.id && s.location === l.id,
                                    )?.available ?? 0
                                  ).toLocaleString(undefined, { maximumFractionDigits: 3 })}`,
                              )
                              .join(' · ')}
                          </small>
                        )}
                        {costMethod === 'estimated' &&
                          (() => {
                            const unit = unitCost?.(material.id) ?? null;
                            if (unit === null) return null;
                            return (
                              <small className="actual-cost">
                                {`Cost price ${currency(Math.round(unit))} per ${material.measurementUnit} · value ${currency(Math.round(Math.max(0, material.available) * unit))}`}
                              </small>
                            );
                          })()}
                        {(() => {
                          const v = costMethod === 'actual' ? valuation?.get(material.id) : undefined;
                          if (!v || v.average === null) return null;
                          return (
                            <small className="actual-cost">
                              {v.restocks ? 'Actual cost' : 'Estimated cost'}{' '}
                              {currency(Math.round(v.average))} per {material.measurementUnit} · value{' '}
                              {currency(v.value)}
                              {v.noCost > 0 && ` · ${v.noCost.toLocaleString()} added with no cost`}
                            </small>
                          );
                        })()}
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
                              {locations?.setMinimum && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setMinimumFor(material);
                                    setMinimumValue(
                                      String(material.minimumHere ?? material.minimumStock ?? 0),
                                    );
                                    setError('');
                                  }}
                                >
                                  <Icon name="reminder" /> Minimum here
                                </button>
                              )}
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setStock({ material, mode: 'add' });
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
                                  setEditor(null);
                                  setConfirmation(null);
                                  setError('');
                                }}
                              >
                                <Icon name="quantity" /> Set quantity
                              </button>
                              <button
                                className="text-button"
                                disabled={busy || !material.canSplit}
                                title={
                                  material.canSplit
                                    ? undefined
                                    : 'Turn on "Can be split" in Edit to split this stock'
                                }
                                onClick={() => {
                                  setSplitting(material);
                                  setEditor(null);
                                  setStock(null);
                                  setConfirmation(null);
                                  setError('');
                                }}
                              >
                                <Icon name="copy" /> Split
                              </button>
                              {locations && locations.list.length > 1 && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setAsking(material);
                                    setError('');
                                  }}
                                >
                                  <Icon name="add" /> Request
                                </button>
                              )}
                              {locations && locations.list.length > 1 && locations.sendFrom.length > 0 && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setMoving(material);
                                    setMoveFrom(
                                      locations.sendFrom.includes(locations.here)
                                        ? locations.here
                                        : locations.sendFrom[0],
                                    );
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
      {splitting && (
        <SplitStock
          material={materials.find((m) => m.id === splitting.id) ?? splitting}
          materials={materials}
          busy={busy}
          actor={actor}
          onSave={onSave}
          onClose={() => setSplitting(null)}
        />
      )}
      {stock && (
        <StockAdjustDialog
          key={stock.material.id + stock.mode}
          material={materials.find((m) => m.id === stock.material.id) ?? stock.material}
          mode={stock.mode}
          history={history}
          busy={busy}
          actor={actor}
          onSave={onSave}
          onClose={() => setStock(null)}
        />
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
      {asking && locations && (
        <RequestStockModal
          material={asking}
          locations={locations.list}
          here={locations.here}
          stock={locations.stock}
          busy={busy}
          onRequest={(from, quantity, note) => locations.request(asking.id, from, quantity, note)}
          onClose={() => setAsking(null)}
        />
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
                  disabled={locations.sendFrom.length < 2}
                  onChange={(e) => {
                    setMoveFrom(e.target.value);
                    if (moveTo === e.target.value)
                      setMoveTo(locations.list.find((l) => l.id !== e.target.value)?.id ?? '');
                  }}
                >
                  {locations.list
                    .filter((l) => locations.sendFrom.includes(l.id))
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
                {locations.sendFrom.length < 2 && (
                  <small>Stock is sent from the location this device works in.</small>
                )}
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
                {moveFrom === locations.here && (
                  <small>
                    {moving.available.toLocaleString(undefined, { maximumFractionDigits: 3 })}{' '}
                    {moving.measurementUnit} here now
                  </small>
                )}
              </label>
              <label>
                Note
                <input maxLength={500} value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
              </label>
              <p className="muted">
                Moves the stock now: {locationName(moveFrom)} goes down and {locationName(moveTo)} goes up.
                Both are recorded in Stock History.
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
                {onSetShelf && (
                  <label>
                    Shelf or area
                    <input
                      name="shelf"
                      maxLength={80}
                      list="material-shelves"
                      placeholder="e.g. Rack A"
                      defaultValue={editing ? (shelves[editing.id] ?? '') : ''}
                    />
                    <datalist id="material-shelves">
                      {[...new Set(Object.values(shelves))].sort().map((shelf) => (
                        <option key={shelf} value={shelf} />
                      ))}
                    </datalist>
                    <small>Where it is kept, to count shelf by shelf (Stock → Count).</small>
                  </label>
                )}
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
                <label>
                  Cost price per unit (₦)
                  <input
                    name="costPrice"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="1000000000"
                    step="0.01"
                    defaultValue={typeof editing?.costPrice === 'number' ? editing.costPrice / 100 : ''}
                  />
                  <small>
                    {costMethod === 'estimated'
                      ? 'What one unit costs the business. Job costs and profit are estimated from it.'
                      : 'Used for jobs until stock with a supplier price is added.'}
                  </small>
                </label>
                <label className="material-checkbox">
                  <span>
                    <input name="canSplit" type="checkbox" defaultChecked={editing?.canSplit ?? false} /> Can
                    be split
                  </span>
                  <small>
                    {wt(
                      'Turn on for stock that is cut into a smaller material (e.g. A4 into A5). Only then is Split offered for it.',
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
      {minimumFor && locations?.setMinimum && (
        <Modal
          title={`Minimum stock of ${minimumFor.name} at ${hereName}`}
          busy={busy}
          onClose={() => setMinimumFor(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await locations.setMinimum!(minimumFor.id, Number(minimumValue));
                setMinimumFor(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <p>
              {hereName} is warned when its stock falls to this level. Other locations keep their own; without
              one here, {hereName} uses the item's minimum ({minimumFor.minimumStock ?? 0}{' '}
              {minimumFor.measurementUnit}).
            </p>
            {error && (
              <p role="alert" className="notice">
                {error}
              </p>
            )}
            <label>
              Minimum at {hereName} ({minimumFor.measurementUnit})
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="1000000000000"
                step="0.001"
                required
                value={minimumValue}
                onChange={(e) => setMinimumValue(e.target.value)}
              />
            </label>
            <div className="material-actions">
              {minimumFor.minimumHere !== undefined && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await locations.setMinimum!(minimumFor.id, null);
                      setMinimumFor(null);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                >
                  Use the item's minimum
                </button>
              )}
              <button type="submit" disabled={busy}>
                <Icon name="save" /> Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
