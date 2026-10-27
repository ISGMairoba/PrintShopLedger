import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Icon from '../Icon';
import { currency } from '../receipts.mjs';
import {
  activity,
  business,
  businesses,
  changePassword,
  currentMember,
  setMember,
  signIn,
  signOut,
  team,
  teamAction,
  type BusinessDetail,
  type BusinessRow,
  type ConsoleAction,
  type ConsoleMember,
  type TeamMember,
} from './console-api';

const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
const ago = (value: string | null) => {
  if (!value) return 'Never';
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
};
const kb = (bytes: number) =>
  bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const actionLabels: Record<string, string> = {
  'business.viewed': 'Opened business',
  'team.member_set': 'Changed team member',
  'team.member_added': 'Added team member',
  'team.password_reset': 'Reset team member password',
};

type View =
  | { page: 'businesses' }
  | { page: 'business'; id: string }
  | { page: 'activity' }
  | { page: 'team' };
const readView = (): View => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('business');
  const page = params.get('page');
  if (id) return { page: 'business', id };
  if (page === 'activity' || page === 'team') return { page };
  return { page: 'businesses' };
};
const writeView = (view: View) => {
  const params = new URLSearchParams();
  if (view.page === 'business') params.set('business', view.id);
  else if (view.page !== 'businesses') params.set('page', view.page);
  const query = params.toString();
  window.history.pushState(null, '', `/console${query ? `?${query}` : ''}`);
};

/** The PrintShopLedger developer console: every business, for the platform team only. */
export default function ConsoleApp() {
  const [me, setMe] = useState<ConsoleMember | null | undefined>(undefined);
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    document.title = 'PrintShopLedger console';
    void currentMember().then(setMe);
    const back = () => setView(readView());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const go = (next: View) => {
    writeView(next);
    setView(next);
    window.scrollTo(0, 0);
  };
  if (me === undefined) return <p className="console-loading">Loading the console…</p>;
  if (!me) return <ConsoleSignIn onSignedIn={setMe} />;
  return (
    <div className="console">
      <header className="console-header">
        <div>
          <strong>PrintShopLedger console</strong>
          <small>
            {me.name} · {me.role === 'owner' ? 'Owner' : 'Support'}
          </small>
        </div>
        <nav className="settings-tabs" aria-label="Console">
          {(
            [
              ['businesses', 'Businesses', 'customers'],
              ['activity', 'Activity log', 'history'],
              ['team', 'Team', 'users'],
            ] as const
          ).map(([page, label, icon]) => (
            <button
              key={page}
              type="button"
              className={
                view.page === page || (page === 'businesses' && view.page === 'business')
                  ? 'active'
                  : 'secondary'
              }
              onClick={() => go({ page } as View)}
            >
              <Icon name={icon} /> {label}
            </button>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await signOut();
              setMe(null);
            }}
          >
            <Icon name="close" /> Sign out
          </button>
        </nav>
      </header>
      <main className="console-main">
        {view.page === 'businesses' && <Businesses onOpen={(id) => go({ page: 'business', id })} />}
        {view.page === 'business' && <Business id={view.id} onBack={() => go({ page: 'businesses' })} />}
        {view.page === 'activity' && <Activity />}
        {view.page === 'team' && <Team me={me} />}
      </main>
    </div>
  );
}

function ConsoleSignIn({ onSignedIn }: { onSignedIn: (me: ConsoleMember) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      onSignedIn(await signIn(String(data.get('email')), String(data.get('password'))));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <section className="auth-card">
        <h1>PrintShopLedger console</h1>
        <p className="muted">
          For the PrintShopLedger team. Sign in with your console email, not a business account.
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <label>
              Console email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && <p role="alert">{error}</p>}
            <button type="submit">
              <Icon name="account" /> {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </fieldset>
        </form>
      </section>
    </main>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    load()
      .then((value) => live && setData(value))
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}

function Businesses({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error } = useLoad(businesses, []);
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () =>
      (data ?? []).filter((b) =>
        `${b.name} ${b.ownerEmail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [data, query],
  );
  const total = (key: keyof BusinessRow) => (data ?? []).reduce((n, b) => n + Number(b[key] ?? 0), 0);
  return (
    <>
      <section className="stats">
        <article>
          <span>Businesses</span>
          <strong>{data?.length ?? '…'}</strong>
          <small>{(data ?? []).filter((b) => b.events7 > 0).length} active in the last 7 days</small>
        </article>
        <article>
          <span>Jobs recorded</span>
          <strong>{data ? total('jobs').toLocaleString() : '…'}</strong>
          <small>{data ? total('customers').toLocaleString() : '…'} customers</small>
        </article>
        <article>
          <span>Sales, last 30 days</span>
          <strong>{data ? currency(total('sales30')) : '…'}</strong>
          <small>All businesses</small>
        </article>
      </section>
      <section className="panel">
        <div className="toolbar">
          <h2>Businesses</h2>
          <input
            type="search"
            aria-label="Search businesses"
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && (
          <div className="table-wrap">
            <table aria-label="Businesses">
              <thead>
                <tr>
                  <th>Business</th>
                  <th className="numeric">Staff</th>
                  <th className="numeric">Customers</th>
                  <th className="numeric">Jobs</th>
                  <th className="numeric">Sales (30 days)</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <button type="button" className="link-button" onClick={() => onOpen(b.id)}>
                        {b.name}
                      </button>
                      <small>{b.ownerEmail ?? 'No business account'}</small>
                    </td>
                    <td className="numeric">{b.staff}</td>
                    <td className="numeric">{b.customers}</td>
                    <td className="numeric">{b.jobs}</td>
                    <td className="numeric">{currency(b.sales30)}</td>
                    <td>
                      {ago(b.lastActivity)}
                      <small>{b.events7} changes in 7 days</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Business({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error } = useLoad(() => business(id), [id]);
  const log = useLoad(() => activity(id), [id]);
  if (error)
    return (
      <section className="panel">
        <p role="alert">{error}</p>
        <button type="button" className="secondary" onClick={onBack}>
          <Icon name="restore" /> Back to businesses
        </button>
      </section>
    );
  if (!data) return <p className="muted">Loading…</p>;
  return <BusinessView data={data} log={log.data ?? []} onBack={onBack} />;
}

function BusinessView({
  data,
  log,
  onBack,
}: {
  data: BusinessDetail;
  log: ConsoleAction[];
  onBack: () => void;
}) {
  const storage = Object.values(data.storageBytes).reduce((n, b) => n + b, 0);
  const peak = Math.max(1, ...data.daily.map((d) => d.events));
  const staff = data.staff.filter((s) => s.role !== 'developer');
  return (
    <>
      <section className="panel console-title">
        <button type="button" className="secondary" onClick={onBack}>
          <Icon name="restore" /> Businesses
        </button>
        <div>
          <h1>{data.name}</h1>
          <p className="muted">
            {data.ownerEmail ?? 'No business account'} · Joined {when(data.createdAt)} · Settings version{' '}
            {data.settingsVersion ?? '—'} ({when(data.settingsChangedAt)})
          </p>
        </div>
      </section>
      <section className="stats">
        <article>
          <span>Customers</span>
          <strong>{data.records.customers}</strong>
          <small>
            {data.records.jobs} jobs · {data.records.payments} payments
          </small>
        </article>
        <article>
          <span>Catalogue</span>
          <strong>{data.records.services}</strong>
          <small>
            {data.records.materials} stock items · {data.records.stockChanges} stock changes
          </small>
        </article>
        <article>
          <span>Stored in the cloud</span>
          <strong>{kb(storage)}</strong>
          <small>{data.records.events} recorded changes</small>
        </article>
        <article>
          <span>Staff</span>
          <strong>{staff.filter((s) => !s.archived).length}</strong>
          <small>{staff.filter((s) => s.archived).length} turned off</small>
        </article>
      </section>
      <section className="panel">
        <h2>Activity, last 30 days</h2>
        <p className="muted">Changes recorded per day (sales, payments, stock, settings…).</p>
        <div className="console-bars" role="img" aria-label="Changes recorded per day over the last 30 days">
          {data.daily.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.events} changes, ${currency(d.sales)} sales`}>
              <i style={{ height: `${Math.round((d.events / peak) * 100)}%` }} />
            </span>
          ))}
        </div>
        <small className="muted">
          {data.daily[0]?.day} to {data.daily.at(-1)?.day} · busiest day {peak} changes
        </small>
      </section>
      <section className="panel">
        <h2>Staff accounts</h2>
        <div className="table-wrap">
          <table aria-label="Staff accounts">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Last activity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.username}</td>
                  <td>{s.role === 'developer' ? 'Developer' : s.role[0].toUpperCase() + s.role.slice(1)}</td>
                  <td>{ago(s.lastActivity)}</td>
                  <td>{s.archived ? 'Turned off' : s.accessLevel === 0 ? 'No access' : 'Active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>Console activity for this business</h2>
        <ActivityTable rows={log} showBusiness={false} />
      </section>
    </>
  );
}

function ActivityTable({ rows, showBusiness = true }: { rows: ConsoleAction[]; showBusiness?: boolean }) {
  if (!rows.length) return <p className="muted">Nothing yet.</p>;
  return (
    <div className="table-wrap">
      <table aria-label="Console activity">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            {showBusiness && <th>Business</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{when(a.at)}</td>
              <td>{a.actorName}</td>
              <td>
                {actionLabels[a.action] ?? a.action}
                {a.reason && <small>Reason: {a.reason}</small>}
              </td>
              {showBusiness && <td>{a.business ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Activity() {
  const { data, error } = useLoad(() => activity(null), []);
  return (
    <section className="panel">
      <h2>Activity log</h2>
      <p className="muted">Everything done from the console, newest first.</p>
      {error && <p role="alert">{error}</p>}
      {data ? <ActivityTable rows={data} /> : !error && <p className="muted">Loading…</p>}
    </section>
  );
}

function Team({ me }: { me: ConsoleMember }) {
  const { data, error, reload } = useLoad(team, []);
  const [message, setMessage] = useState(''),
    [problem, setProblem] = useState(''),
    [busy, setBusy] = useState(false);
  const owner = me.role === 'owner';
  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setProblem('');
    setMessage('');
    try {
      await work();
      setMessage(done);
      reload();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>Console team</h2>
        <p className="muted">
          Owners can do everything, including managing the team. Support members can do everything except
          manage the team. Each person signs in with their own console email.
        </p>
        {error && <p role="alert">{error}</p>}
        {message && (
          <p role="status" className="notice notice-success">
            {message}
          </p>
        )}
        {problem && <p role="alert">{problem}</p>}
        {data && (
          <div className="table-wrap">
            <table aria-label="Console team">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  {owner && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((m: TeamMember) => (
                  <tr key={m.userId}>
                    <td>
                      {m.name}
                      <small>{m.email}</small>
                    </td>
                    <td>{m.role === 'owner' ? 'Owner' : 'Support'}</td>
                    <td>{m.disabled ? 'Turned off' : 'Active'}</td>
                    {owner && (
                      <td>
                        {m.userId !== me.userId && (
                          <div className="material-actions">
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () =>
                                    setMember({
                                      ...m,
                                      role: m.role === 'owner' ? 'support' : 'owner',
                                    }),
                                  `${m.name} is now ${m.role === 'owner' ? 'support' : 'an owner'}.`,
                                )
                              }
                            >
                              <Icon name="users" /> Make {m.role === 'owner' ? 'support' : 'owner'}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () => setMember({ ...m, disabled: !m.disabled }),
                                  `${m.name} ${m.disabled ? 'can sign in again' : 'can no longer sign in'}.`,
                                )
                              }
                            >
                              <Icon name={m.disabled ? 'restore' : 'archive'} />{' '}
                              {m.disabled ? 'Turn on' : 'Turn off'}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {owner && (
        <section className="panel">
          <h2>Add a team member</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              void act(
                () =>
                  teamAction({
                    action: 'add',
                    name: String(f.get('name')),
                    email: String(f.get('email')),
                    role: String(f.get('role')),
                    password: String(f.get('password')),
                  }).then(() => form.reset()),
                'Team member added. Give them their email and starting password; they can change it here.',
              );
            }}
          >
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Name
                  <input name="name" maxLength={80} required />
                </label>
                <label>
                  Console email
                  <input name="email" type="email" required />
                  <small>Not an email that signs in to a business.</small>
                </label>
                <label>
                  Role
                  <select name="role" defaultValue="support">
                    <option value="support">Support</option>
                    <option value="owner">Owner</option>
                  </select>
                </label>
                <label>
                  Starting password
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>
              <button type="submit">
                <Icon name="add" /> Add team member
              </button>
            </fieldset>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Your password</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void act(
              () => changePassword(String(f.get('password'))).then(() => form.reset()),
              'Your password is changed.',
            );
          }}
        >
          <fieldset disabled={busy}>
            <label>
              New password
              <input name="password" type="password" minLength={12} autoComplete="new-password" required />
            </label>
            <button type="submit">
              <Icon name="save" /> Change password
            </button>
          </fieldset>
        </form>
      </section>
    </>
  );
}
