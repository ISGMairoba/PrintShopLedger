import { useEffect, useState } from 'react';
import Icon from '../Icon';
import ResponsiveTable from '../ResponsiveTable';
import {
  saveUsageWeights,
  usage as loadUsage,
  usageWeights as loadWeights,
  type Usage,
  type UsageWeight,
} from './console-api';

const lagosDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
/** The periods to look at: this month, last month, the last 30 or 90 days. */
export function usagePeriods(today = lagosDay()) {
  const [y, m] = today.split('-').map(Number);
  const first = (year: number, month: number) =>
    new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const back = (days: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  return [
    { key: 'month', label: 'This month', from: first(y, m), to: today },
    {
      key: 'last-month',
      label: 'Last month',
      from: first(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1),
      to: new Date(Date.parse(`${first(y, m)}T12:00:00Z`) - 86400000).toISOString().slice(0, 10),
    },
    { key: '30', label: 'Last 30 days', from: back(29), to: today },
    { key: '90', label: 'Last 90 days', from: back(89), to: today },
  ];
}
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const n = (value: number) => Number(value ?? 0).toLocaleString('en-NG');

/** One business's usage in tokens: totals, by category and operation, and per day. */
export function ConsoleUsage({ shopId }: { shopId: string }) {
  const periods = usagePeriods();
  const [period, setPeriod] = useState(periods[0].key),
    [data, setData] = useState<Usage | null>(null),
    [problem, setProblem] = useState('');
  const chosen = periods.find((p) => p.key === period) ?? periods[0];
  useEffect(() => {
    let live = true;
    setData(null);
    setProblem('');
    loadUsage(shopId, chosen.from, chosen.to)
      .then((u) => live && setData(u))
      .catch((cause) => live && setProblem(errorText(cause)));
    return () => {
      live = false;
    };
  }, [shopId, chosen.from, chosen.to]);
  // Every day of the period, including quiet ones.
  const days: { day: string; tokens: number }[] = [];
  if (data)
    for (
      let t = Date.parse(`${chosen.from}T12:00:00Z`);
      t <= Date.parse(`${chosen.to}T12:00:00Z`);
      t += 86400000
    ) {
      const day = new Date(t).toISOString().slice(0, 10);
      days.push({ day, tokens: data.daily.find((d) => d.day === day)?.tokens ?? 0 });
    }
  const peak = Math.max(1, ...days.map((d) => d.tokens));
  const monthly = data?.monthlyTokens ?? null;
  const monthView = period === 'month' || period === 'last-month';
  const share = monthly && monthView && data ? Math.round((data.tokens / monthly) * 100) : null;
  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <h2>Usage</h2>
          <div className="settings-tabs" role="tablist" aria-label="Usage period">
            {periods.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                className={period === p.key ? 'active' : 'secondary'}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          Every operation the business records is worth some tokens (a sale 5, a job moving stage 1…; set
          under Plans → Token values). Worked out from records the business already keeps, so it costs the app
          nothing.
        </p>
        {problem && <p role="alert">{problem}</p>}
        {!data && !problem && <p className="muted">Loading…</p>}
        {data && (
          <>
            <div className="stats">
              <article>
                <span>Tokens used</span>
                <strong>{n(data.tokens)}</strong>
                <small>
                  {shortDay(chosen.from)} – {shortDay(chosen.to)}
                </small>
              </article>
              <article>
                <span>Operations</span>
                <strong>{n(data.operations)}</strong>
                <small>Sales, job stages, customers, stock…</small>
              </article>
              <article>
                <span>Plan allowance</span>
                <strong>{monthly ? `${n(monthly)} / month` : 'None set'}</strong>
                <small>
                  {share !== null
                    ? `${share}% used this ${period === 'month' ? 'month so far' : 'month'}`
                    : monthly
                      ? 'Choose This month or Last month to compare'
                      : 'Set tokens per month on the plan'}
                </small>
                {share !== null && (
                  <span className="console-meter" aria-hidden="true">
                    <i
                      className={share > 100 ? 'over' : share > 80 ? 'near' : ''}
                      style={{ width: `${Math.min(share, 100)}%` }}
                    />
                  </span>
                )}
              </article>
            </div>
            <div className="console-bars console-bars-usage" role="img" aria-label="Tokens per day">
              {days.map((d) => (
                <span key={d.day} title={`${shortDay(d.day)}: ${n(d.tokens)} tokens`}>
                  <i style={{ height: `${Math.round((d.tokens / peak) * 100)}%` }} />
                </span>
              ))}
            </div>
            <small className="muted">Tokens per day · busiest day {n(peak)} tokens</small>
          </>
        )}
      </section>
      {data && data.byCategory.length > 0 && (
        <section className="panel">
          <h2>Where the tokens went</h2>
          <ResponsiveTable
            columns={[
              { index: 0, label: 'Operation', details: [1, 2] },
              { index: 4, label: 'Tokens' },
            ]}
          >
            <table aria-label="Usage by operation">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Category</th>
                  <th className="numeric">Each</th>
                  <th className="numeric">Times</th>
                  <th className="numeric">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.byKind.map((k) => (
                  <tr key={k.kind}>
                    <td>{operationLabel(k.kind)}</td>
                    <td>{k.category}</td>
                    <td className="numeric">{k.each}</td>
                    <td className="numeric">{n(k.operations)}</td>
                    <td className="numeric">{n(k.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          <div className="console-categories">
            {data.byCategory.map((c) => (
              <span key={c.category}>
                <strong>{c.category}</strong> {n(c.tokens)} (
                {Math.round((c.tokens / Math.max(1, data.tokens)) * 100)}%)
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const kindLabels: Record<string, string> = {
  'checkout.completed': 'Sale (checkout)',
  'job.status_changed': 'Job moved to a new stage',
  'job.due_changed': 'Job due date changed',
  'job.material_used': 'Material confirmed for a job',
  'material.job_used': 'Stock used by a job',
  'customer.created': 'Customer added',
  'customer.updated': 'Customer changed',
  'customer.reminded': 'Payment reminder sent',
  'expense.created': 'Expense recorded',
  'expense.payment_recorded': 'Expense payment',
  'quotation.saved': 'Quotation saved',
  'quotation.converted': 'Quotation turned into a sale',
  'service.created': 'Service added',
  'service.updated': 'Service changed',
  'material.created': 'Stock item added',
  'material.updated': 'Stock item changed',
  'material.stock_set': 'Stock count set',
  'material.stock_added': 'Stock added',
  'sale.corrected': 'Sale corrected',
  'payment.corrected': 'Payment corrected',
};
export const operationLabel = (kind: string) => kindLabels[kind] ?? kind;

/** The token value of each kind of operation; only console owners can change them. */
export function UsageWeightsPanel() {
  const [rows, setRows] = useState<UsageWeight[] | null>(null),
    [saved, setSaved] = useState<UsageWeight[] | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    loadWeights()
      .then((w) => {
        if (!live) return;
        setRows(w);
        setSaved(w);
      })
      .catch((cause) => live && setProblem(errorText(cause)));
    return () => {
      live = false;
    };
  }, []);
  const change = (i: number, patch: Partial<UsageWeight>) =>
    setRows((r) => (r ? r.map((row, j) => (j === i ? { ...row, ...patch } : row)) : r));
  return (
    <section className="panel">
      <h2>Token values</h2>
      <p className="muted">
        How many tokens each kind of operation is worth. A line ending in .* covers every operation of that
        kind (job.* is every job change); an exact line wins over it. Anything not listed is worth 1. Changes
        apply to all past and future usage figures. Only console owners can save them.
      </p>
      {message && (
        <p role="status" className="notice notice-success">
          {message}
        </p>
      )}
      {problem && <p role="alert">{problem}</p>}
      {!rows && !problem && <p className="muted">Loading…</p>}
      {rows && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            setProblem('');
            const clean = rows
              .map((r) => ({ ...r, pattern: r.pattern.trim().toLowerCase(), category: r.category.trim() }))
              .filter((r) => r.pattern);
            saveUsageWeights(clean)
              .then(() => {
                setRows(clean);
                setSaved(clean);
                setMessage('Token values saved.');
              })
              .catch((cause) => setProblem(errorText(cause)))
              .finally(() => setBusy(false));
          }}
        >
          <fieldset disabled={busy}>
            <div className="table-wrap">
              <table aria-label="Token values">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Category</th>
                    <th className="numeric">Tokens</th>
                    <th aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`Operation ${i + 1}`}
                          required
                          pattern="[a-z_]+(\.[a-z_]+|\.\*)"
                          value={r.pattern}
                          onChange={(e) => change(i, { pattern: e.target.value })}
                        />
                        <small>
                          {r.pattern.endsWith('.*')
                            ? 'Every ' + r.pattern.slice(0, -2) + ' operation'
                            : operationLabel(r.pattern)}
                        </small>
                      </td>
                      <td>
                        <input
                          aria-label={`Category ${i + 1}`}
                          required
                          maxLength={40}
                          value={r.category}
                          onChange={(e) => change(i, { category: e.target.value })}
                        />
                      </td>
                      <td className="numeric">
                        <input
                          aria-label={`Tokens ${i + 1}`}
                          type="number"
                          min={0}
                          max={1000}
                          required
                          value={r.tokens}
                          onChange={(e) => change(i, { tokens: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Remove ${r.pattern || 'line'}`}
                          onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                          <Icon name="close" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="console-form-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setRows([...rows, { pattern: '', category: 'Other', tokens: 1 }])}
              >
                <Icon name="add" /> Add line
              </button>
              <div className="material-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setRows(saved);
                    setProblem('');
                  }}
                >
                  <Icon name="close" /> Cancel
                </button>
                <button type="submit">
                  <Icon name="save" /> Save token values
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
