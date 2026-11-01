import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Icon from '../Icon';
import ResponsiveTable from '../ResponsiveTable';
import './console.css';
import BusinessSettingsPage from '../BusinessSettingsPage';
import { BusinessOptionsContext } from '../BusinessOptionsContext';
import { TermsProvider } from '../Words';
import { validateBranding } from '../business-branding.mjs';
import type { Branding } from '../useBusinessBranding';
import { currency } from '../receipts.mjs';
import {
  activity,
  business,
  businesses,
  businessBackup,
  changePassword,
  currentMember,
  setMember,
  signIn,
  signOut,
  team,
  teamAction,
  businessSettings,
  saveBusinessSettings,
  saveStaff,
  staffAction,
  type StaffRow,
  type DeviceRow,
  devices,
  deviceAction,
  type BusinessDetail,
  type BusinessRow,
  type ConsoleAction,
  type ConsoleMember,
  type TeamMember,
} from './console-api';
import ConsoleProblems from './ConsoleProblems';
import { ConsoleUsage } from './ConsoleUsage';
import { Badge, ConsolePlans, ConsoleSubscription, StateBadge } from './ConsoleSubscription';

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
  'business.backup': 'Downloaded a backup',
  'trial.saved': 'Changed the free trial',
  'receipt_issuer.saved': 'Changed the receipt details',
  'usage_weights.saved': 'Changed the token values',
  'problem.resolve': 'Marked a problem fixed',
  'problem.reopen': 'Opened a problem again',
  'team.member_set': 'Changed team member',
  'team.member_added': 'Added team member',
  'team.password_reset': 'Reset team member password',
  'settings.saved': 'Saved business settings',
  'staff.created': 'Added staff',
  'staff.edit': 'Changed staff',
  'staff.grant': 'Gave staff access',
  'staff.revoke': 'Removed staff access',
  'staff.archive': 'Archived staff',
  'staff.restore': 'Restored staff',
  'staff.password_reset': 'Set staff password',
  'device.sign-out': 'Asked a device to sign out',
  'device.cancel-sign-out': 'Cancelled a device sign-out',
  'device.forget': 'Removed a device from the list',
  'plan.saved': 'Saved a plan',
  'subscription.saved': 'Changed the subscription',
  'subscription.payment': 'Recorded a payment',
};

type View =
  | { page: 'businesses' }
  | { page: 'business'; id: string }
  | { page: 'plans' }
  | { page: 'problems' }
  | { page: 'activity' }
  | { page: 'team' };
const readView = (): View => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('business');
  const page = params.get('page');
  if (id) return { page: 'business', id };
  if (page === 'activity' || page === 'team' || page === 'plans' || page === 'problems') return { page };
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
        <div className="console-brand">
          <span className="console-mark" aria-hidden="true">
            P
          </span>
          <span>
            <strong>PrintShopLedger</strong>
            <small>Developer console</small>
          </span>
        </div>
        <nav className="console-nav" aria-label="Console">
          {(
            [
              ['businesses', 'Businesses', 'customers'],
              ['problems', 'Problems', 'audit'],
              ['plans', 'Plans', 'payments'],
              ['activity', 'Activity log', 'history'],
              ['team', 'Team', 'users'],
            ] as const
          ).map(([page, label, icon]) => (
            <button
              key={page}
              type="button"
              aria-current={
                view.page === page || (page === 'businesses' && view.page === 'business') ? 'page' : undefined
              }
              onClick={() => go({ page } as View)}
            >
              <Icon name={icon} /> {label}
            </button>
          ))}
        </nav>
        <div className="console-user">
          <span>
            {me.name}
            <small>{me.role === 'owner' ? 'Owner' : 'Support'}</small>
          </span>
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
        </div>
      </header>
      <main className="console-main">
        {view.page === 'businesses' && <Businesses onOpen={(id) => go({ page: 'business', id })} />}
        {view.page === 'business' && <Business id={view.id} onBack={() => go({ page: 'businesses' })} />}
        {view.page === 'plans' && <ConsolePlans />}
        {view.page === 'problems' && <AllProblems />}
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
      <section className="auth-card console-signin">
        <span className="console-mark" aria-hidden="true">
          P
        </span>
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
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && (
          <ResponsiveTable
            columns={[
              { index: 0, label: 'Business', details: [1, 2, 3, 4] },
              { index: 5, label: 'Sales (30 days)', details: [6, 7] },
            ]}
          >
            <table aria-label="Businesses">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Subscription</th>
                  <th className="numeric">Staff</th>
                  <th className="numeric">Customers</th>
                  <th className="numeric">Jobs</th>
                  <th className="numeric">Sales (30 days)</th>
                  <th className="numeric">Tokens (30 days)</th>
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
                      {!!b.problems && (
                        <small>
                          <Badge tone="bad">
                            {b.problems} open {b.problems === 1 ? 'problem' : 'problems'}
                          </Badge>
                        </small>
                      )}
                    </td>
                    <td>
                      <StateBadge state={b.subscription ?? 'none'} />
                      <small>
                        {b.plan ?? 'No plan'}
                        {b.expiresAt ? ` · until ${when(b.expiresAt).split(',')[0]}` : ''}
                      </small>
                    </td>
                    <td className="numeric">{b.staff}</td>
                    <td className="numeric">{b.customers}</td>
                    <td className="numeric">{b.jobs}</td>
                    <td className="numeric">{currency(b.sales30)}</td>
                    <td className="numeric">{(b.tokens30 ?? 0).toLocaleString('en-NG')}</td>
                    <td>
                      {ago(b.lastActivity)}
                      <small>
                        {b.events7} changes in 7 days
                        {b.devices7 !== undefined ? ` · ${b.devices7} devices` : ''}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </section>
    </>
  );
}

function Business({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload } = useLoad(() => business(id), [id]);
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
  return (
    <BusinessView
      data={data}
      log={log.data ?? []}
      onBack={onBack}
      onChanged={() => {
        reload();
        log.reload();
      }}
    />
  );
}

function BusinessView({
  data,
  log,
  onBack,
  onChanged,
}: {
  data: BusinessDetail;
  log: ConsoleAction[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<
    'overview' | 'settings' | 'staff' | 'devices' | 'subscription' | 'usage' | 'problems'
  >('overview');
  const storage = Object.values(data.storageBytes).reduce((n, b) => n + b, 0);
  const peak = Math.max(1, ...data.daily.map((d) => d.events));
  const staff = data.staff.filter((s) => s.role !== 'developer');
  return (
    <>
      <section className="console-title">
        <button type="button" className="link-button console-back" onClick={onBack}>
          ← All businesses
        </button>
        <div className="console-title-row">
          <h1>{data.name}</h1>
          <BackupButton shopId={data.id} name={data.name} onDone={onChanged} />
        </div>
        <p className="muted">
          {data.ownerEmail ?? 'No business account'} · Joined {when(data.createdAt)} · Settings version{' '}
          {data.settingsVersion ?? '—'} ({when(data.settingsChangedAt)})
        </p>
      </section>
      <div className="settings-tabs" role="tablist" aria-label="Business sections">
        {(
          [
            ['overview', 'Overview', 'dashboard'],
            ['settings', 'Business settings', 'settings'],
            ['staff', 'Staff & access', 'users'],
            ['devices', 'Devices', 'drawer'],
            ['subscription', 'Subscription', 'payments'],
            ['usage', 'Usage', 'reports'],
            ['problems', 'Problems', 'audit'],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : 'secondary'}
            onClick={() => setTab(key)}
          >
            <Icon name={icon} /> {label}
          </button>
        ))}
      </div>
      {tab === 'settings' && <ConsoleSettings shopId={data.id} onSaved={onChanged} />}
      {tab === 'staff' && <ConsoleStaff data={data} onChanged={onChanged} />}
      {tab === 'devices' && <ConsoleDevices shopId={data.id} onChanged={onChanged} />}
      {tab === 'subscription' && (
        <ConsoleSubscription
          shopId={data.id}
          business={{ name: data.name, ownerEmail: data.ownerEmail }}
          onChanged={onChanged}
        />
      )}
      {tab === 'usage' && <ConsoleUsage shopId={data.id} />}
      {tab === 'problems' && <ConsoleProblems shopId={data.id} onChanged={onChanged} />}
      {tab === 'overview' && (
        <>
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
            <div
              className="console-bars"
              role="img"
              aria-label="Changes recorded per day over the last 30 days"
            >
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
            <ResponsiveTable
              columns={[
                { index: 0, label: 'Name', details: [1, 3] },
                { index: 4, label: 'Status', details: [2] },
              ]}
            >
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
                      <td>{roleLabel(s.role)}</td>
                      <td>{ago(s.lastActivity)}</td>
                      <td>
                        {s.archived ? (
                          <Badge tone="muted">Turned off</Badge>
                        ) : s.accessLevel === 0 ? (
                          <Badge tone="warn">No access</Badge>
                        ) : (
                          <Badge tone="good">Active</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </section>
          <section className="panel">
            <h2>Console activity for this business</h2>
            <ActivityTable rows={log} showBusiness={false} />
          </section>
        </>
      )}
    </>
  );
}

/** The business's own Business Settings page, saved from the console with every tab. */
function ConsoleSettings({ shopId, onSaved }: { shopId: string; onSaved: () => void }) {
  const { data, error, reload } = useLoad(() => businessSettings(shopId), [shopId]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.settings === null)
    return (
      <p className="muted">This business has not saved its settings yet. Open it once in the app first.</p>
    );
  let settings: Branding;
  try {
    settings = validateBranding(data.settings);
  } catch (cause) {
    return (
      <p role="alert">
        The saved settings could not be read: {cause instanceof Error ? cause.message : String(cause)}
      </p>
    );
  }
  return (
    <BusinessOptionsContext.Provider value={settings.options}>
      <TermsProvider value={settings.terms}>
        <BusinessSettingsPage
          key={data.version}
          settings={settings}
          version={data.version}
          ready
          online
          demo={false}
          modifiedAt={data.modifiedAt}
          accessLevel={4}
          onSave={async (next, version) => {
            const saved = await saveBusinessSettings(shopId, version, validateBranding(next));
            reload();
            onSaved();
            return saved;
          }}
          onReload={async () => reload()}
        />
      </TermsProvider>
    </BusinessOptionsContext.Provider>
  );
}

const roleOptions = [
  ['cashier', 'Cashier'],
  ['admin', 'Admin'],
  ['manager', 'Manager'],
  ['developer', 'Developer'],
] as const;
const roleLabel = (role: string) =>
  role === 'general_manager' ? 'General Manager' : role[0].toUpperCase() + role.slice(1);

/** Staff accounts: add, change role, turn access off or on, set a password. */
function ConsoleStaff({ data, onChanged }: { data: BusinessDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState(''),
    [password, setPassword] = useState<StaffRow | null>(null);
  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage('');
    setProblem('');
    try {
      await work();
      setMessage(done);
      onChanged();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const base = (s: StaffRow) => ({ id: s.id, version: s.version });
  return (
    <>
      <section className="panel">
        <h2>Staff & access</h2>
        <p className="muted">
          The console acts as the business's Developer. Which pages each role can open is set under Business
          settings → Page access.
        </p>
        {message && (
          <p role="status" className="notice notice-success">
            {message}
          </p>
        )}
        {problem && <p role="alert">{problem}</p>}
        <ResponsiveTable
          columns={[
            { index: 0, label: 'Name', details: [2] },
            { index: 1, label: 'Role' },
            { index: 3, label: 'Actions', actions: true },
          ]}
        >
          <table aria-label="Staff accounts">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <small>
                      {s.username} · last active {ago(s.lastActivity)}
                    </small>
                  </td>
                  <td>
                    {s.role === 'general_manager' ? (
                      <span title="The business account. Only its name and username can change.">
                        General Manager
                      </span>
                    ) : (
                      <select
                        aria-label={`Role of ${s.name}`}
                        value={s.role}
                        disabled={busy || s.archived}
                        onChange={(e) =>
                          act(
                            () =>
                              saveStaff(data.id, 'edit', {
                                ...base(s),
                                name: s.name,
                                username: s.username,
                                role: e.target.value,
                              }),
                            `${s.name} is now ${e.target.value}.`,
                          )
                        }
                      >
                        {roleOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {s.archived ? (
                      <Badge tone="muted">Turned off</Badge>
                    ) : s.accessLevel === 0 ? (
                      <Badge tone="warn">No access</Badge>
                    ) : (
                      <Badge tone="good">Active</Badge>
                    )}
                  </td>
                  <td>
                    <div className="material-actions">
                      {!s.archived && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => saveStaff(data.id, s.accessLevel === 0 ? 'grant' : 'revoke', base(s)),
                              s.accessLevel === 0
                                ? `${s.name} can sign in again.`
                                : `${s.name} can no longer sign in.`,
                            )
                          }
                        >
                          <Icon name={s.accessLevel === 0 ? 'restore' : 'close'} />{' '}
                          {s.accessLevel === 0 ? 'Give access' : 'Remove access'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () => saveStaff(data.id, s.archived ? 'restore' : 'archive', base(s)),
                            s.archived ? `${s.name} is back.` : `${s.name} is archived.`,
                          )
                        }
                      >
                        <Icon name={s.archived ? 'restore' : 'archive'} />{' '}
                        {s.archived ? 'Restore' : 'Archive'}
                      </button>
                      {!s.archived && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => setPassword(s)}
                        >
                          <Icon name="account" /> Set password
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </section>
      {password && (
        <section className="panel">
          <h2>Set a password for {password.name}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const target = password;
              void act(
                () =>
                  staffAction({
                    action: 'reset-password',
                    shopId: data.id,
                    memberId: target.id,
                    name: target.name,
                    password: String(f.get('password')),
                  }).then(() => setPassword(null)),
                `New password set for ${target.name}. Tell them in person.`,
              );
            }}
          >
            <fieldset disabled={busy}>
              <label>
                New password
                <input name="password" type="password" minLength={12} autoComplete="new-password" required />
              </label>
              <div className="material-actions">
                <button type="button" className="secondary" onClick={() => setPassword(null)}>
                  <Icon name="close" /> Cancel
                </button>
                <button type="submit">
                  <Icon name="save" /> Set password
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Add staff</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void act(
              () =>
                staffAction({
                  action: 'create',
                  shopId: data.id,
                  name: String(f.get('name')),
                  username: String(f.get('username')),
                  role: String(f.get('role')),
                  password: String(f.get('password')),
                }).then(() => form.reset()),
              'Staff account added.',
            );
          }}
        >
          <fieldset disabled={busy}>
            <div className="form-grid">
              <label>
                Name
                <input name="name" maxLength={160} required />
              </label>
              <label>
                Username
                <input name="username" maxLength={40} required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,39}" />
              </label>
              <label>
                Role
                <select name="role" defaultValue="cashier">
                  {roleOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starting password
                <input name="password" type="password" minLength={12} autoComplete="new-password" required />
              </label>
            </div>
            <button type="submit">
              <Icon name="add" /> Add staff
            </button>
          </fieldset>
        </form>
      </section>
    </>
  );
}

function ActivityTable({ rows, showBusiness = true }: { rows: ConsoleAction[]; showBusiness?: boolean }) {
  if (!rows.length) return <p className="muted">Nothing yet.</p>;
  return (
    <ResponsiveTable
      columns={[
        { index: 2, label: 'What', details: [1, ...(showBusiness ? [3] : [])] },
        { index: 0, label: 'When' },
      ]}
    >
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
                {typeof a.details?.staff === 'string' && a.details.staff && <small>{a.details.staff}</small>}
                {a.action.startsWith('problem.') && typeof a.details?.message === 'string' && (
                  <small>{a.details.message}</small>
                )}
                {typeof a.details?.device === 'string' && a.details.device && (
                  <small>{a.details.device}</small>
                )}
                {Array.isArray(a.details?.changed) && (a.details.changed as string[]).length > 0 && (
                  <small>Changed: {(a.details.changed as string[]).join(', ')}</small>
                )}
                {a.reason && <small>Reason: {a.reason}</small>}
              </td>
              {showBusiness && <td>{a.business ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
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
          <ResponsiveTable
            columns={
              owner
                ? [
                    { index: 0, label: 'Name', details: [2] },
                    { index: 1, label: 'Role' },
                    { index: 3, label: 'Actions', actions: true },
                  ]
                : [
                    { index: 0, label: 'Name', details: [2] },
                    { index: 1, label: 'Role' },
                  ]
            }
          >
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
                    <td>
                      {m.disabled ? (
                        <Badge tone="muted">Turned off</Badge>
                      ) : (
                        <Badge tone="good">Active</Badge>
                      )}
                    </td>
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
          </ResponsiveTable>
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

/** Each phone or computer using the business: who, when, app version, unsent work, History check. */
function ConsoleDevices({ shopId, onChanged }: { shopId: string; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => devices(shopId), [shopId]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState('');
  async function act(device: DeviceRow, action: 'sign-out' | 'cancel-sign-out' | 'forget', done: string) {
    setBusy(true);
    setMessage('');
    setProblem('');
    try {
      await deviceAction(shopId, device.id, action);
      setMessage(done);
      reload();
      onChanged();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const status = (d: DeviceRow) =>
    d.signOutRequestedAt && (!d.signedOutAt || d.signedOutAt < d.signOutRequestedAt)
      ? 'Sign-out requested'
      : d.signedOutAt && d.signOutRequestedAt
        ? `Signed out ${ago(d.signedOutAt)}`
        : Date.now() - Date.parse(d.lastSeen) < 15 * 60000
          ? 'In use'
          : 'Idle';
  return (
    <section className="panel">
      <h2>Devices</h2>
      <p className="muted">
        Each phone or computer reports itself when it syncs, at most every few minutes. Signing a device out
        happens the next time it syncs; any unsent work stays on it and sends after the next sign-in.
      </p>
      {message && (
        <p role="status" className="notice notice-success">
          {message}
        </p>
      )}
      {(problem || error) && <p role="alert">{problem || error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !data.length && (
        <p className="muted">No device has reported yet. Devices appear after their next sync.</p>
      )}
      {data && data.length > 0 && (
        <ResponsiveTable
          columns={[
            { index: 0, label: 'Device', details: [1, 2, 3] },
            { index: 4, label: 'Actions', actions: true },
          ]}
        >
          <table aria-label="Devices">
            <thead>
              <tr>
                <th>Device</th>
                <th>Last seen</th>
                <th>Sync</th>
                <th>History check</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.name || 'Unknown device'}
                    <small>
                      {d.userLabel || 'No staff signed in'} · app {d.appVersion || '—'}
                    </small>
                  </td>
                  <td>
                    {ago(d.lastSeen)}
                    <small>{status(d)}</small>
                  </td>
                  <td>
                    {d.pending ? `${d.pending} unsent` : 'All sent'}
                    {d.held > 0 && <small className="danger-text">{d.held} waiting for review</small>}
                    <small>Last sync {ago(d.lastSynced)}</small>
                  </td>
                  <td>
                    {d.history?.checked
                      ? d.history.differing
                        ? `${d.history.differing} differ`
                        : `All ${d.history.checked} match`
                      : 'Not run yet'}
                    {d.history?.checkedAt && <small>{ago(d.history.checkedAt)}</small>}
                    {d.history?.windows?.length ? (
                      <small>
                        {d.history.windows
                          .map(
                            (w) =>
                              `${w.label} ${w.differing ? `✗ ${w.differing}` : '✓'} (${w.leftOut} older)`,
                          )
                          .join(' · ')}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <div className="material-actions">
                      {status(d) === 'Sign-out requested' ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => act(d, 'cancel-sign-out', 'Sign-out cancelled.')}
                        >
                          <Icon name="restore" /> Cancel sign-out
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(d, 'sign-out', `${d.name} will sign out the next time it syncs.`)
                          }
                        >
                          <Icon name="close" /> Sign out
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(d, 'forget', `${d.name} removed from the list. It reappears if used again.`)
                        }
                      >
                        <Icon name="archive" /> Remove from list
                      </button>
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

/** Downloads everything about one business as a single file, for safekeeping. */
function BackupButton({ shopId, name, onDone }: { shopId: string; name: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false),
    [problem, setProblem] = useState('');
  return (
    <div className="console-backup">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setProblem('');
          try {
            const backup = await businessBackup(shopId);
            const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
            const file = `${
              name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '') || 'business'
            }-backup-${date}.json`;
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = file;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            onDone();
          } catch (cause) {
            setProblem(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="export" /> {busy ? 'Preparing backup…' : 'Download backup'}
      </button>
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}

function AllProblems() {
  const { data } = useLoad(businesses, []);
  return <ConsoleProblems businesses={data ?? []} />;
}
