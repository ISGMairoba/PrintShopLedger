// The History check's results on this device, and running it in the background once a day, so
// every device reports how keeping only recent history would work for it (see HistoryCheck.tsx).
import { historyChecks } from './history-window.mjs';
import type { Ledger } from './types';

export type HistoryResults = ReturnType<typeof historyChecks>;
const DAY = 24 * 60 * 60 * 1000;
export const historyKey = (scope: string) => `printshopledger:history-check:v2:${scope}`;

export function readHistoryResults(scope: string): HistoryResults | null {
  try {
    const value = JSON.parse(localStorage.getItem(historyKey(scope)) ?? 'null');
    return Array.isArray(value) && value.length ? value : null;
  } catch {
    return null;
  }
}
/** Run the check now and keep the results. */
export function runHistoryCheck(scope: string, ledger: Ledger) {
  const results = historyChecks(ledger);
  try {
    localStorage.setItem(historyKey(scope), JSON.stringify(results));
  } catch {}
  return results;
}
const due = (scope: string) => {
  const last = readHistoryResults(scope);
  return !last || Date.now() - Date.parse(last[0].checkedAt) > DAY;
};
let scheduled = '';
/**
 * Once a day, after a sync, when the device is idle: run the check in the background.
 * Resolves true when it ran (so the device can report the new results).
 */
export function historyCheckIfDue(scope: string, ledger: Ledger): Promise<boolean> {
  if (!scope || !due(scope) || scheduled === scope) return Promise.resolve(false);
  scheduled = scope;
  return new Promise((resolve) => {
    const work = () => {
      try {
        if (due(scope)) {
          runHistoryCheck(scope, ledger);
          resolve(true);
        } else resolve(false);
      } catch {
        resolve(false);
      } finally {
        scheduled = '';
      }
    };
    // Wait until the device is not busy (or at most 30 seconds).
    if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 30000 });
    else setTimeout(work, 5000);
  });
}
