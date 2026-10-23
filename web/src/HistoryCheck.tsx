import { useEffect, useState } from 'react';
import Icon from './Icon';
import { historyCheck } from './history-window.mjs';
import type { Ledger } from './types';

type Result = ReturnType<typeof historyCheck>;
const key = (scope: string) => `printshopledger:history-check:v1:${scope}`;
const read = (scope: string): Result | null => {
  try {
    return JSON.parse(localStorage.getItem(key(scope)) ?? 'null');
  } catch {
    return null;
  }
};
const DAY = 24 * 60 * 60 * 1000;

/**
 * My Account → This device: the history check (stage 1 of keeping recent history only). It works
 * out the important figures from all records and from a copy that keeps the last 3 months, and
 * shows whether they all match. Nothing is trimmed; it runs once a day by itself.
 */
export default function HistoryCheck({ ledger, scope }: { ledger: Ledger; scope: string }) {
  const [result, setResult] = useState<Result | null>(() => read(scope));
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    // Let the button show "Checking…" before the work starts.
    setTimeout(() => {
      try {
        const next = historyCheck(ledger);
        setResult(next);
        try {
          localStorage.setItem(key(scope), JSON.stringify(next));
        } catch {}
      } finally {
        setRunning(false);
      }
    }, 50);
  };
  useEffect(() => {
    const last = read(scope);
    if (!last || Date.now() - Date.parse(last.checkedAt) > DAY) {
      const timer = setTimeout(run, 3000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  const dropped = result
    ? result.dropped.jobs +
      result.dropped.payments +
      result.dropped.checkouts +
      result.dropped.materialHistory
    : 0;
  return (
    <div className="history-check" aria-labelledby="history-check-title">
      <h3 id="history-check-title">History check</h3>
      <p className="muted">
        Getting ready to let devices keep only recent history. This compares the figures worked out from all
        records with a copy that keeps the last 3 months. Nothing is removed.
      </p>
      {result && (
        <p
          role="status"
          className={result.differences.length ? 'notice notice-error' : 'notice notice-success'}
        >
          {result.differences.length
            ? `${result.differences.length} of ${result.checked} figures differ (records before ${result.cutoff}).`
            : `All ${result.checked} figures match, with ${dropped} older records left out (before ${result.cutoff}).`}{' '}
          Checked {new Date(result.checkedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.
        </p>
      )}
      {result && result.differences.length > 0 && (
        <details>
          <summary>Show the figures that differ</summary>
          <ul className="history-check-differences">
            {result.differences.map((d) => (
              <li key={d.what}>
                <strong>{d.what}</strong>
                <code>All records: …{d.full}…</code>
                <code>Recent only: …{d.trimmed}…</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" className="secondary" disabled={running} onClick={run}>
        <Icon name="sync" /> {running ? 'Checking…' : 'Check now'}
      </button>
    </div>
  );
}
