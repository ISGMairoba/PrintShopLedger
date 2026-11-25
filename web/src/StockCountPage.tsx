import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { useWords } from './Words';
import { currency as formatNaira } from './receipts.mjs';
import { defaultStockCount } from './production-materials.mjs';
import { canFinish, countMaterials, countReview, shelfOf, shelves as allShelves } from './stock-count.mjs';
import type { Ledger, StockCount, StockCountLine } from './types';

type Settings = ReturnType<typeof defaultStockCount>;
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const NO_SHELF = '';
const shelfLabel = (s: string) => s || 'No shelf';
const today = () =>
  new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Stock → Count (owner, 26 Nov): count all materials, shelf by shelf or picked ones. The count is
 * saved as it is typed, so it can be continued later or on another device; an Admin reviews the
 * differences and finishes it, which sets each counted material (stock-count.mjs).
 */
export default function StockCountPage({
  ledger,
  level,
  actor,
  settings,
  busy,
  canSave,
  onSave,
}: {
  ledger: Ledger;
  level: number;
  actor: { id: string; label: string };
  settings?: Partial<Settings>;
  busy: boolean;
  canSave: boolean;
  onSave: (kind: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const { w } = useWords();
  const s = { ...defaultStockCount(), ...settings };
  const counts = [...(ledger.stockCounts ?? [])].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const open = counts.find((c) => c.id === openId) ?? null;
  return (
    <section className="panel stock-count">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {open ? (
        <CountSheet
          key={open.id}
          ledger={ledger}
          count={open}
          level={level}
          actor={actor}
          settings={s}
          busy={busy || !canSave}
          onSave={onSave}
          onError={setError}
          onDone={(message) => {
            setNotice(message);
            setOpenId(null);
          }}
          onBack={() => setOpenId(null)}
        />
      ) : starting ? (
        <NewCount
          ledger={ledger}
          busy={busy || !canSave}
          onCancel={() => setStarting(false)}
          onStart={async (name, scope, materialIds) => {
            setError('');
            const id = crypto.randomUUID();
            try {
              await onSave('count.saved', {
                id,
                baseVersion: 0,
                name,
                scope,
                lines: materialIds.map((materialId) => ({ materialId, counted: null })),
              });
              setStarting(false);
              setOpenId(id);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not start the count.');
            }
          }}
        />
      ) : (
        <>
          <div className="section-heading">
            <h2>{w('Stock counts')}</h2>
            <button type="button" disabled={busy || !canSave} onClick={() => setStarting(true)}>
              <Icon name="add" /> New count
            </button>
          </div>
          {!canSave && <p className="muted">Counts are saved online: connect to start or finish one.</p>}
          {counts.length === 0 ? (
            <p className="muted">
              No counts yet. A count goes through all {w('materials')}, chosen shelves or picked ones; staff
              type what they see, and an Admin reviews the differences and finishes it.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Count</th>
                    <th>Status</th>
                    <th>Counted</th>
                    <th>Started</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => {
                    const done = c.lines.filter((l) => l.counted !== null).length;
                    const diffs = c.lines.filter((l) => (l.difference ?? 0) !== 0).length;
                    return (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                          {c.status === 'finished' && (
                            <small>
                              {diffs} {diffs === 1 ? 'difference' : 'differences'}
                              {c.flagged ? ' · big differences' : ''}
                            </small>
                          )}
                        </td>
                        <td>
                          {c.status === 'open'
                            ? 'In progress'
                            : c.status === 'finished'
                              ? 'Finished'
                              : 'Cancelled'}
                          {c.finishedByLabel && <small>by {c.finishedByLabel}</small>}
                        </td>
                        <td>
                          {done} of {c.lines.length}
                        </td>
                        <td>
                          {new Date(c.createdAt).toLocaleDateString()}
                          <small>{c.createdByLabel}</small>
                        </td>
                        <td>
                          <button type="button" className="secondary" onClick={() => setOpenId(c.id)}>
                            {c.status === 'open' ? 'Continue' : 'View'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NewCount({
  ledger,
  busy,
  onCancel,
  onStart,
}: {
  ledger: Ledger;
  busy: boolean;
  onCancel: () => void;
  onStart: (name: string, scope: StockCount['scope'], materialIds: string[]) => Promise<void>;
}) {
  const { w } = useWords();
  const [name, setName] = useState(`Count, ${today()}`);
  const [kind, setKind] = useState<StockCount['scope']['kind']>('all');
  const known = allShelves(ledger);
  const hasUnshelved = ledger.materials.some((m) => !m.archived && !shelfOf(ledger, m.id));
  const [chosenShelves, setChosenShelves] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const scope: StockCount['scope'] =
    kind === 'shelf'
      ? { kind, shelves: chosenShelves }
      : kind === 'picked'
        ? { kind, materialIds: picked }
        : { kind };
  const materials = countMaterials(ledger, scope);
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onStart(
          name.trim(),
          scope,
          materials.map((m) => m.id),
        );
      }}
    >
      <h2>New count</h2>
      <label>
        Name
        <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        What to count
        <select
          aria-label="What to count"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="all">All {w('materials')}</option>
          <option value="shelf">Chosen shelves or areas</option>
          <option value="picked">Picked {w('materials')}</option>
        </select>
      </label>
      {kind === 'shelf' && (
        <fieldset className="check-list">
          <legend>Shelves</legend>
          {known.length === 0 && !hasUnshelved && <p className="muted">No shelves set yet.</p>}
          {known.length === 0 && (
            <p className="muted">
              Set where each {w('material')} is kept on Materials → Edit (Shelf or area).
            </p>
          )}
          {[...known, ...(hasUnshelved ? [NO_SHELF] : [])].map((shelf) => (
            <label key={shelf || 'none'} className="check-label">
              <input
                type="checkbox"
                checked={chosenShelves.includes(shelf)}
                onChange={() => setChosenShelves((list) => toggle(list, shelf))}
              />
              {shelfLabel(shelf)}
            </label>
          ))}
        </fieldset>
      )}
      {kind === 'picked' && (
        <fieldset className="check-list">
          <legend>{w('Materials')}</legend>
          {ledger.materials
            .filter((m) => !m.archived)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((m) => (
              <label key={m.id} className="check-label">
                <input
                  type="checkbox"
                  checked={picked.includes(m.id)}
                  onChange={() => setPicked((list) => toggle(list, m.id))}
                />
                {m.name}
              </label>
            ))}
        </fieldset>
      )}
      <p className="muted">
        {materials.length} {materials.length === 1 ? w('material') : w('materials')} to count.
      </p>
      <div className="material-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !materials.length || !name.trim()}>
          Start counting
        </button>
      </div>
    </form>
  );
}

function CountSheet({
  ledger,
  count,
  level,
  actor,
  settings,
  busy,
  onSave,
  onError,
  onDone,
  onBack,
}: {
  ledger: Ledger;
  count: StockCount;
  level: number;
  actor: { id: string; label: string };
  settings: Settings;
  busy: boolean;
  onSave: (kind: string, data: Record<string, unknown>) => Promise<void>;
  onError: (message: string) => void;
  onDone: (message: string) => void;
  onBack: () => void;
}) {
  const { w } = useWords();
  const editable = count.status === 'open';
  const [lines, setLines] = useState<StockCountLine[]>(count.lines);
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(count.lines.map((l) => [l.materialId, l.counted === null ? '' : String(l.counted)])),
  );
  const [reviewing, setReviewing] = useState(!editable);
  const [saving, setSaving] = useState(false);
  const blind = settings.blind && level < 2;
  // Saved as it is typed: a short pause after the last change, and on leaving.
  const dirty = useRef(false);
  const latest = useRef(lines);
  latest.current = lines;
  const version = useRef(count.version);
  version.current = count.version;
  async function save() {
    if (!dirty.current || !editable) return true;
    dirty.current = false;
    setSaving(true);
    try {
      await onSave('count.saved', {
        id: count.id,
        baseVersion: version.current,
        name: count.name,
        scope: count.scope,
        lines: latest.current,
      });
      return true;
    } catch (cause) {
      dirty.current = true;
      onError(cause instanceof Error ? cause.message : 'Could not save the count.');
      return false;
    } finally {
      setSaving(false);
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const enter = (materialId: string, text: string) => {
    setTyped((t) => ({ ...t, [materialId]: text }));
    const n = Number(text);
    const counted = text.trim() === '' || !(n >= 0) ? null : Math.round(n * 1000) / 1000;
    setLines((list) =>
      list.map((l) =>
        l.materialId === materialId
          ? counted === null
            ? { materialId, counted: null, ...(l.note ? { note: l.note } : {}) }
            : {
                ...l,
                counted,
                countedAt: new Date().toISOString(),
                countedBy: actor.id,
                countedByLabel: actor.label,
              }
          : l,
      ),
    );
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  };
  const review = useMemo(
    () => countReview(ledger, { ...count, lines }, settings),
    [ledger, count, lines, settings],
  );
  const groups = useMemo(() => {
    const out = new Map<string, typeof review.lines>();
    for (const line of review.lines) {
      const shelf = shelfOf(ledger, line.materialId);
      out.set(shelf, [...(out.get(shelf) ?? []), line]);
    }
    return [...out.entries()];
  }, [review, ledger]);
  const finishedLines = count.status === 'finished' ? count.lines : null;
  async function finish() {
    if (!(await save())) return;
    const stockIds = Object.fromEntries(
      review.lines.filter((l) => !l.uncounted).map((l) => [l.materialId, crypto.randomUUID()]),
    );
    try {
      await onSave('count.finished', { id: count.id, baseVersion: count.version, stockIds, settings });
      onDone(`${count.name} finished: ${review.differences} stock levels changed.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not finish the count.');
    }
  }
  async function cancel() {
    try {
      await onSave('count.cancelled', { id: count.id, baseVersion: count.version });
      onDone(`${count.name} cancelled. Nothing changed.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not cancel the count.');
    }
  }
  const csv = () => {
    const rows = [
      ['Shelf', 'Material', 'Unit', 'Expected', 'Counted', 'Difference', 'Value (NGN)', 'Note'],
      ...review.lines.map((l) => {
        const f = finishedLines?.find((x) => x.materialId === l.materialId);
        return [
          shelfOf(ledger, l.materialId),
          l.material?.name ?? '',
          l.material?.measurementUnit ?? '',
          String(f?.expected ?? l.expected ?? ''),
          l.counted === null ? '' : String(l.counted),
          String(f?.difference ?? l.difference ?? ''),
          f?.value !== undefined
            ? String(f.value / 100)
            : l.value !== null && l.value !== undefined
              ? String(l.value / 100)
              : '',
          l.note ?? '',
        ];
      }),
    ];
    const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${count.name.replace(/[^\w-]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="count-sheet">
      <div className="section-heading">
        <h2>{count.name}</h2>
        <div className="material-actions">
          <button type="button" className="secondary" onClick={() => void save().then(onBack)}>
            Back to counts
          </button>
          <button type="button" className="secondary" onClick={() => window.print()}>
            <Icon name="services" /> Print sheet
          </button>
          <button type="button" className="secondary" onClick={csv}>
            <Icon name="export" /> Download CSV
          </button>
        </div>
      </div>
      <p className="muted">
        {count.status === 'open'
          ? `${review.counted} of ${review.lines.length} counted${saving ? ' · saving…' : ''}. Type what you see; selling can go on, because each row is compared with the stock when it was counted.`
          : count.status === 'finished'
            ? `Finished by ${count.finishedByLabel} on ${new Date(count.finishedAt ?? '').toLocaleString()}.`
            : `Cancelled on ${new Date(count.cancelledAt ?? '').toLocaleString()}. Nothing changed.`}
      </p>
      {editable && level >= 2 && (
        <div className="settings-tabs" role="group" aria-label="Count view">
          <button
            type="button"
            className={reviewing ? 'secondary' : 'active'}
            aria-pressed={!reviewing}
            onClick={() => setReviewing(false)}
          >
            Count
          </button>
          <button
            type="button"
            className={reviewing ? 'active' : 'secondary'}
            aria-pressed={reviewing}
            onClick={() => setReviewing(true)}
          >
            Review differences
          </button>
        </div>
      )}
      {groups.map(([shelf, rows]) => (
        <div key={shelf || 'none'} className="table-wrap">
          <h3>{shelfLabel(shelf)}</h3>
          <table>
            <thead>
              <tr>
                <th>{w('Material')}</th>
                {!blind && <th>Expected</th>}
                <th>Counted</th>
                {reviewing && <th>Difference</th>}
                {reviewing && <th>Value</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const f = finishedLines?.find((x) => x.materialId === l.materialId);
                const expected = f?.expected ?? (l.uncounted ? l.material?.available : l.expected);
                const diff = f?.difference ?? l.difference;
                const value = f?.value ?? l.value;
                return (
                  <tr key={l.materialId} className={l.big && reviewing ? 'row-warning' : undefined}>
                    <td>
                      <strong>{l.material?.name ?? 'Removed material'}</strong>
                      <small>{l.material?.measurementUnit}</small>
                    </td>
                    {!blind && <td>{expected === undefined ? '—' : qty(expected)}</td>}
                    <td>
                      {editable && !reviewing ? (
                        <input
                          aria-label={`${l.material?.name ?? 'Material'} counted`}
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={typed[l.materialId] ?? ''}
                          disabled={busy}
                          onChange={(e) => enter(l.materialId, e.target.value)}
                        />
                      ) : l.counted === null ? (
                        'Not counted'
                      ) : (
                        qty(l.counted)
                      )}
                    </td>
                    {reviewing && <td>{diff === undefined ? '—' : `${diff > 0 ? '+' : ''}${qty(diff)}`}</td>}
                    {reviewing && (
                      <td>
                        {value === null || value === undefined ? '—' : formatNaira(value)}
                        {l.big && <small>Big difference</small>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {editable && reviewing && (
        <>
          <p>
            {review.counted} counted, {review.uncounted} not counted (left as they are). {review.differences}{' '}
            {review.differences === 1 ? 'difference' : 'differences'}, worth {formatNaira(review.value)}.
            {review.big ? ' Some differences are big: check them before finishing.' : ''}
          </p>
          {!canFinish(review, level, settings) && (
            <p className="notice" role="status">
              {level < 2
                ? 'An Admin or higher finishes the count.'
                : 'Big differences: someone of a higher rank must finish this count (Business Settings → Jobs & payments).'}
            </p>
          )}
          <div className="material-actions">
            {(level >= 2 || count.createdBy === actor.id) && (
              <button
                type="button"
                className="secondary danger-text"
                disabled={busy}
                onClick={() => void cancel()}
              >
                Cancel count
              </button>
            )}
            <button
              type="button"
              disabled={busy || !review.counted || !canFinish(review, level, settings)}
              onClick={() => void finish()}
            >
              Finish count
            </button>
          </div>
        </>
      )}
      {editable && !reviewing && level < 2 && (
        <p className="muted">Your counts are saved as you type. An Admin reviews and finishes the count.</p>
      )}
    </div>
  );
}
