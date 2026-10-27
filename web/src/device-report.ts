// This device tells the developer console who is using it and how its sync is doing, at most
// every few minutes (or sooner when its unsent work changes). The console can ask it to sign out.
import { supabase } from './cloud';
import { deviceName } from './device-name.mjs';
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
/** The latest History check on this device, in brief. */
function historySummary(scope: string) {
  try {
    const results = JSON.parse(localStorage.getItem(`printshopledger:history-check:v2:${scope}`) ?? 'null');
    if (!Array.isArray(results) || !results.length) return {};
    return {
      checkedAt: results[0].checkedAt,
      checked: results.reduce((n: number, r: { checked: number }) => n + r.checked, 0),
      differing: results.reduce((n: number, r: { differences: unknown[] }) => n + r.differences.length, 0),
    };
  } catch {
    return {};
  }
}

/**
 * Report this device after a sync. Resolves to true when the console asked it to sign out.
 * Never throws: a failed report only waits for the next sync.
 */
export async function reportDevice(scope: string, shopId: string, state: LocalState, force = false) {
  const id = deviceId();
  if (!supabase || !id) return false;
  const held = Object.keys(state.syncConflicts ?? {}).length;
  const key = `${shopId}:${state.pending.length}:${held}`;
  if (!force && key === last.key && Date.now() - last.at < EVERY) return false;
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
    if (error) return false;
    last = { at: Date.now(), key };
    return !!(data as { signOut?: boolean } | null)?.signOut;
  } catch {
    return false;
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
