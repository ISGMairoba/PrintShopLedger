import { createClient } from '@supabase/supabase-js';
import { applyEvent } from './domain.mjs';
import { mutateState, readState } from './storage';
import type { Ledger } from './types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;

async function synchronize(scope: string, shopId: string) {
  if (!supabase || !navigator.onLine) throw new Error('Connect to the internet to sync.');
  const expectedUser = scope.split(':')[0];
  async function requireSameUser() {
    const { data, error } = await supabase!.auth.getSession();
    if (error || data.session?.user.id !== expectedUser) throw new Error('Your sign-in changed. Sign in again before syncing this workspace.');
  }
  await requireSameUser();
  let state = await readState(scope);
  // Stable UUIDs make retries safe. Failed operations remain in the outbox.
  for (const event of state.pending) {
    await requireSameUser();
    const { error } = await supabase.rpc('apply_ledger_event', { p_shop: shopId, p_event: event });
    if (error) throw new Error(`Sync paused: ${error.message}. Your pending work is still saved locally.`);
    await mutateState(scope, current => ({ ...current, pending: current.pending.filter(item => item.id !== event.id) }));
  }
  await requireSameUser();
  const { data, error } = await supabase.rpc('get_ledger', { p_shop: shopId });
  if (error) throw new Error(error.message);
  await requireSameUser();
  state = await mutateState(scope, current => {
    let ledger = data as Ledger;
    // Preserve work added by another tab while the download was in flight.
    for (const event of current.pending) ledger = applyEvent(ledger, event);
    return { ...current, ledger, lastSynced: new Date().toISOString() };
  });
  return state;
}
export async function syncLedger(scope: string, shopId: string) {
  if (!navigator.locks) throw new Error('Cloud sync requires a browser with Web Locks support.');
  return navigator.locks.request(`printshopledger-sync:${scope}`, () => synchronize(scope, shopId));
}
