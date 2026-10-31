// This device tells the developer console who is using it and how its sync is doing, at most
// every few minutes (or sooner when its unsent work changes). The console can ask it to sign out.
import { supabase } from './cloud';
import { deviceName } from './device-name.mjs';
import { returnProblems, takeProblems } from './problem-log.mjs';
import { readHistoryResults } from './history-check-store';
import type { LocalState } from './types';

const KEY = 'printshopledger:device-id';
const EVERY = 5 * 60 * 1000;
let last = { at: 0, key: '' };

/** This browser's permanent device id. */
export function deviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
/** The latest History check on this device, in brief, with each window's result. */
function historySummary(scope: string) {
  const results = readHistoryResults(scope);
  if (!results) return {};
  return {
    checkedAt: results[0].checkedAt,
    checked: results.reduce((n, r) => n + r.checked, 0),
    differing: results.reduce((n, r) => n + r.differences.length, 0),
    windows: results.map((r) => ({
      label: r.label,
      cutoff: r.cutoff,
      checked: r.checked,
      differing: r.differences.length,
      leftOut: Object.values(r.dropped as Record<string, number>).reduce((n, v) => n + v, 0),
      differences: r.differences.slice(0, 5).map((d: { what: string }) => d.what),
    })),
  };
}
/**
 * Report this device after a sync. Resolves to { signOut } when the console asked it to sign out,
 * and { deviceLimit } when it is a new device and the business already uses all its devices.
 * Never throws: a failed report only waits for the next sync.
 */
export async function reportDevice(scope: string, shopId: string, state: LocalState, force = false) {
  const id = deviceId();
  const none = { signOut: false, deviceLimit: 0 };
  if (!supabase || !id) return none;
  const held = Object.keys(state.syncConflicts ?? {}).length;
  const key = `${shopId}:${state.pending.length}:${held}`;
  if (!force && key === last.key && Date.now() - last.at < EVERY) return none;
  try {
    const { data, error } = await supabase
      .rpc('report_device', {
        p_shop: shopId,
        p_device: id,
        p_info: {
          name: deviceName(navigator.userAgent),
          appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
          pending: state.pending.length,
          held,
          lastSynced: state.lastSynced ?? null,
          history: historySummary(scope),
        },
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (error) return none;
    const result = (data ?? {}) as { signOut?: boolean; deviceLimit?: number };
    // A refused new device asks again on its next sync.
    if (!result.deviceLimit) last = { at: Date.now(), key };
    return { signOut: !!result.signOut, deviceLimit: Number(result.deviceLimit ?? 0) };
  } catch {
    return none;
  }
}
/** Tell the console this device has signed out. */
export async function confirmSignedOut(shopId: string) {
  const id = deviceId();
  if (!supabase || !id) return;
  await supabase.rpc('ack_device_sign_out', { p_shop: shopId, p_device: id }).then(
    () => undefined,
    () => undefined,
  );
}
/** Send the problems this device noted since the last sync. Never throws. */
export async function sendProblems(shopId: string) {
  const id = deviceId();
  if (!supabase || !id) return;
  const items = takeProblems();
  if (!items.length) return;
  try {
    const { error } = await supabase
      .rpc('report_problems', { p_shop: shopId, p_device: id, p_items: items })
      .abortSignal(AbortSignal.timeout(15000));
    if (error) returnProblems(items);
  } catch {
    returnProblems(items);
  }
}
