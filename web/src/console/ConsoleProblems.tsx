import { useEffect, useState } from 'react';
import Icon from '../Icon';
import ResponsiveTable from '../ResponsiveTable';
import { problemAction, problems as loadProblems, type BusinessRow, type Problem } from './console-api';
import { Badge } from './ConsoleSubscription';

const ago = (value: string) => {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
};

/** App errors and failed syncs reported by devices, across businesses or for one. */
export default function ConsoleProblems({
  shopId = null,
  businesses = [],
  onChanged,
}: {
  shopId?: string | null;
  businesses?: BusinessRow[];
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(true),
    [business, setBusiness] = useState<string>(shopId ?? ''),
    [list, setList] = useState<Problem[] | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState(''),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setList(null);
    loadProblems(business || null, open)
      .then((p) => live && setList(p))
      .catch((cause) => live && setProblem(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      live = false;
    };
  }, [business, open, tick]);
  async function act(p: Problem, action: 'resolve' | 'reopen') {
    setBusy(true);
    setMessage('');
    setProblem('');
    try {
      await problemAction(p.id, action);
      setMessage(
        action === 'resolve' ? 'Marked as fixed. It opens again if it happens again.' : 'Opened again.',
      );
      setTick((n) => n + 1);
      onChanged?.();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="toolbar">
        <h2>Problems</h2>
        <div className="console-filters">
          {!shopId && (
            <select aria-label="Business" value={business} onChange={(e) => setBusiness(e.target.value)}>
              <option value="">All businesses</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <div className="settings-tabs" role="tablist" aria-label="Which problems">
            {(
              [
                [true, 'Open'],
                [false, 'All'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={open === value}
                className={open === value ? 'active' : 'secondary'}
                onClick={() => setOpen(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted">
        App errors and failed syncs that devices reported, sent with their next sync. The same problem on the
        same device shows once, with how many times it happened.
      </p>
      {message && (
        <p role="status" className="notice notice-success">
          {message}
        </p>
      )}
      {problem && <p role="alert">{problem}</p>}
      {!list && !problem && <p className="muted">Loading…</p>}
      {list && !list.length && (
        <p className="console-empty">
          <Icon name="complete" /> {open ? 'No open problems.' : 'No problems reported yet.'}
        </p>
      )}
      {list && list.length > 0 && (
        <ResponsiveTable
          columns={[
            { index: 0, label: 'Problem', details: [1, 2] },
            { index: 3, label: 'Last seen' },
            { index: 4, label: 'Actions', actions: true },
          ]}
        >
          <table aria-label="Problems">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Business</th>
                <th>Device</th>
                <th>Last seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="console-problem">
                      <Badge tone={p.resolvedAt ? 'muted' : p.kind === 'sync' ? 'warn' : 'bad'}>
                        {p.resolvedAt ? 'Fixed' : p.kind === 'sync' ? 'Sync' : 'Error'}
                      </Badge>
                      {p.message}
                    </span>
                    <details className="console-details">
                      <summary>Details</summary>
                      <dl>
                        {p.detail?.path && (
                          <>
                            <dt>Page</dt>
                            <dd>{p.detail.path}</dd>
                          </>
                        )}
                        <dt>App version</dt>
                        <dd>{p.appVersion || p.detail?.appVersion || '—'}</dd>
                        {p.detail?.pending !== undefined && (
                          <>
                            <dt>Unsent work</dt>
                            <dd>{p.detail.pending}</dd>
                          </>
                        )}
                        <dt>First seen</dt>
                        <dd>{ago(p.firstAt)}</dd>
                        {p.resolvedAt && (
                          <>
                            <dt>Fixed</dt>
                            <dd>
                              {ago(p.resolvedAt)}
                              {p.resolvedBy ? ` by ${p.resolvedBy}` : ''}
                            </dd>
                          </>
                        )}
                      </dl>
                      {p.detail?.stack && <pre>{p.detail.stack}</pre>}
                    </details>
                  </td>
                  <td>{p.business}</td>
                  <td>
                    {p.device || 'Unknown device'}
                    <small>{p.userLabel || 'No staff signed in'}</small>
                  </td>
                  <td>
                    {ago(p.lastAt)}
                    <small>{p.count === 1 ? 'Once' : `${p.count.toLocaleString()} times`}</small>
                  </td>
                  <td>
                    <div className="material-actions">
                      {p.resolvedAt ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => act(p, 'reopen')}
                        >
                          <Icon name="restore" /> Open again
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => act(p, 'resolve')}
                        >
                          <Icon name="complete" /> Mark fixed
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      )}
    </section>
  );
}
