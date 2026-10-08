import {requireConflictReviewer} from './conflict-review';
import { resolveExpenseState } from './expense-conflicts.mjs';
import { checkoutReviewBase, replacePendingCheckout, adoptJobStatus } from './checkout-conflicts.mjs';
import { createClient } from '@supabase/supabase-js';
import { applyEvent } from './domain.mjs';
import { mutateState, readState } from './storage';
import { normalizeLedger } from './materials.mjs';
import { resolveMaterialState } from './material-conflicts.mjs';
import { resolveServiceState } from './service-conflicts.mjs';
import { resolveCustomerState } from './customer-conflicts.mjs';
import type { Ledger, Material, Service, Customer, CheckoutEvent, LedgerEvent, Expense } from './types';

export class ExpenseSyncConflict extends Error {
 constructor(public local:Expense,public remote:Expense|null,public cloud:Ledger){super('This expense or its material units changed on another device. Review it before continuing sync.');}
}
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
export class CheckoutSyncConflict extends Error {constructor(public event:CheckoutEvent,public cloud:Ledger){super('Review the pending checkout against the latest prices and customer account.');}}
export class JobSyncConflict extends Error {constructor(public event:LedgerEvent,public cloud:Ledger){super('This job status changed on another device. Review the latest status.');}}
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
    const { error } = await supabase.rpc(event.kind.startsWith('expense.') ? 'apply_expense_event' : event.kind==='checkout.completed' ? 'apply_checkout_event' : event.kind==='job.status_changed' ? 'apply_job_status_event' : event.kind.startsWith('customer.') ? 'apply_customer_event' : event.kind.startsWith('material.') ? 'apply_material_event' : event.kind.startsWith('service.') ? 'apply_service_event' : 'apply_ledger_event', { p_shop: shopId, p_event: event }).abortSignal(AbortSignal.timeout(20000));
    if (error && ['PT409','40001','P0002'].includes(error.code) && event.kind.startsWith('expense.')) {
      const {data,error:readError}=await supabase.rpc('get_ledger',{p_shop:shopId}).abortSignal(AbortSignal.timeout(20000));
      if(readError)throw Error(readError.message);await requireSameUser();
      const cloud=normalizeLedger(data);const local=(await readState(scope)).ledger.expenses.find(item=>item.id===event.data.id);
      if(local)throw new ExpenseSyncConflict(local,cloud.expenses.find((item:Expense)=>item.id===local.id)??null,cloud);
    }
    if(error && ['PT409','40001'].includes(error.code)&&(event.kind==='checkout.completed'||event.kind==='job.status_changed')){
      const {data,error:readError}=await supabase.rpc('get_ledger',{p_shop:shopId}).abortSignal(AbortSignal.timeout(20000));
      if(readError)throw Error(readError.message);await requireSameUser();
      if(event.kind==='checkout.completed')throw new CheckoutSyncConflict(event,normalizeLedger(data));
      throw new JobSyncConflict(event,normalizeLedger(data));
    }
    if (error && ['PT409', '40001', 'P0002'].includes(error.code) && event.kind.startsWith('customer.')) {
      await requireSameUser();
      const { data, error: readError } = await supabase.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
      if (readError) throw new Error(readError.message);
      await requireSameUser();
      const cloud = normalizeLedger(data as Ledger);
      const local = (await readState(scope)).ledger.customers.find(item => item.id === event.data.id);
      if (local) throw new CustomerSyncConflict(local, cloud.customers.find((item: Customer) => item.id === event.data.id) ?? null);
    }
    if (error && ['PT409', '40001', 'P0002'].includes(error.code) && event.kind.startsWith('service.')) {
      await requireSameUser();
      const { data, error: readError } = await supabase.rpc('get_ledger', { p_shop: shopId }).abortSignal(AbortSignal.timeout(20000));
      if (readError) throw new Error(readError.message);
      await requireSameUser();
      const remote = (data as Ledger).services.find(item => item.id === event.data.id) ?? null;
      const local = (await readState(scope)).ledger.services.find(item => item.id === event.data.id);
      if (local) throw new ServiceSyncConflict(local, remote, (data as Ledger).materials);
    }
    if (error && ['PT409', '40001', 'P0002'].includes(error.code) && event.kind.startsWith('material.')) {
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
    for (const event of current.pending) {try{ledger = applyEvent(ledger, event);}catch(error){if(event.kind.startsWith('expense.')){const local=current.ledger.expenses.find(item=>item.id===event.data.id);const cloud=normalizeLedger(data);if(local)throw new ExpenseSyncConflict(local,cloud.expenses.find((item:Expense)=>item.id===local.id)??null,cloud);}if(event.kind==='checkout.completed')throw new CheckoutSyncConflict(event,normalizeLedger(data as Ledger));if(event.kind==='job.status_changed')throw new JobSyncConflict(event,normalizeLedger(data as Ledger));throw error;}}
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
  await requireConflictReviewer(supabase,scope,shopId);
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
  reviewedLocalEvent: string, reviewedRemoteEvent: string | null, materialId: string | null) {
  if (!supabase || !navigator.onLine || !navigator.locks) throw new Error('Connect to the internet to resolve this service.');
  await requireConflictReviewer(supabase,scope,shopId);
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
  await requireConflictReviewer(supabase,scope,shopId);
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


export async function resolvePendingWork(scope:string,shopId:string,eventId:string,replacement:CheckoutEvent|null,jobId?:string){
 if(!supabase||!navigator.onLine||!navigator.locks)throw Error('Connect to the internet to review this pending work.');
 const reviewer=await requireConflictReviewer(supabase,scope,shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`,async()=>{
  const check=async()=>{const {data,error}=await supabase!.auth.getSession();if(error||data.session?.user.id!==scope.split(':')[0])throw Error('Your sign-in changed. Sign in again.');};
  await check();const {data,error}=await supabase!.rpc('get_ledger',{p_shop:shopId}).abortSignal(AbortSignal.timeout(20000));if(error)throw Error(error.message);await check();
  const cloud=normalizeLedger(data);
  if(replacement){const {error:approvalError}=await reviewer.rpc('approve_checkout_review',{p_shop:shopId,p_event:replacement}).abortSignal(AbortSignal.timeout(20000));if(approvalError)throw Error(approvalError.message);await check();}
  return mutateState(scope,state=>{try{return replacement?replacePendingCheckout(state,cloud,eventId,replacement):adoptJobStatus(state,cloud,jobId!);}catch(cause){const event=state.pending.find(e=>e.id===eventId);if(event?.kind==='checkout.completed')throw new CheckoutSyncConflict(event,cloud);throw cause;}});
 });
}
export {checkoutReviewBase};

export async function resolveCloudExpense(scope:string,shopId:string,expenseId:string,choice:'local'|'cloud',reviewedLocal:string,reviewedRemote:string|null){
 if(!supabase||!navigator.onLine||!navigator.locks)throw Error('Connect to the internet to review this expense.');
 await requireConflictReviewer(supabase,scope,shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`,async()=>{
  const check=async()=>{const {data,error}=await supabase!.auth.getSession();if(error||data.session?.user.id!==scope.split(':')[0])throw Error('Your sign-in changed. Sign in again.');};
  await check();const {data,error}=await supabase!.rpc('get_ledger',{p_shop:shopId}).abortSignal(AbortSignal.timeout(20000));if(error)throw Error(error.message);await check();
  const cloud=normalizeLedger(data);
  return mutateState(scope,state=>{
   const local=state.ledger.expenses.find(item=>item.id===expenseId),remote=cloud.expenses.find((item:Expense)=>item.id===expenseId)??null;
   if(!local)throw Error('Local expense no longer exists.');
   if(local.lastEventId!==reviewedLocal||(remote?.lastEventId??null)!==reviewedRemote)throw new ExpenseSyncConflict(local,remote,cloud);
   return resolveExpenseState(state,cloud,expenseId,choice,()=>crypto.randomUUID());
  });
 });
}
