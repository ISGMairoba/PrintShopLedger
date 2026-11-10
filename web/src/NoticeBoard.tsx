import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { supabase } from './cloud';

/** A notice as the business sends it (get_notices). */
export type Notice = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  minLevel: number;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  updatedByLabel: string | null;
  updatedAt: string;
  readAt: string | null;
  /** Who has read it (Managers and above only). */
  readers: { name: string; at: string }[] | null;
};
const audiences: [number, string][] = [
  [1, 'Everyone'],
  [2, 'Admins and above'],
  [3, 'Managers and above'],
];
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const failure = (error: { message?: string } | null) =>
  error ? Error(error.message || 'Could not reach the business.') : null;

/** Notices of this business, fetched online; refreshed every 5 minutes and when the app is reopened. */
export function useNotices(shopId: string | undefined, enabled: boolean) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!supabase || !shopId || !enabled) return;
    const { data, error } = await supabase.rpc('get_notices', { p_shop: shopId });
    if (error) setError(error.message);
    else {
      setError('');
      setNotices((data as Notice[]) ?? []);
    }
  }, [shopId, enabled]);
  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    const visible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, enabled]);
  return { notices, unread: notices.filter((n) => !n.readAt).length, error, refresh };
}

/** The notice board: read notices; Managers and above post, pin, edit and take them down. */
export default function NoticeBoard({
  shopId,
  canPost,
  notices,
  online,
  onChanged,
  onClose,
}: {
  shopId: string;
  canPost: boolean;
  notices: Notice[];
  online: boolean;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<Partial<Notice> | null>(null),
    [readersOf, setReadersOf] = useState(''),
    [removing, setRemoving] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const markRead = (n: Notice) =>
    run(async () => {
      const { error } = await supabase!.rpc('read_notice', { p_shop: shopId, p_id: n.id });
      if (error) throw failure(error);
    });
  return (
    <Modal title="Notice board" wide busy={busy} onClose={onClose}>
      {!online && (
        <p className="notice notice-warning">You're offline. Notices update when you're back online.</p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {canPost && !editing && (
        <p>
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => setEditing({ minLevel: 1, pinned: false })}
          >
            <Icon name="add" /> Post a notice
          </button>
        </p>
      )}
      {editing && (
        <form
          className="notice-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void run(async () => {
              const { error } = await supabase!.rpc('save_notice', {
                p_shop: shopId,
                p_id: editing.id ?? crypto.randomUUID(),
                p_title: String(form.get('title') ?? ''),
                p_body: String(form.get('body') ?? ''),
                p_pinned: form.get('pinned') === 'on',
                p_min_level: Number(form.get('audience') ?? 1),
              });
              if (error) throw failure(error);
              setEditing(null);
            });
          }}
        >
          <label>
            Title
            <input name="title" required maxLength={120} defaultValue={editing.title ?? ''} />
          </label>
          <label>
            Message
            <textarea name="body" rows={5} maxLength={4000} defaultValue={editing.body ?? ''} />
          </label>
          <div className="form-grid">
            <label>
              Who sees it
              <select name="audience" defaultValue={String(editing.minLevel ?? 1)}>
                {audiences.map(([level, name]) => (
                  <option key={level} value={level}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input type="checkbox" name="pinned" defaultChecked={!!editing.pinned} /> Pin to the top
            </label>
          </div>
          <div className="dialog-action-buttons">
            <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(null)}>
              <Icon name="close" /> Cancel
            </button>
            <button type="submit" disabled={busy || !online}>
              <Icon name="save" /> {editing.id ? 'Save changes' : 'Post notice'}
            </button>
          </div>
        </form>
      )}
      {!notices.length ? (
        <p className="empty">No notices yet.</p>
      ) : (
        <ul className="notice-list">
          {notices.map((n) => (
            <li key={n.id} className={n.readAt ? 'notice-read' : 'notice-unread'}>
              <h3>
                {n.pinned && <span className="badge">Pinned</span>} {n.title}
                {!n.readAt && <span className="badge badge-new">New</span>}
              </h3>
              <small className="muted">
                {n.createdByLabel} · {when(n.createdAt)}
                {n.updatedByLabel && n.updatedAt !== n.createdAt ? ` · edited by ${n.updatedByLabel}` : ''}
                {n.minLevel > 1 ? ` · ${audiences.find(([l]) => l === n.minLevel)?.[1] ?? ''}` : ''}
              </small>
              {n.body && <p className="notice-body">{n.body}</p>}
              <div className="notice-actions">
                {!n.readAt ? (
                  <button type="button" disabled={busy || !online} onClick={() => void markRead(n)}>
                    <Icon name="complete" /> Got it
                  </button>
                ) : (
                  <small className="muted">Read {when(n.readAt)}</small>
                )}
                {n.readers && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setReadersOf(readersOf === n.id ? '' : n.id)}
                  >
                    Read by {n.readers.length}
                  </button>
                )}
                {canPost && (
                  <>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || !online}
                      onClick={() => setEditing(n)}
                    >
                      <Icon name="edit" /> Edit
                    </button>
                    <button
                      type="button"
                      className="text-button danger-text"
                      disabled={busy || !online}
                      onClick={() => {
                        if (removing !== n.id) return setRemoving(n.id);
                        setRemoving('');
                        void run(async () => {
                          const { error } = await supabase!.rpc('archive_notice', {
                            p_shop: shopId,
                            p_id: n.id,
                          });
                          if (error) throw failure(error);
                        });
                      }}
                    >
                      <Icon name="archive" /> {removing === n.id ? 'Yes, take it down' : 'Take down'}
                    </button>
                  </>
                )}
              </div>
              {readersOf === n.id && n.readers && (
                <ul className="notice-readers">
                  {n.readers.length ? (
                    n.readers.map((r) => (
                      <li key={r.name + r.at}>
                        {r.name} · {when(r.at)}
                      </li>
                    ))
                  ) : (
                    <li className="muted">Nobody yet.</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
