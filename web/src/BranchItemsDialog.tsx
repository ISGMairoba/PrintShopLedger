import { useMemo, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import type { Service } from './types';

/**
 * Business Settings → Branches → Choose items: the items a branch that sells chosen items sells,
 * grouped by category with "All" per category. Saved straight to the server (General Manager and
 * Developer).
 */
export default function BranchItemsDialog({
  branchId,
  branchName,
  services,
  online,
  onSave,
  onClose,
}: {
  branchId: string;
  branchName: string;
  services: Service[];
  online: boolean;
  onSave: (branchId: string, serviceIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const items = useMemo(
    () =>
      services
        .filter((s) => !s.archived && !s.private)
        .sort((a, b) => a.description.localeCompare(b.description)),
    [services],
  );
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(items.filter((s) => s.soldAt?.includes(branchId)).map((s) => s.id)),
  );
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Service[]>();
    for (const s of items) {
      if (q && !`${s.description} ${s.code ?? ''} ${s.category ?? ''}`.toLowerCase().includes(q)) continue;
      const key = s.category?.trim() || 'No category';
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === 'No category' ? 1 : b === 'No category' ? -1 : a.localeCompare(b),
    );
  }, [items, query]);
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids)
      if (on) next.add(id);
      else next.delete(id);
    setPicked(next);
  };
  return (
    <Modal
      title={`Items sold at ${branchName || 'this branch'}`}
      busy={busy}
      wide
      onClose={onClose}
      footer={
        <div className="material-actions">
          <span className="muted">
            {picked.size} of {items.length} chosen
          </span>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !online}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onSave(branchId, [...picked]);
                onClose();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="save" /> Save items
          </button>
        </div>
      }
    >
      <p>
        Staff at this branch see and sell only the items ticked here, and its Materials page shows only the
        materials those items use. Items an Admin adds at the branch are sold there too.
        {!online && ' Connect to the internet to save.'}
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="material-actions">
        <input
          type="search"
          aria-label="Search items"
          placeholder="Search items"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          onClick={() =>
            toggle(
              items.map((s) => s.id),
              true,
            )
          }
        >
          Select all
        </button>
        <button type="button" className="secondary" onClick={() => setPicked(new Set())}>
          Clear
        </button>
      </div>
      <div className="branch-items">
        {groups.map(([category, list]) => {
          const all = list.every((s) => picked.has(s.id));
          return (
            <fieldset key={category} className="branch-items-group">
              <legend>
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={`All of ${category}`}
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = !all && list.some((s) => picked.has(s.id));
                    }}
                    onChange={(e) =>
                      toggle(
                        list.map((s) => s.id),
                        e.target.checked,
                      )
                    }
                  />
                  <strong>{category}</strong> <span className="muted">({list.length})</span>
                </label>
              </legend>
              {list.map((s) => (
                <label key={s.id} className="check-label">
                  <input
                    type="checkbox"
                    checked={picked.has(s.id)}
                    onChange={(e) => toggle([s.id], e.target.checked)}
                  />
                  {s.description}
                  {s.code ? <small className="muted"> {s.code}</small> : null}
                </label>
              ))}
            </fieldset>
          );
        })}
        {!groups.length && <p className="muted">No items match.</p>}
      </div>
    </Modal>
  );
}
