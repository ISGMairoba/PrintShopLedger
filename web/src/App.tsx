import useSyncConflicts from './app/useSyncConflicts';
import BatchJobProgressDialog from './BatchJobProgressDialog';
import PricingTemplatesPage from './PricingTemplatesPage';
import { batchProgressEvents } from './job-batches.mjs';
import { BusinessSignup, DeveloperActivation, registrationError } from './BusinessRegistration';
import { validateBusinessRegistration, validActivationToken } from './registration.mjs';
import SaleAdjustmentsPage, { SaleAdjustmentEditor } from './SaleAdjustmentsPage';
import MaterialWastePage from './MaterialWastePage';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import ConflictInbox from './ConflictInbox';
import { blockedWork } from './sync-dependencies.mjs';
import { approveConflictReview, clearConflictApproval } from './conflict-review';
import { BusinessOptionsContext } from './BusinessOptionsContext';
import useBusinessBranding from './useBusinessBranding';
import BusinessSettingsPage from './BusinessSettingsPage';
import AccountPage from './AccountPage';
import { allowedSettingsTabs, canAccessPage, pageGroup, pages, navigationPages } from './page-access.mjs';
import ExpensesPage from './ExpensesPage';
import type { ProgressMode } from './JobActions';
import JobProgressDialog from './JobProgressDialog';
import { stageMoveEvents } from './material-choice.mjs';
import MySalesPage from './MySalesPage';
import PointOfServicePage from './PointOfServicePage';
import CheckoutEditor from './CheckoutEditor';
import ReceiptView from './ReceiptView';
import PaymentCorrectionDialog from './PaymentCorrectionDialog';
import { receiptPayments } from './payment-correction.mjs';
import { receiptIntegrityError } from './receipts.mjs';
import { printAfterTransaction, printReceipt, setPrintSigner } from './printing';
import useAutoSync from './useAutoSync';
import { isTransientSyncError } from './auto-sync.mjs';
import Sidebar from './Sidebar';
import Icon from './Icon';
import PrintSettingsPage from './PrintSettingsPage';
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Modal from './Modal';
import JobsPaymentsPage from './JobsPaymentsPage';
import JobDetails from './JobDetails';
import { discountPolicy } from './discounts.mjs';
import { PeriodDefaultsContext } from './PeriodFilter';
import { TermsProvider } from './Words';
import { TemplateAuditContext, TemplateDocumentContext, type TemplateStart } from './TemplateFields';
import { canSeeTemplateCosts } from './pricing-templates.mjs';
import { pageName, renameTerms } from './terms.mjs';
import {
  CustomerConflictReview,
  ExpenseConflictReview,
  JobConflictReview,
  MaterialConflictReview,
} from './ConflictReviews';
import { useAuthSessions, useOnline, useWorkspaces } from './app/useSessions';
import { useAutoLock } from './app/useAutoLock';
import HelpPanel from './HelpPanel';
import {
  BusinessLogin,
  PasswordRecovery,
  StaffLoginForm,
  SupervisorLogin,
  StaffSignIn,
  StartupScreen,
  WorkspaceLoading,
} from './app/AuthScreens';
import { currency, dateLabel, errorMessage, shortId, type Page, type Shop } from './app/shared';
import { pageDescriptions, pageIcons } from './app/pageInfo';
import useAppUpdates from './app/useAppUpdates';
import { customerBalance, emptyLedger } from './domain.mjs';
import {
  ExpenseSyncConflict,
  supabase,
  businessAuth,
  passwordRecoveryLink,
  syncLedger,
  MaterialSyncConflict,
  ServiceSyncConflict,
  CustomerSyncConflict,
  CheckoutSyncConflict,
  JobSyncConflict,
  resolvePendingWork,
  checkoutReviewBase,
  saveSupervisedEvent,
} from './cloud';
import { readState, saveEvent, saveEvents, mutateState } from './storage';
import MaterialsPage from './MaterialsPage';
import CustomersPage from './CustomersPage';
import UsersPage from './UsersPage';
import CustomerEditor from './CustomerEditor';
import ServicesPage from './ServicesPage';
import ServiceConflictReview from './ServiceConflictReview';
import StockHistoryPage from './StockHistoryPage';
import type {
  LedgerEvent,
  LocalState,
  Payment,
  MaterialEvent,
  ServiceEvent,
  CustomerEvent,
  Job,
  CheckoutEvent,
  CheckoutRecord,
  DrawerCommand,
  ExpenseEvent,
  SupervisedEvent,
} from './types';
import QuotationsPage from './QuotationsPage';
import { quotationCheckout, quotationRef } from './quotations.mjs';
import type { Quotation, QuotationEvent, ReminderEvent } from './types';
import QuickSale from './QuickSale';
import ProductEditor from './ProductEditor';
import EditProductsPage from './EditProductsPage';
import RemindersPage from './RemindersPage';

const DashboardPage = lazy(() => import('./DashboardPage'));
const ReportsPage = lazy(() => import('./ReportsPage'));

export default function App() {
  const [registering, setRegistering] = useState(false);
  const [activationToken, setActivationToken] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('developer_activation') ?? '',
  );
  useEffect(() => {
    const readActivation = () =>
      setActivationToken(new URLSearchParams(location.hash.slice(1)).get('developer_activation') ?? '');
    window.addEventListener('hashchange', readActivation);
    return () => window.removeEventListener('hashchange', readActivation);
  }, []);
  const automaticRegistration = useRef('');
  const [message, setMessage, messageTone] = useFeedbackMessage('success');
  const online = useOnline();
  const [switchUser, setSwitchUser] = useState(false);
  // The Help panel: closed (undefined), the whole manual (null) or a page's own topic.
  const [helpFor, setHelpFor] = useState<string | null | undefined>(undefined);
  const [staffEpoch, setStaffEpoch] = useState(0);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [demo, setDemo] = useState(!supabase);
  const { session, setSession, businessSession, setBusinessSession, authReady, authStartupError } =
    useAuthSessions(authEpoch, setMessage);
  const { shops, shop, setShop, workspaceLookup, setWorkspaceLookup, workspaceIdentity } = useWorkspaces({
    businessSession,
    session,
    demo,
    online,
    staffEpoch,
  });
  const [state, setState] = useState<LocalState>({ ledger: emptyLedger(), pending: [] });
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('Point of Service');
  const [reportCustomer, setReportCustomer] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<'customer' | 'job' | 'payment' | null>(null);
  const [receipt, setReceipt] = useState<CheckoutRecord | null>(null);
  // A quotation being turned into an order (checkout opens filled from it).
  const [quoteOrder, setQuoteOrder] = useState<Quotation | null>(null);
  // A template line priced on the Pricing Templates page, waiting to start a checkout or quotation.
  const [checkoutStart, setCheckoutStart] = useState<TemplateStart | null>(null);
  const [quotationStart, setQuotationStart] = useState<TemplateStart | null>(null);
  useEffect(() => {
    if (form !== 'job') setCheckoutStart(null);
  }, [form]);
  useEffect(() => {
    if (page !== 'Quotations') setQuotationStart(null);
  }, [page]);
  const [batchToAdvance, setBatchToAdvance] = useState<{ jobs: Job[]; mode: ProgressMode } | null>(null);
  const [quickSale, setQuickSale] = useState(false);
  /** The product being edited ('' = choose one), or null when closed. */
  const [productEdit, setProductEdit] = useState<string | null>(null);
  const [jobToAdvance, setJobToAdvance] = useState<{ job: Job; mode: ProgressMode } | null>(null);
  const [adjustingJob, setAdjustingJob] = useState<Job | null>(null);
  const [correctingPayment, setCorrectingPayment] = useState<Payment | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [paymentCustomer, setPaymentCustomer] = useState('');
  const [busy, setBusy] = useState(false);

  const [supervisorLogin, setSupervisorLogin] = useState(false);
  const [conflictReviewHidden, setConflictReviewHidden] = useState(false);
  const scope = demo
    ? 'local-trial'
    : businessSession && session && shop && shop.userId === session.user.id && shop.accessLevel > 0
      ? `${session.user.id}:${shop.id}`
      : '';
  // Trusted printing signs QZ Tray requests with this business's key (staff sign-in required).
  const signingShop = !demo && scope && supabase ? (shop?.id ?? '') : '';
  useEffect(() => {
    setPrintSigner(
      signingShop
        ? {
            shopId: signingShop,
            invoke: (body) => supabase!.functions.invoke('print-signing', { body }),
          }
        : null,
    );
  }, [signingShop]);
  const branding = useBusinessBranding(
    shop?.id ?? '',
    scope,
    demo ? 'Local trial' : (shop?.name ?? ''),
    online,
    demo,
  );
  // Catalogue edits need an Admin or higher who can open Services (the server checks this too).
  const canEditCatalogue =
    demo ||
    (!!shop &&
      shop.role !== 'cashier' &&
      shop.accessLevel >= 2 &&
      canAccessPage('Services', shop.accessLevel, branding.settings.pageAccess));
  const allowed = (item: Page) =>
    (item !== 'Pricing Templates' || branding.settings.pricing.enabled) &&
    (item !== 'Edit Products' || demo || (!!shop && shop.role !== 'cashier' && shop.accessLevel >= 2)) &&
    (demo || canAccessPage(item, shop?.accessLevel ?? 0, branding.settings.pageAccess));
  // Stock and waste share one screen with two tabs when the user may see both.
  const materialTabs =
    allowed('Materials') && allowed('Material Waste') ? (
      <div
        className="settings-tabs material-tabs"
        role="group"
        aria-label={pageName('Materials', branding.settings.terms) + ' sections'}
      >
        {(['Materials', 'Material Waste'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={page === item ? 'active' : 'secondary'}
            aria-pressed={page === item}
            onClick={() => setPage(item)}
          >
            {item === 'Materials' ? 'Stock' : 'Waste & reprints'}
          </button>
        ))}
      </div>
    ) : null;
  const pageAllowed = (page === 'Conflict Inbox' && !!supervisor) || allowed(page);
  useEffect(() => {
    if (branding.ready && (demo || (session && shop?.userId === session.user.id)) && !pageAllowed) {
      setPage((pages.find((item) => allowed(item as Page)) ?? 'My Account') as Page);
      setForm(null);
      setSelectedJob(null);
      setBatchToAdvance(null);
      setReceipt(null);
      setAdjustingJob(null);
      setCorrectingPayment(null);
    }
  }, [pageAllowed, branding.ready, demo, session?.user.id, shop?.userId]);
  const businessName = branding.settings.businessName || shop?.name || 'Business';
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const channel = useRef<BroadcastChannel | null>(null);
  const {
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
  } = useSyncConflicts({ scope, shop, busy, setBusy, activeScope, channel, setState, setMessage });
  const { needRefresh, updateServiceWorker } = useAppUpdates(busy);
  const ledger = useMemo(
    () => ({ ...state.ledger, pricing: branding.settings.pricing }),
    [state.ledger, branding.settings.pricing],
  );
  useEffect(() => {
    if (
      ready &&
      receipt &&
      !ledger.checkouts.some((item) => item.id === receipt.id) &&
      !state.pending.some((item) => item.id === receipt.id)
    )
      setReceipt(null);
  }, [ready, receipt, ledger.checkouts, state.pending]);

  useEffect(() => {
    setReady(false);
    setState({ ledger: emptyLedger(), pending: [] });
    clearConflictApproval();
    setSupervisor('');
    setSupervisorLogin(false);
    setExpenseConflict(null);
    setCheckoutConflict(null);
    setJobConflict(null);
    setReceipt(null);
    setJobToAdvance(null);
    setBatchToAdvance(null);
    setForm(null);
    setSelectedJob(null);
    setAdjustingJob(null);
    setCorrectingPayment(null);
    setQuery('');
    setConflict(null);
    setServiceConflict(null);
    setCustomerConflict(null);
    setConflictReviewHidden(false);
    if (!scope) return;
    let active = true;
    const refresh = () =>
      readState(scope)
        .then((value) => {
          if (active) {
            setState(value);
            setReady(true);
          }
        })
        .catch((error) => {
          if (active) setMessage(`Local storage failed: ${errorMessage(error)}`, 'error');
        });
    void refresh();
    const broadcast = new BroadcastChannel(`printshopledger:${scope}`);
    channel.current = broadcast;
    broadcast.onmessage = () => {
      void refresh();
    };
    return () => {
      active = false;
      broadcast.close();
      if (channel.current === broadcast) channel.current = null;
    };
  }, [scope]);

  async function save(operation: LedgerEvent) {
    if (!scope) throw new Error('Sign in to a staff workspace first.');
    const target = scope;
    const next = await saveEvent(target, operation, !demo);
    if (activeScope.current !== target) return;
    setState(next);
    channel.current?.postMessage('changed');
    setForm(null);
    setMessage(
      demo ? 'Saved on this device.' : 'Saved on this device. Changes sync automatically when connected.',
    );
  }
  async function saveCatalogue(
    operation: MaterialEvent | ServiceEvent | CustomerEvent | ExpenseEvent | QuotationEvent | ReminderEvent,
  ) {
    if (
      busy ||
      !ready ||
      hasConflict ||
      (!demo && (!session || !shop || shop.userId !== session.user.id || shop.accessLevel === 0))
    )
      throw new Error('Please wait until the staff workspace is ready.');
    setBusy(true);
    setMessage('');
    try {
      await save(operation);
    } finally {
      setBusy(false);
    }
  }
  // Several catalogue events saved together, applied in order (a new product: stock item, then service).
  async function saveCatalogueMany(operations: (MaterialEvent | ServiceEvent)[]) {
    if (
      busy ||
      !ready ||
      hasConflict ||
      !scope ||
      (!demo && (!session || !shop || shop.userId !== session.user.id || shop.accessLevel === 0))
    )
      throw new Error('Please wait until the staff workspace is ready.');
    const target = scope;
    setBusy(true);
    setMessage('');
    try {
      const next = await saveEvents(target, operations, !demo);
      if (activeScope.current !== target) return;
      setState(next);
      channel.current?.postMessage('changed');
      setMessage(
        demo ? 'Saved on this device.' : 'Saved on this device. Changes sync automatically when connected.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function approveOperation(operation: SupervisedEvent) {
    if (busy || !ready || !scope || hasConflict || (!demo && (!online || (shop?.accessLevel ?? 0) < 2)))
      throw Error('Connect and finish syncing as Admin, Manager or Developer before approving.');
    const target = scope;
    setBusy(true);
    try {
      const next = demo
        ? await saveEvent(target, operation, false)
        : await saveSupervisedEvent(target, shop!.id, operation);
      if (activeScope.current === target) {
        setState(next);
        channel.current?.postMessage('changed');
        const low = next.ledger.materials.some(
          (m) =>
            m.available < 0 &&
            (operation.kind === 'material.wasted'
              ? m.id === operation.data.materialId
              : next.ledger.saleAdjustments
                  .find((a) => a.id === operation.id)
                  ?.stockChanges?.some((c) => c.materialId === m.id)),
        );
        setMessage(
          operation.kind === 'material.wasted'
            ? `Waste saved. Stock and history updated.${low ? ' Stock warning: this material is below zero.' : ''}`
            : operation.kind === 'sale.refunded'
              ? 'Refund saved. Customer credit and drawer totals updated.'
              : `Sale adjustment saved. Account, stock and history updated.${low ? ' Stock warning: a material is below zero.' : ''}`,
          low ? 'warning' : 'success',
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function completeCheckout(operation: CheckoutEvent): Promise<CheckoutRecord> {
    if (busy || !ready || !scope || legacyConflict) throw Error('Please wait until the workspace is ready.');
    const target = scope;
    setBusy(true);
    try {
      let next = await saveEvent(target, operation, !demo);
      if (activeScope.current !== target)
        throw Error('Workspace changed. The checkout was saved in the original workspace.');
      setState(next);
      channel.current?.postMessage('changed');
      let syncProblem = '';
      if (!demo && online) {
        try {
          next = await syncLedger(target, shop!.id);
          if (activeScope.current === target) setState(next);
        } catch (error) {
          syncProblem = errorMessage(error);
          if (activeScope.current === target) {
            if (error instanceof ExpenseSyncConflict) setExpenseConflict(error);
            if (error instanceof CheckoutSyncConflict) setCheckoutConflict(error);
            if (error instanceof JobSyncConflict) setJobConflict(error);
            if (error instanceof MaterialSyncConflict) setConflict(error);
            if (error instanceof ServiceSyncConflict) setServiceConflict(error);
            if (error instanceof CustomerSyncConflict) setCustomerConflict(error);
          }
        }
      }
      const record = next.ledger.checkouts.find((r) => r.id === operation.id)!;
      const pending = next.pending.some((e) => e.id === operation.id);
      setMessage(
        syncProblem ||
          (demo
            ? 'Checkout saved on this device.'
            : pending
              ? 'Checkout saved on this device. It will sync automatically.'
              : 'Checkout confirmed and saved.'),
        syncProblem ? 'warning' : 'success',
      );
      const receiptWarning = receiptIntegrityError(record);
      const printed = receiptWarning
        ? { status: 'failed', message: receiptWarning }
        : await printAfterTransaction(target, true, (settings) =>
            printReceipt(settings, record, branding.settings, pending),
          );
      if (activeScope.current === target && printed.status === 'failed')
        setMessage(
          `Checkout saved. Receipt printing failed: ${printed.message}. Open the receipt to retry.`,
          'warning',
        );
      return record;
    } finally {
      setBusy(false);
    }
  }
  async function closeDrawer(command: DrawerCommand) {
    if (demo || !online || busy || !ready || !scope || !session || !shop)
      throw Error('Connect and sign in to close the drawer.');
    const target = scope,
      shopId = shop.id;
    setBusy(true);
    setMessage('');
    try {
      const synced = await syncLedger(target, shopId);
      if (activeScope.current !== target) throw Error('Your signed-in user changed. Reopen the drawer.');
      setState(synced);
      channel.current?.postMessage('changed');
      if (synced.pending.length)
        throw Error('Finish syncing and reviewing pending sales before handing over the drawer.');
      if (synced.pending.length) throw Error('Finish syncing pending sales before closing.');
      const { data, error } = await supabase!.functions.invoke('close-drawer', {
        body: { shopId, ...command },
      });
      if (error) {
        let message = error.message;
        const response = (error as { context?: Response }).context;
        if (response)
          try {
            message = (await response.json()).error || message;
          } catch {}
        throw Error(message);
      }
      if (activeScope.current !== target)
        throw Error('Handover saved. Sign in as the receiving user to continue.');
      // Cache the server-confirmed closing before the outgoing staff session is replaced.
      // Preserve any concurrent local work; this confirmation does not create an outbox event.
      let cacheWarning = '';
      try {
        const closedIds = new Set<string>(data.closing.checkoutIds);
        await mutateState(target, (current) => ({
          ...current,
          ledger: {
            ...current.ledger,
            drawerClosings: [
              ...current.ledger.drawerClosings.filter((d) => d.id !== data.closing.id),
              data.closing,
            ],
            checkouts: current.ledger.checkouts.map((r) =>
              closedIds.has(r.id) ? { ...r, drawerClosingId: data.closing.id } : r,
            ),
          },
        }));
        channel.current?.postMessage('changed');
      } catch {
        cacheWarning = ' Reconnect before reviewing the outgoing user’s sales on this device.';
      }
      if (activeScope.current !== target)
        throw Error('Handover saved. Sign in as the receiving user to continue.');
      await supabase!.auth.signOut({ scope: 'local' });
      const { error: sessionError } = await supabase!.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) {
        await supabase!.auth.signOut({ scope: 'local' });
        throw Error('Handover saved. Sign in as the receiving user to continue.');
      }
      setPage('My Sales');
      setStaffEpoch((value) => value + 1);
      setMessage(
        `Drawer handover saved. ${data.closing.toUserLabel} is now signed in.${cacheWarning}`,
        cacheWarning ? 'warning' : 'success',
      );
    } catch (error) {
      if (error instanceof ExpenseSyncConflict) setExpenseConflict(error);
      if (error instanceof CheckoutSyncConflict) setCheckoutConflict(error);
      if (error instanceof JobSyncConflict) setJobConflict(error);
      if (error instanceof MaterialSyncConflict) setConflict(error);
      if (error instanceof ServiceSyncConflict) setServiceConflict(error);
      if (error instanceof CustomerSyncConflict) setCustomerConflict(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }
  const legacyConflict = !!(
    expenseConflict ||
    conflict ||
    serviceConflict ||
    customerConflict ||
    checkoutConflict ||
    jobConflict
  );
  const heldWork = blockedWork(state);
  const hasConflict = legacyConflict || heldWork.eventIds.size > 0;
  // Payment corrections are Sale Adjustments: Admin or higher, online, with that page allowed.
  const canCorrectPayments =
    demo ||
    (online &&
      (shop?.accessLevel ?? 0) >= 2 &&
      canAccessPage('Sale Adjustments', shop?.accessLevel ?? 0, branding.settings.pageAccess));
  const canReviewConflicts = demo || (shop?.accessLevel ?? 0) >= 2 || !!supervisor;
  useEffect(() => {
    if (!hasConflict && !state.pending.length) {
      clearConflictApproval();
      setSupervisor('');
      setSupervisorLogin(false);
    }
  }, [hasConflict, state.pending.length]);
  useEffect(() => {
    if (!supervisor) return;
    const timer = setTimeout(() => {
      clearConflictApproval();
      setSupervisor('');
      setConflictReviewHidden(true);
    }, 5 * 60000);
    return () => clearTimeout(timer);
  }, [supervisor]);
  const slowSyncs = useRef(0);
  const syncStatus = useAutoSync({
    scope,
    enabled: !demo && !!scope && ready && !switchUser,
    online,
    paused: busy || legacyConflict,
    pendingKey: state.pending.map((item) => item.id).join(','),
    run: async () => {
      const target = scope;
      const next = await syncLedger(target, shop!.id);
      slowSyncs.current = 0;
      if (activeScope.current === target) {
        setState(next);
        channel.current?.postMessage('changed');
      }
    },
    onError: (error) => {
      const target = scope;
      void readState(target).then((next) => {
        if (activeScope.current === target) setState(next);
      });
      // A slow or dropped connection: sync retries by itself and work stays saved, so say
      // nothing at first and only a calm note if it keeps happening.
      if (isTransientSyncError(error)) {
        slowSyncs.current += 1;
        if (slowSyncs.current === 3)
          setMessage(
            'The connection is slow, so syncing is taking a while. It keeps trying by itself; your work is saved on this device.',
            'warning',
          );
        return;
      }
      setMessage(errorMessage(error), 'error');
      if (
        error instanceof ExpenseSyncConflict ||
        error instanceof CheckoutSyncConflict ||
        error instanceof JobSyncConflict ||
        error instanceof MaterialSyncConflict ||
        error instanceof ServiceSyncConflict ||
        error instanceof CustomerSyncConflict
      ) {
        setMessage(errorMessage(error), 'error');
        setConflictReviewHidden(false);
        if (error instanceof ExpenseSyncConflict) setExpenseConflict(error);
        if (error instanceof CheckoutSyncConflict) setCheckoutConflict(error);
        if (error instanceof JobSyncConflict) setJobConflict(error);
        if (error instanceof MaterialSyncConflict) setConflict(error);
        if (error instanceof ServiceSyncConflict) setServiceConflict(error);
        if (error instanceof CustomerSyncConflict) setCustomerConflict(error);
        return 'pause';
      }
    },
  });
  const syncLabel = !ready
    ? 'Loading'
    : hasConflict
      ? 'Review changes'
      : !online
        ? 'Waiting for connection'
        : syncStatus === 'syncing'
          ? 'Syncing…'
          : syncStatus === 'retrying'
            ? 'Waiting to retry'
            : state.pending.length
              ? 'Changes pending'
              : state.lastSynced
                ? 'Saved'
                : 'Connecting…';
  function openPayment(customerId = '') {
    setSelectedJob(null);
    setPaymentCustomer(customerId);
    setForm('payment');
    setMessage('');
  }
  // Password reset: the email link opens the app in recovery until a new password is saved.
  const [recovering, setRecovering] = useState(passwordRecoveryLink);
  useEffect(() => {
    if (!businessAuth) return;
    const { data } = businessAuth.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function sendPasswordReset(email: string) {
    setBusy(true);
    try {
      const { error } = await businessAuth!.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setMessage(
        'If that email has a business account, a reset link is on its way. Check the inbox (and spam) and open the link on this device.',
        'success',
      );
    } catch (error) {
      setMessage(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function saveRecoveredPassword(password: string) {
    setBusy(true);
    try {
      const { error } = await businessAuth!.auth.updateUser({ password });
      if (error) throw error;
      // Sign in again with the new password, so both the business and the till use it.
      await Promise.all([
        businessAuth!.auth.signOut({ scope: 'local' }),
        supabase!.auth.signOut({ scope: 'local' }),
      ]);
      setBusinessSession(null);
      setSession(null);
      history.replaceState(null, '', window.location.pathname);
      setRecovering(false);
      setMessage('Password changed. Sign in with your new password.', 'success');
    } catch (error) {
      setMessage(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const { data: business, error } = await businessAuth!.auth.signInWithPassword({
        email: String(data.get('email')),
        password: String(data.get('password')),
      });
      if (error || !business.session) throw error || new Error('Could not sign in to the business.');
      const { error: staffError } = await supabase!.auth.signInWithPassword({
        email: String(data.get('email')),
        password: String(data.get('password')),
      });
      if (staffError) throw staffError;
      setBusinessSession(business.session);
      setDemo(false);
      setSwitchUser(false);
      setMessage('');
    } catch (error) {
      setMessage(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  // Never copy the business session's tokens into the staff client: Supabase refresh
  // tokens are single-use, so two clients sharing one would revoke each other and sign
  // people out. If the staff slot holds a different user, clear it and let the owner
  // sign in through the normal staff sign-in (username "manager").
  async function releaseForeignStaffSession() {
    const { data } = await supabase!.auth.getSession();
    if (!data.session || data.session.user.id === businessSession?.user.id) return !data.session;
    await supabase!.auth.signOut({ scope: 'local' });
    setSession(null);
    return true;
  }
  const workspaceCreatedMessage = (signInNeeded: boolean) =>
    signInNeeded
      ? 'Business workspace created. Sign in with username "manager" and your business password. Developer activation will be sent to maintenance.'
      : 'Business workspace created. Manager access is ready; Developer activation will be sent to maintenance.';
  async function createWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!businessSession || busy || !online) return;
    setBusy(true);
    setMessage('');
    const data = new FormData(e.currentTarget);
    try {
      // Workspace creation belongs to the business identity (businessAuth).
      const profile = validateBusinessRegistration({
        businessName: String(data.get('businessName')).trim(),
        ownerName: businessSession.user.user_metadata.full_name || String(data.get('ownerName') ?? ''),
      });
      const { error } = await businessAuth!.functions.invoke('register-business', { body: profile });
      if (error) throw error;
      const signInNeeded = await releaseForeignStaffSession();
      // Reload through the guarded lookup; a failed read after creation must
      // never leave the creation form open and invite a duplicate business.
      setWorkspaceLookup({ key: workspaceIdentity, status: 'loading', error: '' });
      setStaffEpoch((value) => value + 1);
      setMessage(workspaceCreatedMessage(signInNeeded));
    } catch (error) {
      setMessage(await registrationError(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !demo &&
      businessSession &&
      online &&
      workspaceLookup.key === workspaceIdentity &&
      workspaceLookup.status === 'ready' &&
      !shops.length &&
      businessSession.user.user_metadata.business_name &&
      automaticRegistration.current !== businessSession.user.id
    ) {
      automaticRegistration.current = businessSession.user.id;
      void (async () => {
        setBusy(true);
        try {
          const profile = validateBusinessRegistration({
            businessName: businessSession.user.user_metadata.business_name,
            ownerName: businessSession.user.user_metadata.full_name,
          });
          const { error } = await businessAuth!.functions.invoke('register-business', { body: profile });
          if (error) throw error;
          const signInNeeded = await releaseForeignStaffSession();
          setWorkspaceLookup({ key: workspaceIdentity, status: 'loading', error: '' });
          setStaffEpoch((value) => value + 1);
          setMessage(workspaceCreatedMessage(signInNeeded));
        } catch (error) {
          setMessage(await registrationError(error), 'error');
        } finally {
          setBusy(false);
        }
      })();
    }
  }, [demo, businessSession?.user.id, online, workspaceLookup.status, workspaceLookup.key, shops.length]);
  async function staffLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shop || !businessAuth || busy) return;
    setBusy(true);
    setMessage('');
    const form = new FormData(e.currentTarget);
    try {
      const { data, error } = await businessAuth.functions.invoke('staff-login', {
        body: {
          shopId: shop.id,
          username: String(form.get('username') ?? ''),
          password: String(form.get('password') ?? ''),
        },
      });
      if (error) {
        let message = error.message;
        const response = (error as { context?: Response }).context;
        if (response)
          try {
            message = (await response.json()).error || message;
          } catch {}
        throw new Error(message);
      }
      const { error: failure } = await supabase!.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (failure) throw failure;
      setSwitchUser(false);
      setStaffEpoch((value) => value + 1);
      setPage('Point of Service');
    } catch (error) {
      setMessage(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  const salesActor = {
    id: demo ? 'local-trial' : (session?.user.id ?? ''),
    label: demo ? 'Local trial user' : shop?.staffName || session?.user.email || session?.user.id || '',
  };
  const catalogueActor = {
    ...salesActor,
    label: demo
      ? 'Local trial user'
      : shop?.staffName || session?.user.user_metadata.full_name || salesActor.label,
  };
  const currentJob = ledger.jobs.find((job) => job.id === selectedJob);
  // Auto-lock (Business Settings → Security): sign the user out after the idle time. The business
  // stays signed in, so the staff sign-in appears with empty fields.
  const lockMinutes = branding.settings.security.autoLockMinutes;
  useAutoLock({
    minutes: lockMinutes,
    active: !demo && !!session && !!supabase,
    online,
    busy,
    onLock: () => {
      void supabase!.auth.signOut({ scope: 'local' }).then(({ error }: { error: unknown }) => {
        if (error) return;
        setSwitchUser(false);
        setSession(null);
        setMessage(
          `Locked after ${lockMinutes} minute${lockMinutes === 1 ? '' : 's'} without use. Sign in to continue.`,
          'info',
        );
      });
    },
  });

  if (validActivationToken(activationToken))
    return <DeveloperActivation key={activationToken} token={activationToken} online={online} />;
  const feedback = { message, tone: messageTone };
  if (!authReady)
    return <StartupScreen error={authStartupError} onRetry={() => setAuthEpoch((value) => value + 1)} />;
  if (recovering)
    return (
      <PasswordRecovery
        feedback={feedback}
        busy={busy}
        online={online}
        ready={!!businessSession}
        onSubmit={(password) => void saveRecoveredPassword(password)}
        onCancel={() => {
          history.replaceState(null, '', window.location.pathname);
          setRecovering(false);
          setMessage('');
          void businessAuth?.auth.signOut({ scope: 'local' });
        }}
      />
    );
  if (!demo && !businessSession && registering)
    return (
      <BusinessSignup
        online={online}
        onBack={() => {
          setRegistering(false);
          setMessage('');
        }}
      />
    );
  if (!demo && !businessSession)
    return (
      <BusinessLogin
        feedback={feedback}
        busy={busy}
        online={online}
        onSubmit={login}
        onRegister={() => {
          setRegistering(true);
          setMessage('');
        }}
        onTrial={() => {
          setDemo(true);
          setMessage('');
        }}
        onForgot={sendPasswordReset}
      />
    );
  if (
    !demo &&
    businessSession &&
    (workspaceLookup.key !== workspaceIdentity || workspaceLookup.status !== 'ready')
  )
    return (
      <WorkspaceLoading
        failed={workspaceLookup.key === workspaceIdentity && workspaceLookup.status === 'error'}
        error={workspaceLookup.error}
        online={online}
        onRetry={() => setStaffEpoch((value) => value + 1)}
        onSignOut={async () => {
          await Promise.all([supabase!.auth.signOut(), businessAuth!.auth.signOut()]);
        }}
      />
    );
  if (
    !demo &&
    businessSession &&
    shops.length > 0 &&
    (!session || !shop || shop.userId !== session.user.id || shop.accessLevel === 0)
  )
    return (
      <StaffSignIn
        shops={shops}
        shop={shop}
        onShop={setShop}
        feedback={feedback}
        busy={busy}
        online={online}
        onSubmit={staffLogin}
      />
    );

  return (
    <BusinessOptionsContext.Provider value={branding.settings.options}>
      <TermsProvider value={branding.settings.terms}>
        <TemplateAuditContext.Provider
          value={demo || canSeeTemplateCosts(branding.settings.pricing, shop?.accessLevel ?? 0)}
        >
          <TemplateDocumentContext.Provider
            value={{
              business: branding.settings,
              preparedBy: demo ? 'Local trial user' : shop?.staffName || session?.user.email || '',
            }}
          >
            <PeriodDefaultsContext.Provider value={branding.settings.periods}>
              <div className="app">
                <Sidebar
                  title={businessName}
                  header={
                    <>
                      <div className="brand">
                        {branding.sidebarLogo && (
                          <img
                            className="sidebar-business-logo"
                            src={branding.sidebarLogo}
                            alt={businessName + ' logo'}
                          />
                        )}
                        <div className="brand-copy">
                          {!branding.sidebarLogo && <strong className="brand-title">{businessName}</strong>}
                          <span className={`connection ${online ? 'online' : ''}`} role="status">
                            {online ? 'Online' : 'Offline'} · {state.pending.length} pending changes
                          </span>
                        </div>
                      </div>
                      <div className="sidebar-user">
                        <strong>
                          {demo ? 'Local trial user' : shop?.staffName || 'Not signed in'}
                          {(demo || shop?.username) && ` (${demo ? 'trial' : shop?.username})`}
                        </strong>
                        <small className="staff-rank">{demo ? 'Trial' : shop?.role}</small>
                      </div>
                    </>
                  }
                  footer={
                    <>
                      <button className="secondary" onClick={() => setHelpFor(null)}>
                        <Icon name="help" /> Help
                      </button>
                      {!demo && (
                        <button
                          className="secondary"
                          disabled={busy || !online}
                          onClick={() => {
                            setSwitchUser(true);
                            setMessage('');
                          }}
                        >
                          Switch user
                        </button>
                      )}
                      {!demo && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={async () => {
                            const { error } = await supabase!.auth.signOut({ scope: 'local' });
                            if (error) setMessage(error.message, 'error');
                            else {
                              setSession(null);
                              setMessage('User signed out. Business remains signed in.');
                            }
                          }}
                        >
                          Logout
                        </button>
                      )}
                      {supabase && (demo || (shop?.accessLevel ?? 0) >= 3) && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={async () => {
                            if (demo) {
                              setDemo(false);
                              return;
                            }
                            if ((shop?.accessLevel ?? 0) < 3) return;
                            const results = await Promise.all([
                              supabase!.auth.signOut({ scope: 'local' }),
                              businessAuth!.auth.signOut({ scope: 'local' }),
                            ]);
                            const failure = results.find((result) => result.error)?.error;
                            if (failure) setMessage(failure.message, 'error');
                            else {
                              setSession(null);
                              setBusinessSession(null);
                              setShop(null);
                              setMessage('Business signed out.');
                            }
                          }}
                        >
                          {demo ? 'Business sign in' : 'Sign out business'}
                        </button>
                      )}
                    </>
                  }
                >
                  <nav aria-label="Main">
                    {(navigationPages as Page[])
                      .filter(
                        (item) =>
                          // Material Waste lives inside Materials; it has its own menu entry only for
                          // someone who can record waste but not open Materials.
                          !(item === 'Material Waste' && allowed('Materials')) &&
                          (allowed(item) || (item === 'Conflict Inbox' && !!supervisor)),
                      )
                      .map((item, index, shown) => (
                        <Fragment key={item}>
                          {pageGroup(item) !== pageGroup(shown[index - 1]) && (
                            <p className="nav-group" aria-hidden="true">
                              {pageGroup(item)}
                            </p>
                          )}
                          <button
                            className={
                              page === item || (item === 'Materials' && page === 'Material Waste')
                                ? 'active'
                                : ''
                            }
                            onClick={() => {
                              setPage(item);
                              setSelectedJob(null);
                              setForm(null);
                              setQuery('');
                            }}
                          >
                            <Icon name={pageIcons[item]} />
                            {pageName(item, branding.settings.terms)}
                          </button>
                        </Fragment>
                      ))}
                  </nav>
                </Sidebar>
                <main>
                  <header>
                    <div>
                      <span className="eyebrow">{demo ? 'LOCAL TRIAL' : businessName}</span>
                      <div className="page-title">
                        <h1>{pageName(page, branding.settings.terms)}</h1>
                        <button
                          type="button"
                          className="help-button"
                          aria-label={`Help with ${pageName(page, branding.settings.terms)}`}
                          title="Help with this page"
                          onClick={() => setHelpFor(page)}
                        >
                          <Icon name="help" />
                        </button>
                      </div>
                      <p>{renameTerms(pageDescriptions[page], branding.settings.terms)}</p>
                    </div>
                    {!demo && scope && (
                      <span className="sync-status" role="status" aria-live="polite">
                        <Icon name="sync" /> {syncLabel}
                        {state.pending.length > 0 && ` (${state.pending.length})`}
                      </span>
                    )}
                  </header>
                  {helpFor !== undefined && (
                    <HelpPanel
                      page={helpFor}
                      rank={demo ? 4 : (shop?.accessLevel ?? 1)}
                      businessName={businessName}
                      onClose={() => setHelpFor(undefined)}
                    />
                  )}
                  {switchUser && (
                    <Modal title="Switch user" busy={busy} onClose={() => setSwitchUser(false)}>
                      <p>Business: {shop?.name}. Sign in with your staff username and password.</p>
                      <StaffLoginForm feedback={feedback} busy={busy} online={online} onSubmit={staffLogin} />
                      <FeedbackBanner message={message} tone={messageTone} login />
                    </Modal>
                  )}
                  {needRefresh && (
                    <div className="notice">
                      An app update is ready.{' '}
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void updateServiceWorker(true)}
                      >
                        Update app
                      </button>
                    </div>
                  )}
                  <FeedbackBanner message={branding.error} tone="warning" />
                  <FeedbackBanner message={message} tone={messageTone} />
                  {hasConflict && !canReviewConflicts && (
                    <div className="notice" role="alert">
                      <strong>Admin review required.</strong>
                      <p>
                        Conflicts have been sent to the business inbox when connected. An Admin, Manager or
                        Developer can review them remotely. Sales sharing affected stock or customer accounts
                        wait; unrelated sales can continue. Pending work remains saved on this device.
                      </p>
                      <button
                        className="secondary"
                        disabled={!online || busy}
                        onClick={() => setSupervisorLogin(true)}
                      >
                        Supervisor review
                      </button>
                    </div>
                  )}
                  {Object.keys(state.syncConflicts ?? {}).length > 0 && canReviewConflicts && (
                    <div className="notice notice-warning">
                      {heldWork.eventIds.size} pending operations await review. Unaffected sales can continue.{' '}
                      <button className="secondary" onClick={() => setPage('Conflict Inbox')}>
                        Open conflict inbox
                      </button>
                    </div>
                  )}
                  {hasConflict && supervisor && (
                    <div className="notice">
                      Supervisor review: {supervisor}. The cashier remains signed in.
                      <button
                        className="secondary"
                        onClick={() => {
                          clearConflictApproval();
                          setSupervisor('');
                        }}
                      >
                        End supervisor review
                      </button>
                    </div>
                  )}
                  {supervisorLogin && (
                    <SupervisorLogin
                      feedback={feedback}
                      busy={busy}
                      online={online}
                      onClose={() => setSupervisorLogin(false)}
                      onSubmit={async (username, password) => {
                        if (busy || !online || !businessAuth || !shop) return;
                        setBusy(true);
                        try {
                          const name = await approveConflictReview(
                            businessAuth,
                            scope,
                            shop.id,
                            username,
                            password,
                          );
                          if (activeScope.current === scope) {
                            setSupervisor(name);
                            setSupervisorLogin(false);
                            setConflictReviewHidden(false);
                            if (Object.keys(state.syncConflicts ?? {}).length) setPage('Conflict Inbox');
                            setMessage('Supervisor access verified for five minutes.');
                          } else clearConflictApproval();
                        } catch (error) {
                          setMessage(errorMessage(error), 'error');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  {hasConflict && canReviewConflicts && conflictReviewHidden && (
                    <div className="notice notice-warning">
                      Sync is paused while you review an edit conflict.{' '}
                      <button className="secondary" onClick={() => setConflictReviewHidden(false)}>
                        Review changes
                      </button>
                    </div>
                  )}
                  {expenseConflict && !conflictReviewHidden && canReviewConflicts && (
                    <ExpenseConflictReview
                      conflict={expenseConflict}
                      busy={busy}
                      onClose={() => setConflictReviewHidden(true)}
                      onResolve={(choice) => void resolveExpenseConflict(choice)}
                    />
                  )}
                  {checkoutConflict && !conflictReviewHidden && canReviewConflicts && (
                    <CheckoutEditor
                      key={
                        checkoutConflict.event.id +
                        JSON.stringify(checkoutConflict.cloud.payments) +
                        JSON.stringify(checkoutConflict.cloud.services)
                      }
                      ledger={{
                        ...checkoutReviewBase(state, checkoutConflict.cloud, checkoutConflict.event.id),
                        pricing: branding.settings.pricing,
                      }}
                      initialCheckout={checkoutConflict.event.data}
                      actor={{
                        id: session!.user.id,
                        label: shop?.staffName || session!.user.email || session!.user.id,
                      }}
                      jobSettings={branding.settings.jobs}
                      discountPolicy={discountPolicy(
                        branding.settings.discounts,
                        demo ? 4 : (shop?.accessLevel ?? 0),
                      )}
                      busy={busy}
                      paymentOnly={!checkoutConflict.event.data.jobs.length}
                      onClose={() => setConflictReviewHidden(true)}
                      onReceipt={setReceipt}
                      onSave={async (operation) => {
                        setBusy(true);
                        const target = scope;
                        try {
                          const next = await resolvePendingWork(
                            target,
                            shop!.id,
                            checkoutConflict.event.id,
                            operation,
                          );
                          if (activeScope.current === target) {
                            setState(next);
                            setCheckoutConflict(null);
                            channel.current?.postMessage('changed');
                            setMessage(
                              'Pending checkout updated. Use the updated receipt; syncing will resume automatically.',
                            );
                          }
                          return next.ledger.checkouts.find((r) => r.id === operation.id)!;
                        } catch (error) {
                          if (error instanceof ExpenseSyncConflict) setExpenseConflict(error);
                          if (error instanceof CheckoutSyncConflict) setCheckoutConflict(error);
                          throw error;
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  {jobConflict && !conflictReviewHidden && canReviewConflicts && (
                    <JobConflictReview
                      conflict={jobConflict}
                      busy={busy}
                      onClose={() => setConflictReviewHidden(true)}
                      onResolve={() => void resolveJobConflict()}
                    />
                  )}
                  {customerConflict && !conflictReviewHidden && canReviewConflicts && (
                    <CustomerConflictReview
                      conflict={customerConflict}
                      busy={busy}
                      feedback={feedback}
                      onClose={() => setConflictReviewHidden(true)}
                      onResolve={(choice) => void resolveCustomerConflict(choice)}
                    />
                  )}
                  {serviceConflict && !conflictReviewHidden && canReviewConflicts && (
                    <ServiceConflictReview
                      key={
                        serviceConflict.local.lastEventId +
                        (serviceConflict.remote?.lastEventId ?? '') +
                        serviceConflict.materials.map((item) => item.lastEventId).join('')
                      }
                      conflict={serviceConflict}
                      busy={busy}
                      message={message}
                      onClose={() => setConflictReviewHidden(true)}
                      onResolve={resolveServiceConflict}
                    />
                  )}
                  {conflict && !conflictReviewHidden && canReviewConflicts && (
                    <MaterialConflictReview
                      conflict={conflict}
                      busy={busy}
                      feedback={feedback}
                      onClose={() => setConflictReviewHidden(true)}
                      onResolve={(choice) => void resolveConflict(choice)}
                    />
                  )}
                  {!demo && !shop ? (
                    <section className="auth-card">
                      <h2>Create your business workspace</h2>
                      <p>Each business gets its own customers, jobs and payments.</p>
                      <form onSubmit={createWorkspace}>
                        <label>
                          Business name
                          <input
                            name="businessName"
                            maxLength={160}
                            defaultValue={businessSession?.user.user_metadata.business_name ?? ''}
                            required
                          />
                        </label>
                        {!businessSession?.user.user_metadata.full_name && (
                          <label>
                            Owner’s full name
                            <input name="ownerName" maxLength={160} required />
                          </label>
                        )}
                        <button disabled={busy || !online}>Create workspace</button>
                      </form>
                      <p className="muted">
                        If you should join an existing business, ask its administrator to add your account.
                      </p>
                    </section>
                  ) : (
                    <>
                      {page === 'Reports' && pageAllowed ? (
                        <Suspense
                          fallback={
                            <section className="panel empty" role="status">
                              Loading reports…
                            </section>
                          }
                        >
                          <ReportsPage
                            ledger={ledger}
                            ready={ready}
                            online={online}
                            pending={state.pending.length}
                            lastSynced={state.lastSynced}
                            branding={branding.settings}
                            businessName={businessName}
                            customerId={reportCustomer}
                            onCustomerChange={setReportCustomer}
                            access={{
                              customers:
                                demo ||
                                canAccessPage(
                                  'Customers',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                              jobs:
                                demo ||
                                canAccessPage('Jobs', shop?.accessLevel ?? 0, branding.settings.pageAccess),
                              payments:
                                demo ||
                                canAccessPage(
                                  'Payments',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                              expenses:
                                demo ||
                                canAccessPage(
                                  'Expenses',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                              stock:
                                demo ||
                                canAccessPage(
                                  'Stock History',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ) ||
                                canAccessPage(
                                  'Materials',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                            }}
                          />
                        </Suspense>
                      ) : page === 'Dashboard' && pageAllowed ? (
                        <Suspense
                          fallback={
                            <section className="panel empty" role="status">
                              Loading dashboard charts…
                            </section>
                          }
                        >
                          <DashboardPage
                            ledger={ledger}
                            ready={ready}
                            online={online}
                            pending={state.pending.length}
                            lastSynced={state.lastSynced}
                            access={{
                              customers:
                                demo ||
                                canAccessPage(
                                  'Customers',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                              sales:
                                demo ||
                                canAccessPage('Jobs', shop?.accessLevel ?? 0, branding.settings.pageAccess),
                              payments:
                                demo ||
                                canAccessPage(
                                  'Payments',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                              expenses:
                                demo ||
                                canAccessPage(
                                  'Expenses',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                              materials:
                                demo ||
                                canAccessPage(
                                  'Materials',
                                  shop?.accessLevel ?? 0,
                                  branding.settings.pageAccess,
                                ),
                            }}
                          />
                        </Suspense>
                      ) : !pageAllowed ? (
                        <p role="alert">You do not have access to this page.</p>
                      ) : page === 'Sale Adjustments' ? (
                        <SaleAdjustmentsPage
                          recentDays={branding.settings.corrections.recentDays}
                          ledger={ledger}
                          ready={ready}
                          busy={busy || hasConflict}
                          canSave={demo || online}
                          onAdjust={setAdjustingJob}
                        />
                      ) : page === 'Material Waste' ? (
                        <>
                          {materialTabs}
                          <MaterialWastePage
                            ledger={ledger}
                            ready={ready}
                            busy={busy || hasConflict}
                            canSave={demo || online}
                            actor={salesActor}
                            onSave={approveOperation}
                          />
                        </>
                      ) : page === 'Conflict Inbox' ? (
                        demo ? (
                          <section className="panel">
                            <h2>Conflict inbox</h2>
                            <p>Remote reviews are available in a connected business workspace.</p>
                          </section>
                        ) : (
                          <ConflictInbox
                            key={scope}
                            scope={scope}
                            shopId={shop!.id}
                            online={online}
                            onChanged={() => {
                              if (activeScope.current !== scope) return;
                              void readState(scope).then((next) => {
                                if (activeScope.current === scope) setState(next);
                              });
                              setMessage(
                                'Review saved. The original device will receive it automatically when connected.',
                              );
                            }}
                          />
                        )
                      ) : page === 'My Account' ? (
                        <AccountPage
                          key={`${scope}:${shop?.username}`}
                          shopId={shop?.id ?? ''}
                          userId={session?.user.id ?? ''}
                          businessAccount={!!session && session.user.id === businessSession?.user.id}
                          username={shop?.username ?? ''}
                          online={online}
                          demo={demo}
                          themePreference={branding.preference}
                          setThemePreference={branding.setTheme}
                          onChanged={(message) => {
                            setMessage(message);
                            setStaffEpoch((value) => value + 1);
                          }}
                        />
                      ) : page === 'Edit Products' ? (
                        <EditProductsPage
                          key={scope}
                          ledger={ledger}
                          ready={ready}
                          busy={busy || hasConflict}
                          onEdit={(id) => setProductEdit(id)}
                        />
                      ) : page === 'Pricing Templates' ? (
                        <PricingTemplatesPage
                          key={scope}
                          settings={branding.settings}
                          version={branding.version}
                          ledger={ledger}
                          ready={branding.ready && ready}
                          online={online}
                          demo={demo}
                          actor={salesActor}
                          onSave={branding.save}
                          onReload={branding.reload}
                          onSaveService={saveCatalogue}
                          onSaveCosts={saveCatalogueMany}
                          canManage={
                            demo ||
                            allowedSettingsTabs(shop?.accessLevel ?? 0, branding.settings).includes(
                              'Pricing templates',
                            )
                          }
                          canEditCosts={canEditCatalogue}
                          onStartCheckout={(start) => {
                            setQuickSale(false);
                            setPaymentCustomer('');
                            setCheckoutStart(start);
                            setForm('job');
                          }}
                          onStartQuotation={(start) => {
                            setQuotationStart(start);
                            setPage('Quotations');
                          }}
                        />
                      ) : page === 'Business Settings' ? (
                        <BusinessSettingsPage
                          key={scope}
                          settings={branding.settings}
                          version={branding.version}
                          ready={branding.ready}
                          online={online}
                          demo={demo}
                          modifiedAt={branding.modifiedAt}
                          accessLevel={demo ? 4 : (shop?.accessLevel ?? 0)}
                          onSave={branding.save}
                          onReload={branding.reload}
                        />
                      ) : page === 'Expenses' ? (
                        <ExpensesPage
                          key={scope}
                          ledger={ledger}
                          ready={ready}
                          busy={(!demo && (shop?.accessLevel ?? 0) < 2) || busy || hasConflict}
                          actor={salesActor}
                          pending={state.pending}
                          onSave={saveCatalogue}
                        />
                      ) : page === 'My Sales' ? (
                        <MySalesPage
                          key={scope}
                          ledger={ledger}
                          userId={demo ? 'local-trial' : session!.user.id}
                          username={demo ? 'trial' : (shop?.username ?? '')}
                          name={demo ? 'Local trial user' : (shop?.staffName ?? '')}
                          ready={ready}
                          busy={busy || hasConflict}
                          online={online}
                          demo={demo}
                          pending={state.pending.length}
                          onReceipt={setReceipt}
                          onHandover={closeDrawer}
                        />
                      ) : page === 'Payment Reminders' ? (
                        <RemindersPage
                          key={scope}
                          ledger={ledger}
                          ready={ready}
                          busy={busy || legacyConflict}
                          branding={branding.settings}
                          actor={salesActor}
                          onSave={saveCatalogue}
                        />
                      ) : page === 'Quotations' ? (
                        <QuotationsPage
                          key={scope}
                          ledger={ledger}
                          ready={ready}
                          busy={busy || legacyConflict}
                          branding={branding.settings}
                          actor={salesActor}
                          discountPolicy={discountPolicy(
                            branding.settings.discounts,
                            demo ? 4 : (shop?.accessLevel ?? 0),
                          )}
                          onSave={saveCatalogue}
                          onCreateOrder={(quote) => {
                            setForm(null);
                            setQuoteOrder(quote);
                          }}
                          start={quotationStart}
                        />
                      ) : page === 'Point of Service' ? (
                        <PointOfServicePage
                          ledger={ledger}
                          busy={busy || legacyConflict}
                          ready={ready}
                          onCheckout={() => {
                            setPaymentCustomer('');
                            setForm('job');
                          }}
                          onPayment={() => openPayment()}
                          onQuickSale={() => {
                            setForm(null);
                            setQuickSale(true);
                          }}
                          onJob={setSelectedJob}
                          onNext={(job, mode) => setJobToAdvance({ job, mode })}
                          onBulkAction={(jobs, mode) => setBatchToAdvance({ jobs, mode })}
                          onReceipt={setReceipt}
                        />
                      ) : page === 'Users' ? (
                        <UsersPage
                          key={scope}
                          shopId={shop?.id ?? ''}
                          actorId={session?.user.id ?? ''}
                          businessUserId={businessSession?.user.id ?? ''}
                          role={shop?.role ?? ''}
                          online={online}
                          demo={demo}
                          onChanged={() => setStaffEpoch((value) => value + 1)}
                        />
                      ) : page === 'Print Settings' ? (
                        <PrintSettingsPage
                          key={scope}
                          scope={scope}
                          ready={ready}
                          trusted={!!signingShop}
                          business={branding.settings}
                        />
                      ) : page === 'Customers' ? (
                        <CustomersPage
                          key={scope}
                          onStatement={
                            demo ||
                            (['Reports', 'Jobs', 'Payments'] as const).every((name) =>
                              canAccessPage(name, shop?.accessLevel ?? 0, branding.settings.pageAccess),
                            )
                              ? (id) => {
                                  setReportCustomer(id);
                                  setPage('Reports');
                                }
                              : undefined
                          }
                          ledger={ledger}
                          ready={ready}
                          busy={busy || hasConflict}
                          actor={catalogueActor}
                          onSave={saveCatalogue}
                          onRecordPayment={(id) => openPayment(id)}
                        />
                      ) : page === 'Materials' ? (
                        <>
                          {materialTabs}
                          <MaterialsPage
                            key={scope}
                            materials={ledger.materials}
                            history={ledger.materialHistory}
                            ready={ready}
                            busy={(!demo && shop?.role === 'cashier') || busy || hasConflict}
                            actor={catalogueActor}
                            onSave={saveCatalogue}
                            expenses={ledger.expenses}
                            businessName={businessName}
                            canRecordPurchase={demo || allowed('Expenses')}
                            onSaveExpense={saveCatalogue}
                          />
                        </>
                      ) : page === 'Services' ? (
                        <ServicesPage
                          key={scope}
                          services={ledger.services}
                          materials={ledger.materials}
                          ready={ready}
                          busy={(!demo && shop?.role === 'cashier') || busy || hasConflict}
                          actor={catalogueActor}
                          onSave={saveCatalogue}
                          onSaveMany={saveCatalogueMany}
                          onEditProduct={canEditCatalogue ? (id) => setProductEdit(id) : undefined}
                        />
                      ) : page === 'Stock History' ? (
                        <StockHistoryPage
                          key={scope}
                          history={ledger.materialHistory}
                          materials={ledger.materials}
                          pending={state.pending}
                          ready={ready}
                          demo={demo}
                        />
                      ) : (
                        <JobsPaymentsPage
                          key={page}
                          page={page === 'Payments' ? 'Payments' : 'Jobs'}
                          ledger={ledger}
                          ready={ready}
                          busy={busy}
                          legacyConflict={legacyConflict}
                          query={query}
                          onQuery={setQuery}
                          onCreate={() => {
                            setMessage('');
                            if (page === 'Payments') openPayment();
                            else setForm('job');
                          }}
                          onAddCustomer={() => setForm('customer')}
                          onJob={setSelectedJob}
                          onAction={(job, mode) => setJobToAdvance({ job, mode })}
                          onBulkAction={(jobs, mode) => setBatchToAdvance({ jobs, mode })}
                          onReceipt={setReceipt}
                          onCorrectPayment={canCorrectPayments ? setCorrectingPayment : undefined}
                        />
                      )}
                      <p className="footnote">
                        {demo
                          ? 'Local trial · This device only · No cloud uploads'
                          : `Last synced: ${state.lastSynced ? new Date(state.lastSynced).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : 'Not yet synced'}`}{' '}
                        · Currency: NGN
                      </p>
                    </>
                  )}
                  {currentJob && (
                    <JobDetails
                      job={currentJob}
                      ledger={ledger}
                      busy={busy}
                      hasConflict={hasConflict}
                      legacyConflict={legacyConflict}
                      customerHeld={heldWork.resources.has('customer:' + currentJob.customerId)}
                      canAdjust={
                        demo ||
                        canAccessPage(
                          'Sale Adjustments',
                          shop?.accessLevel ?? 0,
                          branding.settings.pageAccess,
                        )
                      }
                      canSave={demo || online}
                      onClose={() => setSelectedJob(null)}
                      onAdjust={(job) => {
                        setSelectedJob(null);
                        setAdjustingJob(job);
                      }}
                      onAction={(job, mode) => setJobToAdvance({ job, mode })}
                      onPayment={openPayment}
                    />
                  )}
                  {form === 'customer' && (
                    <CustomerEditor
                      customers={ledger.customers}
                      busy={busy}
                      actor={catalogueActor}
                      onSave={saveCatalogue}
                      onClose={() => setForm(null)}
                    />
                  )}
                  {form && form !== 'customer' && (
                    <CheckoutEditor
                      ledger={ledger}
                      actor={salesActor}
                      busy={busy}
                      paymentOnly={form === 'payment'}
                      initialCustomer={form === 'payment' ? paymentCustomer : ''}
                      startTemplate={form === 'job' ? (checkoutStart ?? undefined) : undefined}
                      onSave={completeCheckout}
                      onClose={() => setForm(null)}
                      onReceipt={setReceipt}
                      jobSettings={branding.settings.jobs}
                      discountPolicy={discountPolicy(
                        branding.settings.discounts,
                        demo ? 4 : (shop?.accessLevel ?? 0),
                      )}
                    />
                  )}
                  {productEdit !== null && (
                    <ProductEditor
                      key={productEdit}
                      ledger={ledger}
                      initialServiceId={productEdit}
                      actor={salesActor}
                      busy={busy || hasConflict}
                      onSave={saveCatalogueMany}
                      onClose={() => setProductEdit(null)}
                    />
                  )}
                  {quickSale && (
                    <QuickSale
                      ledger={ledger}
                      actor={salesActor}
                      busy={busy}
                      onSave={completeCheckout}
                      onClose={() => setQuickSale(false)}
                      onReceipt={setReceipt}
                      discountPolicy={discountPolicy(
                        branding.settings.discounts,
                        demo ? 4 : (shop?.accessLevel ?? 0),
                      )}
                    />
                  )}
                  {quoteOrder &&
                    !form &&
                    (() => {
                      const start = quotationCheckout(ledger, quoteOrder);
                      return (
                        <CheckoutEditor
                          key={quoteOrder.id}
                          ledger={ledger}
                          actor={salesActor}
                          busy={busy}
                          fromQuotation={{
                            reference: quotationRef(quoteOrder.id),
                            customerId: start.customerId,
                            customerName: quoteOrder.customerName,
                            customerPhone: quoteOrder.customerPhone,
                            lines: start.lines,
                            orderDiscount: start.orderDiscount,
                            changes: start.changes,
                          }}
                          onSave={async (operation) => {
                            const record = await completeCheckout(operation);
                            // Link the quotation to the sale. It syncs with the rest of the pending work.
                            const target = scope;
                            if (target && activeScope.current === target) {
                              try {
                                const next = await saveEvent(
                                  target,
                                  {
                                    id: crypto.randomUUID(),
                                    kind: 'quotation.converted',
                                    data: {
                                      id: quoteOrder.id,
                                      checkoutId: operation.id,
                                      baseVersion: quoteOrder.version,
                                      modifiedBy: demo ? 'local-trial' : session!.user.id,
                                      modifiedByLabel: demo
                                        ? 'Local trial user'
                                        : shop?.staffName || session!.user.email || session!.user.id,
                                      modifiedAt: new Date().toISOString(),
                                    },
                                  },
                                  !demo,
                                );
                                if (activeScope.current === target) setState(next);
                              } catch {
                                setMessage(
                                  'The sale is saved, but the quotation could not be marked converted.',
                                  'warning',
                                );
                              }
                            }
                            setQuoteOrder(null);
                            return record;
                          }}
                          onClose={() => setQuoteOrder(null)}
                          onReceipt={setReceipt}
                          jobSettings={branding.settings.jobs}
                          discountPolicy={discountPolicy(
                            branding.settings.discounts,
                            demo ? 4 : (shop?.accessLevel ?? 0),
                          )}
                        />
                      );
                    })()}
                  {adjustingJob && (
                    <SaleAdjustmentEditor
                      ledger={ledger}
                      job={adjustingJob}
                      busy={busy}
                      actor={salesActor}
                      onClose={() => setAdjustingJob(null)}
                      onSave={approveOperation}
                    />
                  )}
                  {correctingPayment && (
                    <PaymentCorrectionDialog
                      ledger={ledger}
                      payment={
                        ledger.payments.find((p) => p.id === correctingPayment.id) ?? correctingPayment
                      }
                      busy={busy}
                      actor={salesActor}
                      onClose={() => setCorrectingPayment(null)}
                      onSave={approveOperation}
                    />
                  )}
                  {receipt && (
                    <ReceiptView
                      ledger={ledger}
                      record={ledger.checkouts.find((r) => r.id === receipt.id) ?? receipt}
                      scope={scope}
                      business={branding.settings}
                      adjustments={ledger.saleAdjustments.filter(
                        (a) =>
                          a.before.checkoutId === receipt.id ||
                          receipt.jobBalances.some((j) => j.id === a.jobId) ||
                          a.paymentChanges.some(
                            (p) =>
                              p.before.id === receipt.id ||
                              p.before.checkoutId === receipt.id ||
                              [...p.before.allocations, ...p.after.allocations].some((x) =>
                                receipt.jobBalances.some((j) => j.id === x.jobId),
                              ),
                          ),
                      )}
                      pending={state.pending.some((e) => e.id === receipt.id)}
                      onClose={() => setReceipt(null)}
                      onCorrectPayment={
                        canCorrectPayments && receiptPayments(ledger, receipt.id).length
                          ? () => {
                              const [payment] = receiptPayments(ledger, receipt.id);
                              setReceipt(null);
                              setCorrectingPayment(payment);
                            }
                          : undefined
                      }
                    />
                  )}
                  {batchToAdvance && (
                    <BatchJobProgressDialog
                      ledger={ledger}
                      jobs={batchToAdvance.jobs}
                      mode={batchToAdvance.mode}
                      busy={busy}
                      onClose={() => setBatchToAdvance(null)}
                      onSave={async (targetStage, usages) => {
                        if (busy || !ready || !scope || legacyConflict)
                          throw Error('Wait until the workspace is ready.');
                        const targetScope = scope;
                        for (const item of batchToAdvance.jobs) {
                          const current = state.ledger.jobs.find((job) => job.id === item.id);
                          if (
                            !current ||
                            current.version !== item.version ||
                            current.productionStatus !== item.productionStatus
                          )
                            throw Error('An item changed. Close this window and select the items again.');
                        }
                        const events = batchProgressEvents(
                          batchToAdvance.jobs,
                          batchToAdvance.mode,
                          targetStage,
                          {
                            id: demo ? 'local-trial' : session!.user.id,
                            label: demo
                              ? 'Local trial user'
                              : shop?.staffName || session!.user.email || session!.user.id,
                          },
                          undefined,
                          { ledger: state.ledger, usages },
                        );
                        if (!events.length) throw Error('No selected items can take this action.');
                        setBusy(true);
                        try {
                          const next = await saveEvents(targetScope, events, !demo);
                          if (activeScope.current === targetScope) {
                            setState(next);
                            channel.current?.postMessage('changed');
                            setBatchToAdvance(null);
                            setMessage('Selected items updated. Changes sync automatically when connected.');
                          }
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  {jobToAdvance && (
                    <JobProgressDialog
                      ledger={state.ledger}
                      job={jobToAdvance.job}
                      mode={jobToAdvance.mode}
                      busy={busy}
                      onClose={() => setJobToAdvance(null)}
                      onSave={async (targetStage, usages) => {
                        if (busy || !ready || !scope || legacyConflict)
                          throw Error('Wait until the workspace is ready.');
                        const targetScope = scope;
                        setBusy(true);
                        try {
                          // A choice-of-materials job confirms its material first, then moves.
                          const events = stageMoveEvents(
                            state.ledger,
                            jobToAdvance.job,
                            targetStage,
                            {
                              id: demo ? 'local-trial' : session!.user.id,
                              label: demo
                                ? 'Local trial user'
                                : shop?.staffName || session!.user.email || session!.user.id,
                            },
                            usages,
                          );
                          const next = await saveEvents(targetScope, events, !demo);
                          if (activeScope.current === targetScope) {
                            setState(next);
                            channel.current?.postMessage('changed');
                            setJobToAdvance(null);
                            setMessage(
                              'Job stages saved in order. Changes sync automatically when connected.',
                            );
                          }
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                </main>
              </div>
            </PeriodDefaultsContext.Provider>
          </TemplateDocumentContext.Provider>
        </TemplateAuditContext.Provider>
      </TermsProvider>
    </BusinessOptionsContext.Provider>
  );
}
