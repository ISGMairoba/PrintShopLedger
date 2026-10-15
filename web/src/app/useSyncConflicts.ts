import { useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { LocalState } from '../types';
import type { Shop } from './shared';
import { errorMessage } from './shared';
import {
  ExpenseSyncConflict,
  CheckoutSyncConflict,
  JobSyncConflict,
  CustomerSyncConflict,
  ServiceSyncConflict,
  MaterialSyncConflict,
  resolveCloudExpense,
  resolveCloudMaterial,
  resolveCloudService,
  resolveCloudCustomer,
  resolvePendingWork,
} from '../cloud';

type Options = {
  scope: string;
  shop: Shop | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  activeScope: RefObject<string>;
  channel: RefObject<BroadcastChannel | null>;
  setState: Dispatch<SetStateAction<LocalState>>;
  setMessage: (message: string, tone?: 'success' | 'error' | 'warning') => void;
};

/** The six sync-conflict types and their guarded review operations belong together. */
export default function useSyncConflicts({
  scope,
  shop,
  busy,
  setBusy,
  activeScope,
  channel,
  setState,
  setMessage,
}: Options) {
  const [expenseConflict, setExpenseConflict] = useState<ExpenseSyncConflict | null>(null);
  const [checkoutConflict, setCheckoutConflict] = useState<CheckoutSyncConflict | null>(null);
  const [jobConflict, setJobConflict] = useState<JobSyncConflict | null>(null);
  const [customerConflict, setCustomerConflict] = useState<CustomerSyncConflict | null>(null);
  const [serviceConflict, setServiceConflict] = useState<ServiceSyncConflict | null>(null);
  const [conflict, setConflict] = useState<MaterialSyncConflict | null>(null);

  async function resolveConflict(choice: 'local' | 'cloud') {
    if (!conflict || !shop || busy) return;
    const target = scope;
    setBusy(true);
    try {
      const next = await resolveCloudMaterial(
        target,
        shop.id,
        conflict.local.id,
        choice,
        conflict.local.lastEventId,
        conflict.remote.lastEventId,
      );
      if (activeScope.current === target) {
        setState(next);
        setConflict(null);
        channel.current?.postMessage('changed');
        setMessage('Choice saved. Remaining changes will sync automatically.');
      }
    } catch (error) {
      if (activeScope.current === target) {
        setMessage(errorMessage(error), 'error');
        if (error instanceof MaterialSyncConflict) setConflict(error);
      }
    } finally {
      setBusy(false);
    }
  }
  async function resolveServiceConflict(choice: 'local' | 'cloud', materialId: string | null) {
    if (!serviceConflict || !shop || busy) return;
    const target = scope;
    setBusy(true);
    try {
      const next = await resolveCloudService(
        target,
        shop.id,
        serviceConflict.local.id,
        choice,
        serviceConflict.local.lastEventId,
        serviceConflict.remote?.lastEventId ?? null,
        materialId,
      );
      if (activeScope.current === target) {
        setState(next);
        setServiceConflict(null);
        channel.current?.postMessage('changed');
        setMessage('Choice saved. Remaining changes will sync automatically.');
      }
    } catch (error) {
      if (activeScope.current === target) {
        setMessage(errorMessage(error), 'error');
        if (error instanceof ServiceSyncConflict) setServiceConflict(error);
        if (error instanceof CustomerSyncConflict) setCustomerConflict(error);
      }
    } finally {
      setBusy(false);
    }
  }
  async function resolveExpenseConflict(choice: 'local' | 'cloud') {
    if (!expenseConflict || !shop || busy) return;
    setBusy(true);
    const target = scope;
    try {
      const next = await resolveCloudExpense(
        target,
        shop.id,
        expenseConflict.local.id,
        choice,
        expenseConflict.local.lastEventId,
        expenseConflict.remote?.lastEventId ?? null,
      );
      if (activeScope.current === target) {
        setState(next);
        setExpenseConflict(null);
        channel.current?.postMessage('changed');
        setMessage('Expense review saved. Sync will resume automatically.');
      }
    } catch (error) {
      setMessage(errorMessage(error), 'error');
      if (error instanceof ExpenseSyncConflict) setExpenseConflict(error);
    } finally {
      setBusy(false);
    }
  }
  async function resolveJobConflict() {
    if (!jobConflict || !shop || busy) return;
    setBusy(true);
    const target = scope;
    try {
      const next = await resolvePendingWork(
        target,
        shop.id,
        jobConflict.event.id,
        null,
        jobConflict.event.data.id,
      );
      if (activeScope.current === target) {
        setState(next);
        setJobConflict(null);
        channel.current?.postMessage('changed');
      }
    } catch (error) {
      setMessage(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function resolveCustomerConflict(choice: 'local' | 'cloud') {
    if (!customerConflict || !shop || busy) return;
    const target = scope;
    setBusy(true);
    try {
      const next = await resolveCloudCustomer(
        target,
        shop.id,
        customerConflict.local.id,
        choice,
        customerConflict.local.lastEventId,
        customerConflict.remote?.lastEventId ?? null,
      );
      if (activeScope.current === target) {
        setState(next);
        setCustomerConflict(null);
        channel.current?.postMessage('changed');
        setMessage('Choice saved. Remaining changes will sync automatically.');
      }
    } catch (error) {
      if (activeScope.current === target) {
        setMessage(errorMessage(error), 'error');
        if (error instanceof CustomerSyncConflict) setCustomerConflict(error);
      }
    } finally {
      setBusy(false);
    }
  }
  return {
    expenseConflict,
    checkoutConflict,
    jobConflict,
    customerConflict,
    serviceConflict,
    conflict,
    setExpenseConflict,
    setCheckoutConflict,
    setJobConflict,
    setCustomerConflict,
    setServiceConflict,
    setConflict,
    resolveConflict,
    resolveServiceConflict,
    resolveExpenseConflict,
    resolveJobConflict,
    resolveCustomerConflict,
  };
}
