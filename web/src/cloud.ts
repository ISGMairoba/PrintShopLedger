import { createClient } from '@supabase/supabase-js';
import { applyEvent } from './domain.mjs';
import { mutateState, readState } from './storage';
import { normalizeLedger } from './materials.mjs';
import { resolveMaterialState } from './material-conflicts.mjs';
import { resolveServiceState } from './service-conflicts.mjs';
import { resolveCustomerState } from './customer-conflicts.mjs';
import type { Ledger, Material, Service, Customer } from './types';

export class MaterialSyncConflict extends Error {
  constructor(public local: Material, public remote: Material) { super('This material was changed on another device. Choose which version to keep.'); }
}

export class ServiceSyncConflict extends Error {
  constructor(public local: Service, public remote: Service | null, public materials: Material[]) {
    super('Review this service against the latest business version and base materials before continuing sync.');
  }
}
export class CustomerSyncConflict extends Error {
  constructor(public local: Customer, public remote: Customer | null) { super('This customer changed on another device. Review both versions before continuing sync.'); }
}
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
// Business identity remains signed in while the operational staff session changes.
export const businessAuth = url && key ? createClient(url, key, { auth: { storageKey: 'printshopledger-business-auth' } }) : null;

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
    const { error } = await supabase.rpc(event.kind.startsWith('customer.') ? 'apply_customer_event' : event.kind.startsWith('material.') ? 'apply_material_event' : event.kind.startsWith('service.') ? 'apply_service_event' : 'apply_ledger_event', { p_shop: shopId, p_event: event }).abortSignal(AbortSignal.timeout(20000));
    if (error && ['40001', 'P0002'].includes(error.code) && event.kind.startsWith('customer.')) {
      await requireSameUser();
      const { data, error: readError } = await supabase.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
      if (readError) throw new Error(readError.message);
      await requireSameUser();
      const cloud = normalizeLedger(data as Ledger);
      const local = (await readState(scope)).ledger.customers.find(item => item.id === event.data.id);
      if (local) throw new CustomerSyncConflict(local, cloud.customers.find((item: Customer) => item.id === event.data.id) ?? null);
    }
    if (error && ['40001', 'P0002'].includes(error.code) && event.kind.startsWith('service.')) {
      await requireSameUser();
      const { data, error: readError } = await supabase.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
      if (readError) throw new Error(readError.message);
      await requireSameUser();
      const remote = (data as Ledger).services.find(item => item.id === event.data.id) ?? null;
      const local = (await readState(scope)).ledger.services.find(item => item.id === event.data.id);
      if (local) throw new ServiceSyncConflict(local, remote, (data as Ledger).materials);
    }
    if (error?.code === '40001' && event.kind.startsWith('material.')) {
      await requireSameUser();
      const { data, error: readError } = await supabase.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
      if (readError) throw new Error(readError.message);
      const remote = (data as Ledger).materials.find(item => item.id === event.data.id);
      const local = (await readState(scope)).ledger.materials.find(item => item.id === event.data.id);
      if (remote && local) throw new MaterialSyncConflict(local, remote);
    }
    if (error) throw new Error(`Sync paused: ${error.message}. Your pending work is still saved locally.`);
    await mutateState(scope, current => ({ ...current, pending: current.pending.filter(item => item.id !== event.id) }));
  }
  await requireSameUser();
  const { data, error } = await supabase.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
  if (error) throw new Error(error.message);
  await requireSameUser();
  state = await mutateState(scope, current => {
    let ledger: Ledger = normalizeLedger(data as Ledger);
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

export async function resolveCloudMaterial(scope: string, shopId: string, materialId: string, choice: 'local' | 'cloud', reviewedLocalEvent: string, reviewedRemoteEvent: string) {
  if (!supabase || !navigator.onLine || !navigator.locks) throw new Error('Connect to the internet to resolve this edit.');
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0]) throw new Error('Your sign-in changed. Sign in again.');
    const { data, error } = await supabase!.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
    if (error) throw new Error(error.message);
    const { data: checked } = await supabase!.auth.getSession();
    if (checked.session?.user.id !== scope.split(':')[0]) throw new Error('Your sign-in changed. Sign in again.');
    return mutateState(scope, state => {
      const remote = (data as Ledger).materials.find(item => item.id === materialId);
      const local = state.ledger.materials.find(item => item.id === materialId);
      if (!remote || !local) throw new Error('Material no longer available. Sync again.');
      if (remote.lastEventId !== reviewedRemoteEvent || local.lastEventId !== reviewedLocalEvent) throw new MaterialSyncConflict(local, remote);
      return resolveMaterialState(state, normalizeLedger(data as Ledger), materialId, choice, () => crypto.randomUUID(), new Date().toISOString());
    });
  });
}

export async function resolveCloudService(scope: string, shopId: string, serviceId: string, choice: 'local' | 'cloud',
  reviewedLocalEvent: string, reviewedRemoteEvent: string | null, materialId: string) {
  if (!supabase || !navigator.onLine || !navigator.locks) throw new Error('Connect to the internet to resolve this service.');
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0]) throw new Error('Your sign-in changed. Sign in again.');
    const { data, error } = await supabase!.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
    if (error) throw new Error(error.message);
    const { data: checked, error: checkError } = await supabase!.auth.getSession();
    if (checkError || checked.session?.user.id !== scope.split(':')[0]) throw new Error('Your sign-in changed. Sign in again.');
    const cloud = normalizeLedger(data as Ledger);
    return mutateState(scope, state => {
      const local = state.ledger.services.find(item => item.id === serviceId);
      const remote = cloud.services.find((item: Service) => item.id === serviceId) ?? null;
      if (!local) throw new Error('Local service is no longer available. Sync again.');
      if (local.lastEventId !== reviewedLocalEvent || (remote?.lastEventId ?? null) !== reviewedRemoteEvent) throw new ServiceSyncConflict(local, remote, cloud.materials);
      try { return resolveServiceState(state, cloud, serviceId, choice, materialId, () => crypto.randomUUID(), new Date().toISOString()); }
      catch (cause) {
        if (cause instanceof Error && /Choose.*(base material|active)/.test(cause.message)) throw new ServiceSyncConflict(local, remote, cloud.materials);
        throw cause;
      }
    });
  });
}

export async function resolveCloudCustomer(scope: string, shopId: string, customerId: string, choice: 'local' | 'cloud',
  reviewedLocalEvent: string | null, reviewedRemoteEvent: string | null) {
  if (!supabase || !navigator.onLine || !navigator.locks) throw new Error('Connect to the internet to resolve this customer.');
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0]) throw new Error('Your sign-in changed. Sign in again.');
    const { data, error } = await supabase!.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
    if (error) throw new Error(error.message);
    const { data: checked, error: checkError } = await supabase!.auth.getSession();
    if (checkError || checked.session?.user.id !== scope.split(':')[0]) throw new Error('Your sign-in changed. Sign in again.');
    const cloud = normalizeLedger(data as Ledger);
    return mutateState(scope, state => {
      const local = state.ledger.customers.find(item => item.id === customerId);
      const remote = cloud.customers.find((item: Customer) => item.id === customerId) ?? null;
      if (!local) throw new Error('Local customer is no longer available. Sync again.');
      if (local.lastEventId !== reviewedLocalEvent || (remote?.lastEventId ?? null) !== reviewedRemoteEvent) throw new CustomerSyncConflict(local, remote);
      return resolveCustomerState(state, cloud, customerId, choice, () => crypto.randomUUID(), new Date().toISOString());
    });
  });
}
