import { useEffect, useState } from 'react';
import Icon from './Icon';
import { readHistoryResults, runHistoryCheck, type HistoryResults } from './history-check-store';
import type { Ledger } from './types';

type Result = HistoryResults;
const read = readHistoryResults;
const left = (r: Result[number]) =>
  r.dropped.jobs + r.dropped.payments + r.dropped.checkouts + r.dropped.expenses + r.dropped.materialHistory;

/**
 * My Account → This device: the history check (stage 1 of keeping recent history only). For each
 * window (7 days to 3 months) it works out the important figures from all records and from a
 * copy that keeps only that window, and shows whether they all match. Nothing is removed; the app
 * runs it once a day by itself after a sync (history-check-store.ts).
 */
export default function HistoryCheck({ ledger, scope }: { ledger: Ledger; scope: string }) {
  const [results, setResults] = useState<Result | null>(() => read(scope));
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    // Let the button show "Checking…" before the work starts.
    setTimeout(() => {
      try {
        setResults(runHistoryCheck(scope, ledger));
      } finally {
        setRunning(false);
      }
    }, 50);
  };
  // The app also runs it once a day by itself after a sync; show the latest results.
  useEffect(() => {
    setResults(read(scope));
    const timer = setInterval(() => setResults(read(scope)), 60000);
    return () => clearInterval(timer);
  }, [scope]);
  const differing = results?.filter((r) => r.differences.length) ?? [];
  const checked = results?.reduce((n, r) => n + r.checked, 0) ?? 0;
  return (
    <div className="history-check" aria-labelledby="history-check-title">
      <h3 id="history-check-title">History check</h3>
      <p className="muted">
        Getting ready to let devices keep only recent history. For each window below, this compares the
        figures worked out from all records with a copy that keeps only that window. Nothing is removed.
      </p>
      {results && (
        <p role="status" className={differing.length ? 'notice notice-error' : 'notice notice-success'}>
          {differing.length
            ? `Some figures differ when keeping ${differing.map((r) => r.label).join(', ')}.`
            : `All ${checked} figures match in every window.`}{' '}
          Checked {new Date(results[0].checkedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.
        </p>
      )}
      {results && (
        <ul className="history-check-windows">
          {results.map((r) => (
            <li key={r.label}>
              <strong>Keep {r.label}</strong> (from {r.cutoff}):{' '}
              {r.differences.length
                ? `${r.differences.length} of ${r.checked} figures differ`
                : `all ${r.checked} figures match`}
              , {left(r)} older records left out
            </li>
          ))}
        </ul>
      )}
      {differing.length > 0 && (
        <details>
          <summary>Show the figures that differ</summary>
          <ul className="history-check-differences">
            {differing.flatMap((r) =>
              r.differences.map((d) => (
                <li key={r.label + d.what}>
                  <strong>
                    Keep {r.label}: {d.what}
                  </strong>
                  <code>All records: …{d.full}…</code>
                  <code>Recent only: …{d.trimmed}…</code>
                </li>
              )),
            )}
          </ul>
        </details>
      )}
      <button type="button" className="secondary" disabled={running} onClick={run}>
        <Icon name="sync" /> {running ? 'Checking…' : 'Check now'}
      </button>
    </div>
  );
}
