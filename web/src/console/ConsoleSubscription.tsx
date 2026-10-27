import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Icon from '../Icon';
import ResponsiveTable from '../ResponsiveTable';
import { money } from '../domain.mjs';
import { pages } from '../page-access.mjs';
import { currency } from '../receipts.mjs';
import {
  plans as loadPlans,
  recordPayment,
  savePlan,
  saveSubscription,
  subscription as loadSubscription,
  type ExpiryMode,
  type Plan,
  type Subscription,
  type SubscriptionDetail,
  type SubscriptionState,
} from './console-api';

// Dates are shown and entered in Lagos time; an expiry date means the end of that day.
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) : '';
const startOf = (date: string) => `${date}T00:00:00+01:00`;
const endOf = (date: string) => `${date}T23:59:59+01:00`;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = () => day(new Date().toISOString());
const shown = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium' }) : '—';

export const stateLabels: Record<SubscriptionState, string> = {
  none: 'No subscription',
  trial: 'Trial',
  active: 'Active',
  grace: 'In grace days',
  expired: 'Expired',
  suspended: 'Suspended',
};
const stateTones: Record<SubscriptionState, Tone> = {
  none: 'muted',
  trial: 'info',
  active: 'good',
  grace: 'warn',
  expired: 'bad',
  suspended: 'bad',
};
export type Tone = 'good' | 'info' | 'warn' | 'bad' | 'muted';
/** A small coloured status label. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`console-badge console-badge-${tone}`}>{children}</span>;
}
export function StateBadge({ state }: { state: SubscriptionState }) {
  return <Badge tone={stateTones[state]}>{stateLabels[state]}</Badge>;
}
const modeLabels: [ExpiryMode, string, string][] = [
  ['warn', 'Show a reminder only', 'Everything keeps working; the app shows the message.'],
  [
    'read_only',
    'View only',
    'Records can be viewed and exported. New work stays on the device and sends after renewal.',
  ],
  ['pages_off', 'Turn off some pages', 'The pages ticked below are hidden; the rest keep working.'],
  ['locked', 'Lock the app', 'The app shows only the message until the subscription is renewed.'],
];
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

type Draft = {
  planId: string;
  status: Subscription['status'];
  startsOn: string;
  expiresOn: string;
  graceDays: string;
  expiryMode: ExpiryMode;
  pagesOff: string[];
  message: string;
  maxDevices: string;
  reason: string;
};
const toDraft = (s: Subscription | null): Draft => ({
  planId: s?.planId ?? '',
  status: s?.status ?? 'trial',
  startsOn: day(s?.startsAt) || today(),
  expiresOn: day(s?.expiresAt),
  graceDays: String(s?.graceDays ?? 3),
  expiryMode: s?.expiryMode ?? 'read_only',
  pagesOff: s?.pagesOff ?? [],
  message: s?.message ?? '',
  maxDevices: s?.maxDevices ? String(s.maxDevices) : '',
  reason: '',
});

/** One business's subscription: plan, dates, what happens when it runs out, devices, payments. */
export function ConsoleSubscription({ shopId, onChanged }: { shopId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null),
    [planList, setPlanList] = useState<Plan[]>([]),
    [draft, setDraft] = useState<Draft>(toDraft(null)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState(''),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([loadSubscription(shopId), loadPlans()])
      .then(([d, p]) => {
        if (!live) return;
        setDetail(d);
        setPlanList(p);
        setDraft(toDraft(d.subscription));
      })
      .catch((cause) => live && setProblem(errorText(cause)));
    return () => {
      live = false;
    };
  }, [shopId, tick]);
  const plan = planList.find((p) => p.id === draft.planId);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage('');
    setProblem('');
    try {
      await work();
      setMessage(done);
      setTick((n) => n + 1);
      onChanged();
    } catch (cause) {
      setProblem(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (draft.expiresOn && draft.expiresOn < draft.startsOn) {
      setProblem('The expiry date must be after the start date.');
      return;
    }
    void act(
      () =>
        saveSubscription(shopId, {
          planId: draft.planId || null,
          status: draft.status,
          startsAt: startOf(draft.startsOn),
          expiresAt: draft.expiresOn ? endOf(draft.expiresOn) : null,
          graceDays: Number(draft.graceDays || 0),
          expiryMode: draft.expiryMode,
          pagesOff: draft.expiryMode === 'pages_off' ? draft.pagesOff : [],
          message: draft.message.trim(),
          maxDevices: draft.maxDevices ? Number(draft.maxDevices) : null,
          reason: draft.reason.trim(),
        }),
      'Subscription saved. Devices pick it up within 30 minutes, or at their next sign-in.',
    );
  }
  if (!detail)
    return (
      <section className="panel">
        {problem ? <p role="alert">{problem}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  const sub = detail.subscription;
  const limit = sub?.maxDevices ?? planList.find((p) => p.id === sub?.planId)?.maxDevices ?? null;
  const graceEnds = sub?.expiresAt
    ? new Date(Date.parse(sub.expiresAt) + sub.graceDays * 86400000).toISOString()
    : null;
  const lastPaidTo = detail.payments.find((p) => p.extendedTo)?.extendedTo;
  const extendFrom = [day(sub?.expiresAt), today()].sort().pop() as string;
  return (
    <>
      <section className="stats">
        <article>
          <span>Subscription</span>
          <strong>
            <StateBadge state={detail.state} />
          </strong>
          <small>{planList.find((p) => p.id === sub?.planId)?.name ?? 'No plan chosen'}</small>
        </article>
        <article>
          <span>Runs until</span>
          <strong>{sub?.expiresAt ? shown(sub.expiresAt) : 'No end date'}</strong>
          <small>{graceEnds ? `Grace ends ${shown(graceEnds)}` : 'Works without limit'}</small>
        </article>
        <article>
          <span>Devices in use (30 days)</span>
          <strong>
            {detail.devices}
            {limit ? ` of ${limit}` : ''}
          </strong>
          <small>{limit ? 'New devices beyond the limit are signed out' : 'No device limit'}</small>
        </article>
      </section>
      <section className="panel">
        <h2>Subscription</h2>
        <p className="muted">
          A business without a subscription works without limits. Changes reach its devices within 30 minutes.
        </p>
        {message && (
          <p role="status" className="notice notice-success">
            {message}
          </p>
        )}
        {problem && <p role="alert">{problem}</p>}
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <h3 className="console-subhead">Plan and dates</h3>
            <div className="form-grid console-grid-3">
              <label>
                Plan
                <select
                  value={draft.planId}
                  onChange={(e) => {
                    const next = planList.find((p) => p.id === e.target.value);
                    setDraft((d) => ({
                      ...d,
                      planId: e.target.value,
                      expiresOn: d.expiresOn || (next ? addDays(d.startsOn, next.periodDays) : ''),
                    }));
                  }}
                >
                  <option value="">No plan</option>
                  {planList
                    .filter((p) => !p.archived || p.id === draft.planId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {currency(p.price)} / {p.periodDays} days
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={draft.status}
                  onChange={(e) => set('status', e.target.value as Draft['status'])}
                >
                  <option value="trial">Trial</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended (acts as expired now)</option>
                </select>
              </label>
              <label>
                Starts on
                <input
                  type="date"
                  required
                  value={draft.startsOn}
                  onChange={(e) => set('startsOn', e.target.value)}
                />
              </label>
              <label>
                Expires at the end of
                <input
                  type="date"
                  value={draft.expiresOn}
                  onChange={(e) => set('expiresOn', e.target.value)}
                />
                <small>Leave empty for no end date.</small>
              </label>
              <label>
                Grace days
                <input
                  type="number"
                  min={0}
                  max={60}
                  required
                  value={draft.graceDays}
                  onChange={(e) => set('graceDays', e.target.value)}
                />
                <small>Days after expiry that still work, with a warning.</small>
              </label>
              <label>
                Device limit
                <input
                  type="number"
                  min={1}
                  max={1000}
                  placeholder={plan?.maxDevices ? `Plan: ${plan.maxDevices}` : 'No limit'}
                  value={draft.maxDevices}
                  onChange={(e) => set('maxDevices', e.target.value)}
                />
                <small>Leave empty to use the plan's limit.</small>
              </label>
            </div>
            <h3 className="console-subhead">When it runs out</h3>
            <div className="form-grid">
              <label>
                When it runs out
                <select
                  value={draft.expiryMode}
                  onChange={(e) => set('expiryMode', e.target.value as ExpiryMode)}
                >
                  {modeLabels.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>{modeLabels.find(([value]) => value === draft.expiryMode)?.[2]}</small>
              </label>
              <label>
                Message to the business
                <textarea
                  maxLength={500}
                  rows={3}
                  placeholder="e.g. Your subscription has ended. Call 0800 000 0000 to renew."
                  value={draft.message}
                  onChange={(e) => set('message', e.target.value)}
                />
              </label>
            </div>
            {draft.expiryMode === 'pages_off' && (
              <fieldset className="console-pages">
                <legend>Pages to turn off when it runs out</legend>
                {pages.map((page) => (
                  <label className="check-label" key={page}>
                    <input
                      type="checkbox"
                      checked={draft.pagesOff.includes(page)}
                      onChange={(e) =>
                        set(
                          'pagesOff',
                          e.target.checked
                            ? [...draft.pagesOff, page]
                            : draft.pagesOff.filter((p) => p !== page),
                        )
                      }
                    />
                    {page}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="console-form-footer">
              <label>
                Reason (for the activity log)
                <input
                  maxLength={300}
                  placeholder="Optional, e.g. agreed by phone"
                  value={draft.reason}
                  onChange={(e) => set('reason', e.target.value)}
                />
              </label>
              <div className="material-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDraft(toDraft(sub));
                    setProblem('');
                  }}
                >
                  <Icon name="close" /> Cancel
                </button>
                <button type="submit">
                  <Icon name="save" /> Save subscription
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h2>Record a payment</h2>
        <p className="muted">
          Payments are recorded by hand. Extending the date also makes the subscription active.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            let amount: number;
            try {
              amount = money(String(f.get('amount')));
            } catch (cause) {
              setProblem(errorText(cause));
              return;
            }
            const extendTo = String(f.get('extendTo') ?? '');
            void act(
              () =>
                recordPayment(shopId, {
                  amount,
                  paidOn: String(f.get('paidOn')),
                  method: String(f.get('method') ?? '').trim(),
                  reference: String(f.get('reference') ?? '').trim(),
                  extendedTo: extendTo ? endOf(extendTo) : null,
                  note: String(f.get('note') ?? '').trim(),
                }).then(() => form.reset()),
              extendTo
                ? `Payment recorded. The subscription now runs until ${shown(endOf(extendTo))}.`
                : 'Payment recorded.',
            );
          }}
        >
          <fieldset disabled={busy}>
            <div className="form-grid console-grid-3">
              <label>
                Amount (₦)
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  defaultValue={plan ? String(plan.price / 100) : ''}
                  key={`amount-${plan?.id ?? ''}-${tick}`}
                />
              </label>
              <label>
                Paid on
                <input name="paidOn" type="date" required defaultValue={today()} max={today()} />
              </label>
              <label>
                Method
                <input name="method" maxLength={80} placeholder="Transfer, cash…" />
              </label>
              <label>
                Reference
                <input name="reference" maxLength={200} />
              </label>
              <label>
                Extend the subscription to the end of
                <input
                  name="extendTo"
                  type="date"
                  min={addDays(today(), 1)}
                  defaultValue={plan ? addDays(extendFrom, plan.periodDays) : ''}
                  key={`extend-${plan?.id ?? ''}-${tick}`}
                />
                <small>Leave empty to record the payment without changing the dates.</small>
              </label>
              <label>
                Note
                <input name="note" maxLength={500} />
              </label>
            </div>
            <div className="console-form-footer">
              <span />
              <button type="submit">
                <Icon name="payments" /> Record payment
              </button>
            </div>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h2>Payment history</h2>
        {lastPaidTo && <p className="muted">Last payment extended it to {shown(lastPaidTo)}.</p>}
        {detail.payments.length === 0 ? (
          <p className="muted">No payments recorded yet.</p>
        ) : (
          <ResponsiveTable
            columns={[
              { index: 1, label: 'Amount', details: [0, 2] },
              { index: 3, label: 'Extended to', details: [4] },
            ]}
          >
            <table aria-label="Payments">
              <thead>
                <tr>
                  <th>Paid on</th>
                  <th className="numeric">Amount</th>
                  <th>Method</th>
                  <th>Extended to</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {shown(p.paidOn)}
                      {p.note && <small>{p.note}</small>}
                    </td>
                    <td className="numeric">{currency(p.amount)}</td>
                    <td>
                      {p.method || '—'}
                      {p.reference && <small>{p.reference}</small>}
                    </td>
                    <td>{p.extendedTo ? shown(p.extendedTo) : '—'}</td>
                    <td>{p.recordedBy ?? '—'}</td>
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

const blankPlan = (): Plan => ({
  id: '',
  name: '',
  price: 0,
  periodDays: 30,
  maxDevices: null,
  description: '',
  archived: false,
});
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** The plans businesses can be put on. */
export function ConsolePlans() {
  const [list, setList] = useState<Plan[] | null>(null),
    [editing, setEditing] = useState<{ plan: Plan; price: string; isNew: boolean } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState(''),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loadPlans()
      .then((p) => live && setList(p))
      .catch((cause) => live && setProblem(errorText(cause)));
    return () => {
      live = false;
    };
  }, [tick]);
  async function store(plan: Plan, done: string) {
    setBusy(true);
    setMessage('');
    setProblem('');
    try {
      await savePlan(plan);
      setMessage(done);
      setEditing(null);
      setTick((n) => n + 1);
    } catch (cause) {
      setProblem(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const edit = (plan: Plan, isNew: boolean) =>
    setEditing({ plan: { ...plan }, price: isNew ? '' : String(plan.price / 100), isNew });
  const change = (patch: Partial<Plan>) =>
    setEditing((e) => (e ? { ...e, plan: { ...e.plan, ...patch } } : e));
  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <h2>Plans</h2>
          <button type="button" disabled={busy} onClick={() => edit(blankPlan(), true)}>
            <Icon name="add" /> Add plan
          </button>
        </div>
        <p className="muted">
          Prices and lengths are suggestions for each business's subscription; the device limit applies to
          every business on the plan unless its subscription sets its own.
        </p>
        {message && (
          <p role="status" className="notice notice-success">
            {message}
          </p>
        )}
        {problem && <p role="alert">{problem}</p>}
        {!list && !problem && <p className="muted">Loading…</p>}
        {list && list.length === 0 && <p className="muted">No plans yet.</p>}
        {list && list.length > 0 && (
          <ResponsiveTable
            columns={[
              { index: 0, label: 'Plan', details: [2, 3, 4] },
              { index: 1, label: 'Price' },
              { index: 5, label: 'Actions', actions: true },
            ]}
          >
            <table aria-label="Plans">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="numeric">Price</th>
                  <th className="numeric">Days</th>
                  <th className="numeric">Devices</th>
                  <th className="numeric">Businesses</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      {p.archived && <Badge tone="muted">Archived</Badge>}
                      <small>{p.description || p.id}</small>
                    </td>
                    <td className="numeric">{currency(p.price)}</td>
                    <td className="numeric">{p.periodDays}</td>
                    <td className="numeric">{p.maxDevices ?? 'No limit'}</td>
                    <td className="numeric">{p.businesses ?? 0}</td>
                    <td>
                      <div className="material-actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => edit(p, false)}
                        >
                          <Icon name="edit" /> Edit
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            store(
                              { ...p, archived: !p.archived },
                              p.archived ? `${p.name} is available again.` : `${p.name} is archived.`,
                            )
                          }
                        >
                          <Icon name={p.archived ? 'restore' : 'archive'} />{' '}
                          {p.archived ? 'Restore' : 'Archive'}
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
      {editing && (
        <section className="panel">
          <h2>{editing.isNew ? 'Add a plan' : `Edit ${editing.plan.name}`}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              let price: number;
              try {
                price = money(editing.price);
              } catch (cause) {
                setProblem(errorText(cause));
                return;
              }
              const plan = {
                ...editing.plan,
                name: editing.plan.name.trim(),
                description: editing.plan.description.trim(),
                id: editing.isNew ? slug(editing.plan.name) : editing.plan.id,
                price,
              };
              if (plan.id.length < 2) {
                setProblem('Give the plan a longer name.');
                return;
              }
              if (editing.isNew && list?.some((p) => p.id === plan.id)) {
                setProblem('A plan with this name already exists.');
                return;
              }
              void store(plan, `${plan.name} saved.`);
            }}
          >
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    required
                    maxLength={80}
                    value={editing.plan.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </label>
                <label>
                  Price (₦)
                  <input
                    required
                    inputMode="decimal"
                    value={editing.price}
                    onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                  />
                </label>
                <label>
                  Length in days
                  <input
                    type="number"
                    required
                    min={1}
                    max={3660}
                    value={editing.plan.periodDays}
                    onChange={(e) => change({ periodDays: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Most devices
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    placeholder="No limit"
                    value={editing.plan.maxDevices ?? ''}
                    onChange={(e) => change({ maxDevices: e.target.value ? Number(e.target.value) : null })}
                  />
                </label>
                <label>
                  Description
                  <input
                    maxLength={300}
                    value={editing.plan.description}
                    onChange={(e) => change({ description: e.target.value })}
                  />
                </label>
              </div>
              <div className="material-actions">
                <button type="button" className="secondary" onClick={() => setEditing(null)}>
                  <Icon name="close" /> Cancel
                </button>
                <button type="submit">
                  <Icon name="save" /> Save plan
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
    </>
  );
}
