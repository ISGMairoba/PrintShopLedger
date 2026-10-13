import ResponsiveTable from './ResponsiveTable';
import Icon from './Icon';
import { useDateFilter } from './PeriodFilter';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { SortHeader, useTableSort } from './TableSort';
import { materialActionLabels, materialCode } from './material-display.mjs';
import type { LedgerEvent, Material, MaterialHistoryEntry, MaterialSnapshot } from './types';
import { useWords } from './Words';

type Props = {
  history: MaterialHistoryEntry[];
  materials: Material[];
  pending: LedgerEvent[];
  ready: boolean;
  demo: boolean;
};
const quantity = (value: number | null | undefined) =>
  value == null ? '-' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const dateKey = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
const dateLabel = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
const fields: { key: keyof MaterialSnapshot; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'available', label: 'Available' },
  { key: 'minimumStock', label: 'Minimum stock' },
  { key: 'measurementUnit', label: 'Measurement unit' },
  { key: 'requireSize', label: 'Require size' },
  { key: 'archived', label: 'Archived' },
];
const valueLabel = (value: unknown) =>
  value == null ? '-' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

export default function StockHistoryPage({ history, materials, pending, ready, demo }: Props) {
  const { w } = useWords();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [materialId, setMaterialId] = useState('');
  const dates = useDateFilter('stockHistory');
  const from = dates.period.preset === 'all' ? '' : dates.period.from,
    to = dates.period.preset === 'all' ? '' : dates.period.to;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [from, to]);
  const [selected, setSelected] = useState<MaterialHistoryEntry | null>(null);
  const pendingIds = new Set(pending.map((item) => item.id));
  const sorting = useTableSort<MaterialHistoryEntry>('date', 'desc');
  const historySorting = {
    ...sorting,
    toggle: (key: string) => {
      sorting.toggle(key);
      setPage(0);
    },
  };
  const matching = sorting.sortRows(
    [...history].filter((entry) => {
      const currentName = materials.find((item) => item.id === entry.materialId)?.name ?? '';
      const text =
        `${entry.materialName} ${currentName} ${materialCode(entry.materialId, materials)} ${materialActionLabels[entry.action]} ${entry.reason} ${entry.changedByLabel}`.toLowerCase();
      const day = dateKey(entry.changedAt);
      return (
        text.includes(search.toLowerCase()) &&
        (!action || entry.action === action) &&
        (!materialId || entry.materialId === materialId) &&
        (!from || day >= from) &&
        (!to || day <= to)
      );
    }),
    {
      material: (item) => item.materialName,
      before: (item) => item.beforeAvailable,
      after: (item) => item.afterAvailable,
      change: (item) => (item.beforeAvailable == null ? null : item.afterAvailable - item.beforeAvailable),
      action: (item) => materialActionLabels[item.action],
      reason: (item) => item.reason,
      by: (item) => item.changedByLabel,
      date: (item) => Date.parse(item.changedAt),
    },
  );
  const maxPage = Math.max(0, Math.ceil(matching.length / 50) - 1);
  const activePage = Math.min(page, maxPage);
  const visible = matching.slice(activePage * 50, activePage * 50 + 50);
  const change = (callback: () => void) => {
    callback();
    setPage(0);
  };
  return (
    <>
      <section className="panel">
        <div className="toolbar history-toolbar">
          <input
            aria-label="Search stock history"
            placeholder="Search material, action, note or user"
            value={search}
            onChange={(e) => change(() => setSearch(e.target.value))}
          />
          <select
            aria-label={w('Filter material')}
            value={materialId}
            onChange={(e) => change(() => setMaterialId(e.target.value))}
          >
            <option value="">{w('All materials')}</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({materialCode(item.id, materials)})
              </option>
            ))}
          </select>
          <select
            aria-label="Filter action"
            value={action}
            onChange={(e) => change(() => setAction(e.target.value))}
          >
            <option value="">All actions</option>
            {Object.entries(materialActionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {w(label)}
              </option>
            ))}
          </select>
          {dates.button}
          <button
            className="secondary history-filter-reset"
            type="button"
            onClick={() => {
              setSearch('');
              setAction('');
              setMaterialId('');
              dates.reset();
              setPage(0);
            }}
          >
            Reset filters
          </button>
        </div>
        {dates.panel}
        {!ready ? (
          <div className="empty">Loading stock history.</div>
        ) : !matching.length ? (
          <div className="empty">
            <h2>{history.length ? 'No matching changes' : w('No material changes yet')}</h2>
            <p>
              {history.length
                ? 'Adjust the filters to find a record.'
                : w('Material creation, editing, stock changes, archive and restore will appear here.')}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: w('Material'), details: [4, 5, 6, 7] },
                { index: 2, label: 'Available', details: [1, 3] },
                { index: 8, label: 'Actions', actions: true },
              ]}
            >
              <table>
                <thead>
                  <tr>
                    <SortHeader label={w('Material')} column="material" sort={historySorting} />
                    <SortHeader label="Available before" column="before" sort={historySorting} />
                    <SortHeader label="Available after" column="after" sort={historySorting} />
                    <SortHeader label="Change" column="change" sort={historySorting} />
                    <SortHeader label="Action" column="action" sort={historySorting} />
                    <SortHeader label="Reason / note" column="reason" sort={historySorting} />
                    <SortHeader label="Changed by" column="by" sort={historySorting} />
                    <SortHeader label="Date" column="date" sort={historySorting} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.materialName}</strong>
                        <small>{materialCode(entry.materialId, materials)}</small>
                      </td>
                      <td>{quantity(entry.beforeAvailable)}</td>
                      <td>
                        {quantity(entry.afterAvailable)}
                        <small>{entry.measurementUnit}</small>
                      </td>
                      <td>
                        {entry.beforeAvailable == null
                          ? '-'
                          : `${entry.afterAvailable > entry.beforeAvailable ? '+' : ''}${quantity(Math.round((entry.afterAvailable - entry.beforeAvailable) * 1000) / 1000)}`}
                      </td>
                      <td>
                        {w(materialActionLabels[entry.action])}
                        <small>
                          {demo
                            ? 'On this device'
                            : pendingIds.has(entry.id) ||
                                (!!entry.checkoutId && pendingIds.has(entry.checkoutId)) ||
                                (!!entry.expenseId &&
                                  pending.some(
                                    (e) => e.kind.startsWith('expense.') && e.data.id === entry.expenseId,
                                  ))
                              ? 'Pending sync'
                              : 'Synced'}
                        </small>
                      </td>
                      <td>{entry.reason || '-'}</td>
                      <td>{entry.changedByLabel}</td>
                      <td>{dateLabel(entry.changedAt)}</td>
                      <td>
                        <button className="text-button" onClick={() => setSelected(entry)}>
                          <Icon name="details" /> Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        )}
        {ready && matching.length > 0 && (
          <div className="toolbar history-pagination">
            <span>
              {activePage * 50 + 1}-{Math.min((activePage + 1) * 50, matching.length)} of {matching.length}{' '}
              changes
            </span>
            <button className="secondary" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>
              Previous
            </button>
            <button
              className="secondary"
              disabled={activePage === maxPage}
              onClick={() => setPage(activePage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
      {selected && (
        <Modal title={w(materialActionLabels[selected.action])} wide onClose={() => setSelected(null)}>
          <p>
            {selected.materialName} · {materialCode(selected.materialId, materials)}
          </p>
          <p>
            {selected.changedByLabel} · {dateLabel(selected.changedAt)}
          </p>
          {selected.reason && <p>Reason / note: {selected.reason}</p>}
          {!selected.detailsComplete && (
            <p className="notice">
              This older record predates detailed change tracking. Only information recorded at the time is
              shown.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.key}>
                    <td>{field.label}</td>
                    <td>{valueLabel(selected.before?.[field.key])}</td>
                    <td>{valueLabel(selected.after[field.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
