import { sameEvent } from './sale-adjustments.mjs';
import { acknowledgeReviews, blockedWork, projectPending } from './sync-dependencies.mjs';
import { mergeChanges, needsFullSync } from './sync-delta.mjs';
import { requireConflictReviewer } from './conflict-review';
import { resolveExpenseState } from './expense-conflicts.mjs';
import { checkoutReviewBase, replacePendingCheckout, adoptJobStatus } from './checkout-conflicts.mjs';
import { createClient } from '@supabase/supabase-js';
import { applyEvent } from './domain.mjs';
import { mutateState, readState } from './storage';
import { normalizeLedger } from './materials.mjs';
import { resolveMaterialState } from './material-conflicts.mjs';
import { resolveServiceState } from './service-conflicts.mjs';
import { resolveCustomerState } from './customer-conflicts.mjs';
import type {
  CorrectionRequest,
  Ledger,
  Material,
  Service,
  Customer,
  CheckoutEvent,
  LedgerEvent,
  Expense,
  SupervisedEvent,
} from './types';

export class ExpenseSyncConflict extends Error {
  constructor(
    public local: Expense,
    public remote: Expense | null,
    public cloud: Ledger,
  ) {
    super('This expense or its material units changed on another device. Review it before continuing sync.');
  }
}
export class MaterialSyncConflict extends Error {
  constructor(
    public local: Material,
    public remote: Material,
  ) {
    super('This material was changed on another device. Choose which version to keep.');
  }
}

export class ServiceSyncConflict extends Error {
  constructor(
    public local: Service,
    public remote: Service | null,
    public materials: Material[],
  ) {
    super(
      'Review this service against the latest business version and base materials before continuing sync.',
    );
  }
}
export class CustomerSyncConflict extends Error {
  constructor(
    public local: Customer,
    public remote: Customer | null,
  ) {
    super('This customer changed on another device. Review both versions before continuing sync.');
  }
}
export class CheckoutSyncConflict extends Error {
  constructor(
    public event: CheckoutEvent,
    public cloud: Ledger,
  ) {
    super('Review the pending checkout against the latest prices and customer account.');
  }
}
export class JobSyncConflict extends Error {
  constructor(
    public event: LedgerEvent,
    public cloud: Ledger,
  ) {
    super('This job status changed on another device. Review the latest status.');
  }
}
// A password-reset email link opens the app with type=recovery. Read it before the business
// client consumes the link, so the app can ask for the new password.
export const passwordRecoveryLink =
  typeof window !== 'undefined' &&
  /(^|[#?&])type=recovery(&|$)/.test(window.location.hash + window.location.search);
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Only the business client may adopt a session from an email link. If both clients read
// the same link they would share one single-use refresh token and sign each other out.
export const supabase = url && key ? createClient(url, key, { auth: { detectSessionInUrl: false } }) : null;
// Business identity remains signed in while the operational staff session changes.
export const businessAuth =
  url && key ? createClient(url, key, { auth: { storageKey: 'printshopledger-business-auth' } }) : null;
// The developer console signs in on its own, never with a business's account.
export const consoleAuth =
  url && key ? createClient(url, key, { auth: { storageKey: 'printshopledger-console-auth' } }) : null;

async function synchronize(scope: string, shopId: string) {
  if (!supabase || !navigator.onLine) throw Error('Connect to the internet to sync.');
  const check = async () => {
    const { data, error } = await supabase!.auth.getSession();
    if (error || data.session?.user.id !== scope.split(':')[0])
      throw Error('Your sign-in changed. Sign in again before syncing this workspace.');
  };
  await check();
  let state = await readState(scope);
  const conflictIds = Object.keys(state.syncConflicts ?? {});
  if (conflictIds.length) {
    const { data, error } = await supabase
      .rpc('list_sync_conflicts', { p_shop: shopId, p_events: conflictIds })
      .abortSignal(AbortSignal.timeout(30000));
    if (error) throw Error(error.message);
    await check();
    const known = new Set((data as RemoteConflict[]).map((item) => item.event_id));
    for (const id of conflictIds.filter((id) => !known.has(id))) {
      const event = state.pending.find((item) => item.id === id);
      if (!event) continue;
      const { error: uploadError } = await supabase
        .rpc('submit_sync_conflict', { p_shop: shopId, p_event: event, p_message: state.syncConflicts![id] })
        .abortSignal(AbortSignal.timeout(30000));
      if (uploadError)
        throw Error('Could not send the held operation for remote review: ' + uploadError.message);
      await check();
    }
    const resolved = new Set(
      (data as RemoteConflict[]).filter((item) => item.status === 'resolved').map((item) => item.event_id),
    );
    if (resolved.size) {
      const { data: latest, error: readError } = await supabase
        .rpc('get_ledger', { p_shop: shopId })
        .abortSignal(AbortSignal.timeout(60000));
      if (readError) throw Error(readError.message);
      await check();
      state = await mutateState(scope, (current) =>
        acknowledgeReviews(
          current,
          normalizeLedger(latest),
          (data as RemoteConflict[]).filter((item) => resolved.has(item.event_id)),
        ),
      );
    }
  }
  for (const event of state.pending) {
    await check();
    const current = await readState(scope);
    if (!current.pending.some((item) => item.id === event.id) || blockedWork(current).eventIds.has(event.id))
      continue;
    const { error } = await supabase
      .rpc(
        event.kind === 'job.due_changed' ||
          event.kind.startsWith('payee.') ||
          event.kind.startsWith('account.')
          ? 'apply_operations_event'
          : event.kind.startsWith('expense.')
            ? 'apply_expense_event'
            : event.kind.startsWith('quotation.')
              ? 'apply_quotation_event'
              : event.kind === 'customer.reminded'
                ? 'apply_reminder_event'
                : event.kind === 'checkout.completed'
                  ? 'apply_checkout_event'
                  : event.kind === 'job.status_changed'
                    ? 'apply_job_status_event'
                    : event.kind === 'job.material_used'
                      ? 'apply_job_material_event'
                      : event.kind.startsWith('customer.')
                        ? 'apply_customer_event'
                        : event.kind.startsWith('material.')
                          ? 'apply_material_event'
                          : event.kind.startsWith('service.')
                            ? 'apply_service_event'
                            : 'apply_ledger_event',
        { p_shop: shopId, p_event: event },
      )
      .abortSignal(AbortSignal.timeout(30000));
    if (error && ['PT409', '40001', 'P0002'].includes(error.code)) {
      // Upload only after the server rejects an operation, and persist the hold before proceeding.
      await check();
      await mutateState(scope, (current) => ({
        ...current,
        syncConflicts: { ...current.syncConflicts, [event.id]: error.message },
      }));
      const { error: uploadError } = await supabase
        .rpc('submit_sync_conflict', { p_shop: shopId, p_event: event, p_message: error.message })
        .abortSignal(AbortSignal.timeout(30000));
      if (uploadError)
        throw Error(
          'Could not send the conflict for remote review: ' +
            uploadError.message +
            '. Pending work is saved locally.',
        );
      await check();
      continue;
    }
    if (error) throw Error('Sync paused: ' + error.message + '. Your pending work is still saved locally.');
    await check();
    await mutateState(scope, (current) => ({
      ...current,
      pending: current.pending.filter((item) => item.id !== event.id),
    }));
  }
  await check();
  // Download only what changed since the last sync when this device's copy is exactly the
  // business copy; otherwise (first sync, unsent or held work, every half hour) everything.
  const before = await readState(scope);
  const full = needsFullSync(before);
  const { data, error } = await supabase
    .rpc('get_ledger_changes', { p_shop: shopId, p_since: full ? null : before.syncCursor })
    .abortSignal(AbortSignal.timeout(60000));
  if (error) throw Error(error.message);
  await check();
  const now = new Date().toISOString();
  const result = data as { cursor: string; full: boolean; ledger: Partial<Ledger> };
  return mutateState(scope, (current) => {
    if (result.full)
      return {
        ...current,
        ledger: projectPending(normalizeLedger(result.ledger as Ledger), current),
        syncCursor: result.cursor,
        fullSyncAt: now,
        lastSynced: now,
      };
    // Work started on this device while the changes were downloading: keep the cursor, so the
    // next sync (which sends that work) downloads these changes again with everything else.
    if (current.pending.length || current.syncCursor !== before.syncCursor) return current;
    return {
      ...current,
      ledger: normalizeLedger(
        mergeChanges(current.ledger, result.ledger as unknown as Record<string, unknown[]>) as Ledger,
      ),
      syncCursor: result.cursor,
      lastSynced: now,
    };
  });
}
export type RemoteConflict = {
  event_id: string;
  actor_id: string;
  actor_label: string;
  source: LedgerEvent;
  message: string;
  status: 'pending' | 'resolved';
  submitted_at: string;
  resolved_at: string | null;
  reviewer_label: string | null;
  decision: string | null;
  reason: string | null;
  replacements: LedgerEvent[] | null;
};
export async function listRemoteConflicts(scope: string, shopId: string) {
  const client = await requireConflictReviewer(supabase!, scope, shopId);
  const { data, error } = await client
    .rpc('list_sync_conflicts', { p_shop: shopId })
    .abortSignal(AbortSignal.timeout(30000));
  if (error) throw Error(error.message);
  return data as RemoteConflict[];
}
export async function getRemoteConflict(scope: string, shopId: string, eventId: string) {
  const client = await requireConflictReviewer(supabase!, scope, shopId);
  const { data, error } = await client
    .rpc('get_sync_conflict', { p_shop: shopId, p_event: eventId })
    .abortSignal(AbortSignal.timeout(30000));
  if (error) throw Error(error.message);
  return { ...data, ledger: normalizeLedger(data.ledger) } as {
    conflict: RemoteConflict;
    ledger: Ledger;
    token: string;
  };
}
export async function resolveRemoteConflict(
  scope: string,
  shopId: string,
  eventId: string,
  token: string,
  replacements: LedgerEvent[],
  reason: string,
) {
  const client = await requireConflictReviewer(supabase!, scope, shopId);
  const { error } = await client
    .rpc('resolve_sync_conflict', {
      p_shop: shopId,
      p_event: eventId,
      p_token: token,
      p_replacements: replacements,
      p_reason: reason,
    })
    .abortSignal(AbortSignal.timeout(30000));
  if (error) throw Error(error.message);
}

/** Sync all: the next sync downloads the whole business again instead of only the changes. */
export const requestFullSync = (scope: string) =>
  mutateState(scope, ({ fullSyncAt: _full, ...current }) => current);
export async function syncLedger(scope: string, shopId: string) {
  if (!navigator.locks) throw new Error('Cloud sync requires a browser with Web Locks support.');
  return navigator.locks.request(`printshopledger-sync:${scope}`, () => synchronize(scope, shopId));
}

export async function resolveCloudMaterial(
  scope: string,
  shopId: string,
  materialId: string,
  choice: 'local' | 'cloud',
  reviewedLocalEvent: string,
  reviewedRemoteEvent: string,
) {
  if (!supabase || !navigator.onLine || !navigator.locks)
    throw new Error('Connect to the internet to resolve this edit.');
  await requireConflictReviewer(supabase, scope, shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0])
      throw new Error('Your sign-in changed. Sign in again.');
    const { data, error } = await supabase!
      .rpc('get_ledger', { p_shop: shopId })
      .abortSignal(AbortSignal.timeout(60000));
    if (error) throw new Error(error.message);
    const { data: checked } = await supabase!.auth.getSession();
    if (checked.session?.user.id !== scope.split(':')[0])
      throw new Error('Your sign-in changed. Sign in again.');
    return mutateState(scope, (state) => {
      const remote = (data as Ledger).materials.find((item) => item.id === materialId);
      const local = state.ledger.materials.find((item) => item.id === materialId);
      if (!remote || !local) throw new Error('Material no longer available. Sync again.');
      if (remote.lastEventId !== reviewedRemoteEvent || local.lastEventId !== reviewedLocalEvent)
        throw new MaterialSyncConflict(local, remote);
      return resolveMaterialState(
        state,
        normalizeLedger(data as Ledger),
        materialId,
        choice,
        () => crypto.randomUUID(),
        new Date().toISOString(),
      );
    });
  });
}

export async function resolveCloudService(
  scope: string,
  shopId: string,
  serviceId: string,
  choice: 'local' | 'cloud',
  reviewedLocalEvent: string,
  reviewedRemoteEvent: string | null,
  materialId: string | null,
) {
  if (!supabase || !navigator.onLine || !navigator.locks)
    throw new Error('Connect to the internet to resolve this service.');
  await requireConflictReviewer(supabase, scope, shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0])
      throw new Error('Your sign-in changed. Sign in again.');
    const { data, error } = await supabase!
      .rpc('get_ledger', { p_shop: shopId })
      .abortSignal(AbortSignal.timeout(60000));
    if (error) throw new Error(error.message);
    const { data: checked, error: checkError } = await supabase!.auth.getSession();
    if (checkError || checked.session?.user.id !== scope.split(':')[0])
      throw new Error('Your sign-in changed. Sign in again.');
    const cloud = normalizeLedger(data as Ledger);
    return mutateState(scope, (state) => {
      const local = state.ledger.services.find((item) => item.id === serviceId);
      const remote = cloud.services.find((item: Service) => item.id === serviceId) ?? null;
      if (!local) throw new Error('Local service is no longer available. Sync again.');
      if (local.lastEventId !== reviewedLocalEvent || (remote?.lastEventId ?? null) !== reviewedRemoteEvent)
        throw new ServiceSyncConflict(local, remote, cloud.materials);
      try {
        return resolveServiceState(
          state,
          cloud,
          serviceId,
          choice,
          materialId,
          () => crypto.randomUUID(),
          new Date().toISOString(),
        );
      } catch (cause) {
        if (cause instanceof Error && /Choose.*(base material|active)/.test(cause.message))
          throw new ServiceSyncConflict(local, remote, cloud.materials);
        throw cause;
      }
    });
  });
}

export async function resolveCloudCustomer(
  scope: string,
  shopId: string,
  customerId: string,
  choice: 'local' | 'cloud',
  reviewedLocalEvent: string | null,
  reviewedRemoteEvent: string | null,
) {
  if (!supabase || !navigator.onLine || !navigator.locks)
    throw new Error('Connect to the internet to resolve this customer.');
  await requireConflictReviewer(supabase, scope, shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0])
      throw new Error('Your sign-in changed. Sign in again.');
    const { data, error } = await supabase!
      .rpc('get_ledger', { p_shop: shopId })
      .abortSignal(AbortSignal.timeout(60000));
    if (error) throw new Error(error.message);
    const { data: checked, error: checkError } = await supabase!.auth.getSession();
    if (checkError || checked.session?.user.id !== scope.split(':')[0])
      throw new Error('Your sign-in changed. Sign in again.');
    const cloud = normalizeLedger(data as Ledger);
    return mutateState(scope, (state) => {
      const local = state.ledger.customers.find((item) => item.id === customerId);
      const remote = cloud.customers.find((item: Customer) => item.id === customerId) ?? null;
      if (!local) throw new Error('Local customer is no longer available. Sync again.');
      if (local.lastEventId !== reviewedLocalEvent || (remote?.lastEventId ?? null) !== reviewedRemoteEvent)
        throw new CustomerSyncConflict(local, remote);
      return resolveCustomerState(
        state,
        cloud,
        customerId,
        choice,
        () => crypto.randomUUID(),
        new Date().toISOString(),
      );
    });
  });
}

export async function resolvePendingWork(
  scope: string,
  shopId: string,
  eventId: string,
  replacement: CheckoutEvent | null,
  jobId?: string,
) {
  if (!supabase || !navigator.onLine || !navigator.locks)
    throw Error('Connect to the internet to review this pending work.');
  const reviewer = await requireConflictReviewer(supabase, scope, shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const check = async () => {
      const { data, error } = await supabase!.auth.getSession();
      if (error || data.session?.user.id !== scope.split(':')[0])
        throw Error('Your sign-in changed. Sign in again.');
    };
    await check();
    const { data, error } = await supabase!
      .rpc('get_ledger', { p_shop: shopId })
      .abortSignal(AbortSignal.timeout(60000));
    if (error) throw Error(error.message);
    await check();
    const cloud = normalizeLedger(data);
    if (replacement) {
      const { error: approvalError } = await reviewer
        .rpc('approve_checkout_review', { p_shop: shopId, p_event: replacement })
        .abortSignal(AbortSignal.timeout(30000));
      if (approvalError) throw Error(approvalError.message);
      await check();
    }
    return mutateState(scope, (state) => {
      try {
        return replacement
          ? replacePendingCheckout(state, cloud, eventId, replacement)
          : adoptJobStatus(state, cloud, jobId!);
      } catch (cause) {
        const event = state.pending.find((e) => e.id === eventId);
        if (event?.kind === 'checkout.completed') throw new CheckoutSyncConflict(event, cloud);
        throw cause;
      }
    });
  });
}
export { checkoutReviewBase };

export async function resolveCloudExpense(
  scope: string,
  shopId: string,
  expenseId: string,
  choice: 'local' | 'cloud',
  reviewedLocal: string,
  reviewedRemote: string | null,
) {
  if (!supabase || !navigator.onLine || !navigator.locks)
    throw Error('Connect to the internet to review this expense.');
  await requireConflictReviewer(supabase, scope, shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const check = async () => {
      const { data, error } = await supabase!.auth.getSession();
      if (error || data.session?.user.id !== scope.split(':')[0])
        throw Error('Your sign-in changed. Sign in again.');
    };
    await check();
    const { data, error } = await supabase!
      .rpc('get_ledger', { p_shop: shopId })
      .abortSignal(AbortSignal.timeout(60000));
    if (error) throw Error(error.message);
    await check();
    const cloud = normalizeLedger(data);
    return mutateState(scope, (state) => {
      const local = state.ledger.expenses.find((item) => item.id === expenseId),
        remote = cloud.expenses.find((item: Expense) => item.id === expenseId) ?? null;
      if (!local) throw Error('Local expense no longer exists.');
      if (local.lastEventId !== reviewedLocal || (remote?.lastEventId ?? null) !== reviewedRemote)
        throw new ExpenseSyncConflict(local, remote, cloud);
      return resolveExpenseState(state, cloud, expenseId, choice, () => crypto.randomUUID());
    });
  });
}

// Supervisor transactions are online-only. The shared sync lock prevents a second sync
// from projecting an old response over an approved revision.
// requestId: approving a cashier's correction request (the event is the request, refreshed).
export async function saveSupervisedEvent(
  scope: string,
  shopId: string,
  event: SupervisedEvent,
  requestId?: string,
) {
  if (!supabase || !navigator.onLine || !navigator.locks) throw Error('Connect to approve this action.');
  await requireConflictReviewer(supabase, scope, shopId);
  await syncLedger(scope, shopId);
  return navigator.locks.request(`printshopledger-sync:${scope}`, async () => {
    const current = await readState(scope);
    if (current.pending.length || Object.keys(current.syncConflicts ?? {}).length)
      throw Error('Finish syncing and resolving pending work before approving this action.');
    const { data: auth, error: authError } = await supabase!.auth.getSession();
    if (authError || auth.session?.user.id !== scope.split(':')[0])
      throw Error('Your sign-in changed. Reopen the workspace.');
    const { data, error } = await (requestId
      ? supabase!.rpc('approve_correction_request', { p_shop: shopId, p_request: requestId, p_event: event })
      : supabase!.rpc('apply_supervised_event', { p_shop: shopId, p_event: event })
    ).abortSignal(AbortSignal.timeout(30000));
    if (error) {
      // A network failure can happen after the transaction committed. Confirm its ID
      // before reporting failure; never create another refund automatically.
      const { data: latest, error: readError } = await supabase!
        .rpc('get_ledger', { p_shop: shopId })
        .abortSignal(AbortSignal.timeout(60000));
      const saved =
        !readError &&
        [...(latest?.saleAdjustments ?? []), ...(latest?.materialWaste ?? [])].find(
          (r: { id: string }) => r.id === event.id,
        );
      const { data: confirmedAuth } = await supabase!.auth.getSession();
      if (confirmedAuth.session?.user.id !== scope.split(':')[0])
        throw Error('Your sign-in changed. Reopen the original workspace to confirm the action.');
      if (!saved || !sameEvent(saved.event, event))
        throw Error(
          error.message +
            ' Reopen after syncing if the record changed; retry the same action if confirmation was interrupted.',
        );
      return mutateState(scope, (state) => ({
        ...state,
        ledger: projectPending(normalizeLedger(latest), state),
        lastSynced: new Date().toISOString(),
      }));
    }
    const { data: now } = await supabase!.auth.getSession();
    if (now.session?.user.id !== scope.split(':')[0])
      throw Error('Action saved in the original workspace. Your sign-in changed.');
    return mutateState(scope, (state) => ({
      ...state,
      ledger: projectPending(normalizeLedger(data), state),
      lastSynced: new Date().toISOString(),
    }));
  });
}

// Correction requests (online only): cashiers ask for a correction on their own sale; an Admin or
// higher approves (saveSupervisedEvent with the request ID) or rejects it.
async function requestRpc(name: string, args: Record<string, unknown>): Promise<CorrectionRequest[]> {
  if (!supabase || !navigator.onLine) throw Error('Connect to the internet to use correction requests.');
  const { data, error } = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(30000));
  if (error) throw Error(error.message);
  return (data ?? []) as CorrectionRequest[];
}
export const listCorrectionRequests = (shopId: string) =>
  requestRpc('list_correction_requests', { p_shop: shopId });
export const submitCorrectionRequest = (shopId: string, event: SupervisedEvent) =>
  requestRpc('submit_correction_request', { p_shop: shopId, p_event: event });
export const withdrawCorrectionRequest = (shopId: string, requestId: string) =>
  requestRpc('withdraw_correction_request', { p_shop: shopId, p_request: requestId });
export const rejectCorrectionRequest = (shopId: string, requestId: string, note: string) =>
  requestRpc('reject_correction_request', { p_shop: shopId, p_request: requestId, p_note: note });
