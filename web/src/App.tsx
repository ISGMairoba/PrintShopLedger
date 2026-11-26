import ShareChooser from './ShareChooser';
import SearchSelect from './SearchSelect';
import { accountPaymentOptions } from './account-methods.mjs';
import {
  allBranchesLedger,
  allowedBranches,
  branchesOf,
  branchLedger,
  branchCustomersLedger,
  chosenItemsLedger,
  hasBranches,
  withLocationMinimums,
  MAIN,
  ownCustomers,
  ownPrices,
  seesAllBranches,
  sellsChosen,
  settingsForBranch,
} from './branches.mjs';
import { usePageLimit } from './usePageLimit';
import { setRequestBranch, storeBranch, storedBranch } from './device-branch';
import PayeesPage from './PayeesPage';
import AccountsPage from './AccountsPage';
import { defaultMoneyAccount } from './operations.mjs';
import { locationUnitCost, stockValuation } from './actual-cost.mjs';
import { materialUnitCost } from './profit.mjs';
import type { Ledger, OperationsEvent, FieldEvent, Service, TeamEvent } from './types';
import { applySaleAdjustment } from './sale-adjustments.mjs';
import DueDateDialog from './DueDateDialog';
import useSubscription, { subscriptionNotice } from './useSubscription';
import { setWritesBlocked } from './subscription-rule.mjs';
import { confirmSignedOut, reportDevice, sendProblems } from './device-report';
import { historyCheckIfDue } from './history-check-store';
import { recordProblem } from './problem-log.mjs';
import { setMaterialsAtSale, setStockBelowZeroBlocked } from './stock-rule.mjs';
import { countReminderDue, reservedMap } from './stock-count.mjs';
import { setMinOrderRule } from './min-order.mjs';
import useSyncConflicts from './app/useSyncConflicts';
import BatchJobProgressDialog from './BatchJobProgressDialog';
import PricingTemplatesPage from './PricingTemplatesPage';
import { batchProgressEvents, batchProgressPlan } from './job-batches.mjs';
import { BusinessSignup, DeveloperActivation, registrationError } from './BusinessRegistration';
import { validateBusinessRegistration, validActivationToken } from './registration.mjs';
import SaleAdjustmentsPage, { SaleAdjustmentEditor } from './SaleAdjustmentsPage';
import MaterialWastePage from './MaterialWastePage';
import StockCountPage from './StockCountPage';
import PartnersPage from './PartnersPage';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import ConflictInbox from './ConflictInbox';
import { blockedWork } from './sync-dependencies.mjs';
import { approveConflictReview, clearConflictApproval } from './conflict-review';
import { BusinessOptionsContext } from './BusinessOptionsContext';
import useBusinessBranding from './useBusinessBranding';
import BusinessSettingsPage from './BusinessSettingsPage';
import AccountPage from './AccountPage';
import {
  allowedSettingsTabs,
  canAccessPage,
  limitedPageAccess,
  pageGroup,
  pages,
  navigationPages,
} from './page-access.mjs';
import ExpensesPage from './ExpensesPage';
import DrawerReviews from './DrawerReviews';
import { setBusinessKeep, setKeepChoice } from './history-keep.mjs';
import { orderMethods } from './business-options.mjs';
import { STALE_EVENT } from './stale-app.mjs';
import { confirmMaterialsRank, extraMaterialsRank } from './production-materials.mjs';
import { costMethodOf, lockSettings } from './business-branding.mjs';
import { CostMethodContext } from './CostMethodContext';
import { holdEvent } from './job-hold.mjs';
import type { HoldChange } from './JobActions';
import { dismissLowStockReminder } from './low-stock-locations.mjs';
import useAdminReminders from './useAdminReminders';
import BranchSwitch from './BranchSwitch';
import { businessDay } from './dashboard.mjs';
import { dismissLateReminder, LATE_FILTER_KEY } from './stage-time.mjs';
import type { ProgressMode } from './JobActions';
import JobProgressDialog from './JobProgressDialog';
import { stageMoveEvents } from './material-choice.mjs';
import MySalesPage from './MySalesPage';
import PointOfServicePage from './PointOfServicePage';
import CheckoutEditor, { type HeldSale, heldQuotation } from './CheckoutEditor';
import ReceiptView from './ReceiptView';
import CreditRefundDialog from './CreditRefundDialog';
import PaymentCorrectionDialog from './PaymentCorrectionDialog';
import SplitCorrectionDialog from './SplitCorrectionDialog';
import DeviceStorageCard, { LOW_SPACE } from './DeviceStorageCard';
import { MyCorrectionsPanel, PendingRequestsPanel } from './CorrectionRequests';
import { depositCorrectionRank, isDepositWithoutJob } from './correction-requests.mjs';
import { receiptPayments } from './payment-correction.mjs';
import { receiptIntegrityError, refundSlipFor } from './receipts.mjs';
import { printAfterTransaction, printReceipt, setPrintSigner } from './printing';
import useAutoSync from './useAutoSync';
import { isTransientSyncError } from './auto-sync.mjs';
import Sidebar from './Sidebar';
import Icon from './Icon';
import PrintSettingsPage from './PrintSettingsPage';
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Modal, { AppLayer, setAppLocked } from './Modal';
import PinForm from './PinForm';
import DeviceLockOptions from './DeviceLockOptions';
import JobsPaymentsPage from './JobsPaymentsPage';
import JobDetails from './JobDetails';
import { discountPolicy } from './discounts.mjs';
import { PeriodDefaultsContext } from './PeriodFilter';
import { TermsProvider } from './Words';
import { ReadyMessageContext } from './ReadyMessage';
import { MessagesContext } from './MessagesContext';
import { initialsFor } from './item-fields.mjs';
import { readyMessage } from './ready-message.mjs';
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
import usePinLock from './app/usePinLock';
import { validPinHash } from './pin.mjs';
import { lockedFlag, readPin, setLockedFlag, writePin } from './pin-store';
import {
  forgetEveryone,
  forgetPerson,
  listPeople,
  rememberPerson,
  type RememberedPerson,
} from './device-people';
import { sessionKey } from './app/useSessions';
import { checkPin } from './pin.mjs';
import { noteLockout, sendLockouts, switchedIn } from './lock-notes';
import {
  biometricOwner,
  biometricSupported,
  registerBiometric,
  removeBiometric,
  setNeedsPin,
  verifyBiometric,
  type BiometricOwner,
} from './biometric';
import HelpPanel from './HelpPanel';
import {
  AuthShell,
  LOGIN_COLORS_KEY,
  PinLockScreen,
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
  requestFullSync,
  MaterialSyncConflict,
  ServiceSyncConflict,
  CustomerSyncConflict,
  CheckoutSyncConflict,
  JobSyncConflict,
  resolvePendingWork,
  checkoutReviewBase,
  saveSupervisedEvents,
  listCorrectionRequests,
  submitCorrectionRequest,
  withdrawCorrectionRequest,
  rejectCorrectionRequest,
  fetchFullLedger,
  requestStock,
  answerStockRequest,
  cancelStockRequest,
  transferStock,
  syncRememberedWork,
} from './cloud';
import { readState, saveEvent, saveEvents, mutateState, storageHealth } from './storage';
import { holdSale, listHeld, removeHeld } from './held-sales.mjs';
import NoticeBoard, { useNotices, type NoticeAlert } from './NoticeBoard';
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
import { featureOn } from './business-type.mjs';
import RemindersPage from './RemindersPage';
import { useMobileLayout } from './ResponsiveTable';
import { PendingChecksBanner } from './MaterialCheckSection';
import { materialCorrectionAlerts } from './material-corrections.mjs';
import { PayeeRulesContext } from './PayeeRulesContext';
import { vendorExpenseEvents } from './team-vendor.mjs';
import { setMessageSender } from './messages.mjs';
import { setCustomerLink } from './customer-link';
import { TeamContext, type TeamWork } from './TeamContext';
import TeamPage, { UsersTabs } from './TeamPage';
import {
  autoWorkEvents,
  correctionAlerts,
  teamOn,
  teamReady,
  teamSettings,
  usualAssignEvents,
  assignEvent,
  withTrialMember,
  workEvents,
} from './team.mjs';

const DashboardPage = lazy(() => import('./DashboardPage'));
const ReportsPage = lazy(() => import('./ReportsPage'));

// The low-space check runs once per workspace per page load.
const lowSpaceChecked = new Set<string>();
/** This browser's storage, or null where it is blocked (private windows, some settings). */
const deviceStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export default function App() {
  const mobileLayout = useMobileLayout();
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
  const [usersTab, setUsersTab] = useState<'users' | 'team' | 'confirm'>('users');
  const [authEpoch, setAuthEpoch] = useState(0);
  const [demo, setDemo] = useState(!supabase);
  const { session, setSession, businessSession, setBusinessSession, authReady, authStartupError, keptStaff } =
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
  const [deadlineJobs, setDeadlineJobs] = useState<Job[] | null>(null);
  const [page, setPage] = useState<Page>('Point of Service');
  const [reportCustomer, setReportCustomer] = useState('');
  // Payment Reminders → Customer account: Customers opens on that customer's account records.
  const [customerToOpen, setCustomerToOpen] = useState('');
  useEffect(() => {
    if (page !== 'Customers') setCustomerToOpen('');
  }, [page]);
  const [reportPayee, setReportPayee] = useState('');
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
  // Retail shops: Point of Service is the selling screen; this shows the orders list instead.
  const [posOrders, setPosOrders] = useState(false);
  useEffect(() => setPosOrders(false), [page]);
  /** The product being edited ('' = choose one), or null when closed. */
  const [productEdit, setProductEdit] = useState<string | null>(null);
  const [jobToAdvance, setJobToAdvance] = useState<{ job: Job; mode: ProgressMode } | null>(null);
  const [adjustingJob, setAdjustingJob] = useState<Job | null>(null);
  const [correctingPayment, setCorrectingPayment] = useState<Payment | null>(null);
  const [requestingPayment, setRequestingPayment] = useState<Payment | null>(null);
  const [refundingCustomer, setRefundingCustomer] = useState('');
  const [requestingJob, setRequestingJob] = useState<Job | null>(null),
    [requestsVersion, setRequestsVersion] = useState(0);
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
  // Team work: the latest correction alert dismissed on this device (scope changes reload it).
  const [teamSeenFor, setTeamSeenFor] = useState({ scope: '', at: '' });
  const teamSeen =
    teamSeenFor.scope === scope
      ? teamSeenFor.at
      : (() => {
          try {
            return localStorage.getItem(`psl-team-seen:${scope}`) ?? '';
          } catch {
            return '';
          }
        })();
  const setTeamSeen = (at: string) => setTeamSeenFor({ scope, at });
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
  // The device's branch, once known: its own colours and logos (Business Settings → Settings for).
  const [themeBranch, setThemeBranch] = useState(MAIN);
  const businessBranding = useBusinessBranding(
    shop?.id ?? '',
    scope,
    demo ? 'Local trial' : (shop?.name ?? ''),
    online,
    demo,
    themeBranch,
  );
  // The branch this device works in (branches.mjs). One-branch businesses always use the main one.
  const branchChoices = allowedBranches(
    businessBranding.settings,
    shop?.userId ?? '',
    demo ? 5 : (shop?.accessLevel ?? 0),
  );
  const [branchChoice, setBranchChoice] = useState<string | null>(() => (scope ? storedBranch(scope) : null));
  useEffect(() => setBranchChoice(scope ? storedBranch(scope) : null), [scope]);
  // Notice board (online only): unread count in the header, the board in a dialog.
  const noticeBoard = useNotices(
    shop?.id,
    !demo && !!shop?.id && !!session && online,
    `${shop?.userId ?? ''}|${branchChoice ?? ''}`,
  );
  const [noticesOpen, setNoticesOpen] = useState(false);
  // Hold sale: carts put aside on this device (held-sales.mjs); `resuming` is the one reopened.
  const [held, setHeld] = useState<HeldSale[]>(() => (scope ? listHeld(deviceStorage(), scope) : []));
  useEffect(() => setHeld(scope ? listHeld(deviceStorage(), scope) : []), [scope]);
  const [resuming, setResuming] = useState<HeldSale | null>(null);
  const holdCurrentSale = (sale: HeldSale) => {
    if (!scope) return;
    try {
      setHeld(holdSale(deviceStorage(), scope, { ...sale, branchId: activeBranch?.id ?? MAIN }));
      setResuming(null);
      setForm(null);
      setQuickSale(false);
      setMessage(
        sale.kind === 'quick'
          ? `Cart held${sale.customerName ? ` for ${sale.customerName}` : ''}. Resume it from Held on Quick sale.`
          : `Sale held${sale.customerName ? ` for ${sale.customerName}` : ''}. Resume it from Point of Service.`,
        'success',
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause), 'error');
    }
  };
  // Completing a resumed sale removes it from the held list.
  const completeHeldCheckout = async (operation: CheckoutEvent) => {
    const record = await completeCheckout(operation);
    if (resuming && scope) setHeld(removeHeld(deviceStorage(), scope, resuming.id));
    setResuming(null);
    return record;
  };
  const activeBranch =
    branchChoices.length === 1
      ? branchChoices[0]
      : (branchChoices.find((b) => b.id === branchChoice) ?? null);
  // The settings as this branch sees them: a branch's own type (retail, print or both) decides
  // which parts of the app show. Business Settings edits the business's own (businessBranding).
  const branding = useMemo(() => {
    const settings = settingsForBranch(businessBranding.settings, activeBranch?.id ?? MAIN);
    return settings === businessBranding.settings ? businessBranding : { ...businessBranding, settings };
  }, [businessBranding, activeBranch?.id]);
  useEffect(() => {
    setThemeBranch(activeBranch?.id ?? MAIN);
  }, [activeBranch?.id]);
  // Held sales of this device's branch only (a sale held in another branch is resumed there; ones
  // held before branches were recorded show everywhere).
  const heldHere = useMemo(
    () => held.filter((h) => !h.branchId || h.branchId === (activeBranch?.id ?? MAIN)),
    [held, activeBranch?.id],
  );
  const needBranchChoice = !demo && !!shop && branding.ready && !activeBranch;
  // Until the business's branches are known, keep sending the branch this device last chose.
  setRequestBranch(
    branding.ready ? activeBranch?.id : branchChoice,
    branding.ready && sellsChosen(branding.settings, activeBranch?.id ?? MAIN),
  );
  const multiBranch = hasBranches(branding.settings);
  // The subscription set in the developer console: banners, pages turned off, read-only or locked.
  const subscription = useSubscription(scope, shop?.id, online, demo);
  const restriction = demo ? '' : (subscription.restriction ?? '');
  setWritesBlocked(
    restriction === 'read_only' || restriction === 'locked'
      ? 'This business’s PrintShopLedger subscription has ended, so new work cannot be recorded until it is renewed.'
      : '',
  );
  const subscriptionBanner = demo ? null : subscriptionNotice(subscription);
  // Pages: the rank's (Developer), less any the General Manager turned off at this branch or a
  // Manager+ turned off for this person.
  const pageLimit = usePageLimit({
    scope: demo ? '' : (scope ?? ''),
    shopId: shop?.id,
    branch: activeBranch?.id ?? MAIN,
    online,
    ready: branding.ready,
  });
  const pageAccess = useMemo(
    () => limitedPageAccess(branding.settings.pageAccess, shop?.accessLevel ?? 0, pageLimit.limit),
    [branding.settings.pageAccess, shop?.accessLevel, pageLimit.limit],
  );
  // Catalogue edits need an Admin or higher who can open Services (the server checks this too).
  const canEditCatalogue =
    demo ||
    (!!shop &&
      shop.role !== 'cashier' &&
      shop.accessLevel >= 2 &&
      canAccessPage('Services', shop.accessLevel, pageAccess));
  const allowed = (item: Page) =>
    !(restriction === 'pages_off' && (subscription.pagesOff ?? []).includes(item)) &&
    (item !== 'Pricing Templates' || branding.settings.pricing.enabled) &&
    featureOn(branding.settings, item) &&
    (item !== 'Edit Products' || demo || (!!shop && shop.role !== 'cashier' && shop.accessLevel >= 2)) &&
    (demo || canAccessPage(item, shop?.accessLevel ?? 0, pageAccess));
  // Stock and waste share one screen with two tabs when the user may see both.
  const materialTabs =
    allowed('Materials') && (allowed('Material Waste') || allowed('Stock Count')) ? (
      <div
        className="settings-tabs material-tabs"
        role="group"
        aria-label={pageName('Materials', branding.settings.terms) + ' sections'}
      >
        {(['Materials', 'Material Waste', 'Stock Count'] as const).filter(allowed).map((item) => (
          <button
            key={item}
            type="button"
            className={page === item ? 'active' : 'secondary'}
            aria-pressed={page === item}
            onClick={() => setPage(item)}
          >
            {item === 'Materials' ? 'Stock' : item === 'Stock Count' ? 'Count' : 'Waste & reprints'}
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
      setRequestingPayment(null);
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
  // A part of the app failed to load because the app was updated while open (stale-app.mjs).
  const [staleApp, setStaleApp] = useState(false);
  useEffect(() => {
    const flag = () => setStaleApp(true);
    window.addEventListener(STALE_EVENT, flag);
    return () => window.removeEventListener(STALE_EVENT, flag);
  }, []);
  // With branches, pages show this device's branch only (the owner's master view comes later).
  // A branch that sells chosen items sees only those (others are put aside, see chosenItemsLedger).
  const ledger = useMemo(
    () => ({
      ...(multiBranch && activeBranch
        ? branchCustomersLedger(
            withLocationMinimums(
              chosenItemsLedger(
                branchLedger(state.ledger, activeBranch.id),
                branding.settings,
                activeBranch.id,
              ),
              branding.settings,
              activeBranch.id,
            ),
            branding.settings,
            activeBranch.id,
          )
        : state.ledger),
      pricing: branding.settings.pricing,
    }),
    [state.ledger, branding.settings, multiBranch, activeBranch],
  );
  // A device that changes branch downloads that branch's records afresh.
  async function changeBranch(id: string) {
    const target = scope;
    storeBranch(target, id);
    setRequestBranch(id);
    setBranchChoice(id);
    try {
      await downloadAgain(target);
    } catch {}
  }
  // Changing due dates: Admin and higher.
  const canChangeDue = demo || (shop?.accessLevel ?? 0) >= 2;
  // The owner's master view (Dashboard and Reports): every branch together, or one of them.
  const ownerView =
    multiBranch &&
    seesAllBranches(branding.settings, shop?.userId ?? '', demo ? 5 : (shop?.accessLevel ?? 0));
  const [masterBranch, setMasterBranch] = useState('all');
  const openBranches = useMemo(
    () => branchesOf(branding.settings).filter((b) => !b.archived),
    [branding.settings],
  );
  // Reminders for Admins and higher: low stock elsewhere, repeating expenses, loans due, late jobs.
  const {
    lowElsewhereCount,
    setLowStockSeen,
    dueRepeatCount,
    setRepeatsSeen,
    loansDue,
    setLoansSeen,
    lateJobs,
    setLateSeen,
  } = useAdminReminders({
    demo,
    scope,
    level: shop?.accessLevel ?? 0,
    // This branch's jobs, loans and repeating expenses (other branches' would vanish when opened).
    ledger,
    multiBranch,
    activeBranch,
    openBranches,
    stageHours: branding.settings.options.stageHours,
    settings: branding.settings,
  });
  // Branches that sell only chosen items: the General Manager and Developer choose them (Business
  // Settings → Branches, or Sold at on the Services page). Saved straight to the server.
  const chooseItems = !demo && multiBranch && (shop?.accessLevel ?? 0) >= 4;
  const chosenBranches = useMemo(
    () =>
      openBranches
        .filter((b) => b.kind !== 'store' && b.sells === 'chosen')
        .map(({ id, name }) => ({ id, name })),
    [openBranches],
  );
  const saveItemBranches = async (serviceId: string, branchIds: string[]) => {
    const { error } = await supabase!.rpc('set_item_branches', {
      p_shop: shop!.id,
      p_service: serviceId,
      p_branches: branchIds,
    });
    if (error) throw Error(error.message);
    setMessage('Saved where the item is sold. It shows after the next sync.', 'success');
    syncNow();
  };
  const saveBranchItems = async (branchId: string, serviceIds: string[]) => {
    const { error } = await supabase!.rpc('set_branch_items', {
      p_shop: shop!.id,
      p_branch: branchId,
      p_services: serviceIds,
    });
    if (error) throw Error(error.message);
    syncNow();
  };
  // Customers page: a branch lists the customers it worked with; the owner sees every shared customer.
  const customersPageLedger = useMemo(
    () =>
      ownerView
        ? { ...ledger, customers: ledger.customers.map((c) => ({ ...c, workedHere: undefined })) }
        : ledger,
    [ownerView, ledger],
  );
  // Every branch's name (closed ones too), for notices and the Users page.
  const branchNames = useMemo(
    () => Object.fromEntries(branchesOf(branding.settings).map((b) => [b.id, b.name])),
    [branding.settings],
  );
  // Stores keep stock only, so the sales comparisons leave them out.
  const salesBranches = useMemo(() => openBranches.filter((b) => b.kind !== 'store'), [openBranches]);
  const masterLedger = useMemo(() => {
    if (!ownerView) return ledger;
    const base = { ...state.ledger, pricing: branding.settings.pricing };
    return masterBranch === 'all' ? allBranchesLedger(base) : branchLedger(base, masterBranch);
  }, [ownerView, ledger, state.ledger, branding.settings.pricing, masterBranch]);
  /** The same view of a downloaded whole history (Reports on a device keeping recent history). */
  const viewOf = (raw: Ledger): Ledger => {
    if (!ownerView)
      return {
        ...(multiBranch && activeBranch ? branchLedger(raw, activeBranch.id) : raw),
        pricing: branding.settings.pricing,
      };
    const base = { ...raw, pricing: branding.settings.pricing };
    return masterBranch === 'all' ? allBranchesLedger(base) : branchLedger(base, masterBranch);
  };
  const masterBranches = useMemo(
    () =>
      ownerView && masterBranch === 'all'
        ? salesBranches.map((b) => ({
            id: b.id,
            name: b.name,
            ledger: branchLedger({ ...state.ledger, pricing: branding.settings.pricing }, b.id),
          }))
        : undefined,
    [ownerView, masterBranch, salesBranches, state.ledger, branding.settings.pricing],
  );
  const ownerBranches = useMemo(
    () =>
      ownerView
        ? salesBranches.map((b) => ({
            id: b.id,
            name: b.name,
            ledger: branchLedger({ ...state.ledger, pricing: branding.settings.pricing }, b.id),
          }))
        : undefined,
    [ownerView, salesBranches, state.ledger, branding.settings.pricing],
  );
  const branchControl = ownerView ? (
    <label className="branch-view">
      Branch
      <SearchSelect
        label="Show branch"
        value={masterBranch}
        onChange={setMasterBranch}
        pinned={[{ value: 'all', label: 'All branches' }]}
        options={salesBranches.map((b) => ({ value: b.id, label: b.name }))}
      />
    </label>
  ) : undefined;
  // Receipts and documents show the branch's own phone and address when it has them.
  // The sign-in and lock screens use the business's chosen sign-in colours on this device.
  useEffect(() => {
    if (demo || !businessBranding.ready) return;
    try {
      const chosen = businessBranding.settings.loginColors;
      if (chosen) localStorage.setItem(LOGIN_COLORS_KEY, JSON.stringify(chosen));
      else localStorage.removeItem(LOGIN_COLORS_KEY);
    } catch {}
  }, [demo, businessBranding.ready, businessBranding.settings.loginColors]);
  // Messages ({branch}, {address}, {phone}) come from this device's branch.
  // A branch with its own customers can add another branch's customer by phone number.
  setCustomerLink(
    !demo &&
      online &&
      shop &&
      scope &&
      multiBranch &&
      activeBranch &&
      ownCustomers(branding.settings, activeBranch.id)
      ? {
          elsewhere: async (phone) => {
            const { data, error } = await supabase!.rpc('customer_phone_elsewhere', {
              p_shop: shop.id,
              p_phone: phone,
            });
            if (error) throw Error(error.message);
            return data === true;
          },
          link: async (phone) => {
            const target = scope,
              shopId = shop.id;
            const { data, error } = await supabase!.rpc('link_customer_by_phone', {
              p_shop: shopId,
              p_phone: phone,
            });
            if (error) throw Error(error.message);
            const synced = await syncLedger(target, shopId);
            if (activeScope.current === target) setState(synced);
            return data as { id: string; name: string };
          },
        }
      : null,
  );
  setMessageSender({
    branch: multiBranch && activeBranch ? activeBranch.name : '',
    address: (multiBranch && activeBranch?.address) || branding.settings.address,
    phone: (multiBranch && activeBranch?.phone) || branding.settings.phones,
  });
  const docBusiness = useMemo(
    () =>
      multiBranch && activeBranch
        ? {
            ...branding.settings,
            address: activeBranch.address || branding.settings.address,
            phones: activeBranch.phone || branding.settings.phones,
          }
        : branding.settings,
    [branding.settings, multiBranch, activeBranch],
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
    setRequestingPayment(null);
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
            if (!value.storageRecovered && !lowSpaceChecked.has(scope))
              void storageHealth().then((health) => {
                lowSpaceChecked.add(scope);
                if (active && health.free !== null && health.free < LOW_SPACE)
                  setMessage(
                    `This computer is low on space (${Math.round(health.free / 1048576)} MB left for the app). Free up disk space so the offline copy and unsynced sales stay safe.`,
                    'warning',
                  );
              });
            if (value.storageRecovered) {
              // The browser lost this device's offline copy; it is rebuilt from the server.
              setMessage(
                `This computer's offline copy was damaged (the browser lost one of its files), so it is being downloaded again from the server.${
                  value.pending.length
                    ? ` ${value.pending.length} unsynced change(s) were recovered and will sync now.`
                    : ' Anything saved here after the last sync could not be recovered.'
                }`,
                'warning',
              );
              void mutateState(scope, (current) => ({ ...current, storageRecovered: undefined }));
            }
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

  /** Put a job on hold with a reason, or resume it (anyone who can move jobs). */
  async function holdJob(job: Job, hold: HoldChange) {
    await save(holdEvent(job, hold, catalogueActor) as LedgerEvent);
  }
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
  // A new item from the General Manager or Developer, with branches that sell only chosen items:
  // they choose where it is sold before it is saved (Business Settings → Branches decides the rest).
  const [soldAsk, setSoldAsk] = useState<{
    items: string[];
    picks: string[];
    resolve: (picks: string[] | null) => void;
  } | null>(null);
  async function withWhereSold<T extends { kind: string }>(operations: T[]): Promise<T[]> {
    if (!chooseItems || !chosenBranches.length) return operations;
    const created = operations.filter((o) => o.kind === 'service.created') as unknown as {
      data: { description?: string; private?: boolean };
    }[];
    if (!created.length || created.every((o) => o.data.private)) return operations;
    const here = chosenBranches.some((b) => b.id === activeBranch?.id) ? [activeBranch!.id] : [];
    const picks = await new Promise<string[] | null>((resolve) =>
      setSoldAsk({ items: created.map((o) => o.data.description ?? 'New item'), picks: here, resolve }),
    );
    setSoldAsk(null);
    if (picks === null) throw Error('Not saved: choose where the item is sold, then save again.');
    return operations.map((o) =>
      o.kind === 'service.created'
        ? ({ ...o, data: { ...(o as unknown as { data: object }).data, soldAt: picks } } as T)
        : o,
    );
  }
  async function saveCatalogue(
    operation:
      | MaterialEvent
      | ServiceEvent
      | CustomerEvent
      | ExpenseEvent
      | QuotationEvent
      | ReminderEvent
      | OperationsEvent
      | FieldEvent,
  ) {
    if (
      busy ||
      !ready ||
      hasConflict ||
      (!demo && (!session || !shop || shop.userId !== session.user.id || shop.accessLevel === 0))
    )
      throw new Error('Please wait until the staff workspace is ready.');
    if (
      ['account.created', 'account.updated'].includes(operation.kind) &&
      !demo &&
      (shop?.accessLevel ?? 0) < 4
    )
      throw Error('Only General Managers and above can create accounts or change payment-method links.');
    setBusy(true);
    setMessage('');
    try {
      await save((await withWhereSold([operation]))[0]);
    } finally {
      setBusy(false);
    }
  }
  // Several catalogue events saved together, applied in order (a new product: stock item, then service).
  // Stock counts and shelves (Stock → Count; stock-count.mjs).
  async function saveCount(kind: string, data: Record<string, unknown>) {
    await saveCatalogue({
      id: crypto.randomUUID(),
      kind,
      data: {
        ...data,
        modifiedBy: catalogueActor.id,
        modifiedByLabel: catalogueActor.label,
        modifiedAt: new Date().toISOString(),
      },
    } as never);
  }
  /** A partner change (partners.mjs), signed by whoever is using the app. */
  const partnerEvent = (kind: string, data: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    kind,
    data: {
      ...data,
      modifiedBy: catalogueActor.id,
      modifiedByLabel: catalogueActor.label,
      modifiedAt: new Date().toISOString(),
    },
  });
  /** Mark a service as made for a partner: its price stays fixed, its materials are taken in production. */
  async function markPartnerService(service: Service, partnerOf: string) {
    await saveCatalogue({
      id: crypto.randomUUID(),
      kind: 'service.updated',
      data: {
        id: service.id,
        baseVersion: service.version,
        description: service.description,
        materialId: service.materialId,
        materialOptions: service.materialOptions ?? [],
        price: service.price,
        shelfItem: false,
        private: service.private ?? false,
        costing: service.costing ?? null,
        packPrices: service.packPrices ?? [],
        priceTiers: service.priceTiers ?? [],
        customPrice: false,
        production: { ...(service.production ?? {}), partnerOf, materialsAt: 'production' },
        modifiedBy: catalogueActor.id,
        modifiedByLabel: catalogueActor.label,
        modifiedAt: new Date().toISOString(),
      },
    } as never);
  }
  const setMaterialShelf = (materialId: string, shelf: string) =>
    saveCount('count.shelf_set', { id: materialId, shelf });
  async function saveCatalogueMany(operations: (MaterialEvent | ServiceEvent | FieldEvent)[]) {
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
      const next = await saveEvents(target, await withWhereSold(operations), !demo);
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
  // Several operations (a split payment's parts) are saved together: all or none.
  async function approveOperation(operations: SupervisedEvent | SupervisedEvent[], requestId?: string) {
    if (busy || !ready || !scope || hasConflict || (!demo && (!online || (shop?.accessLevel ?? 0) < 2)))
      throw Error('Connect and finish syncing as Admin, Manager or Developer before approving.');
    const all = Array.isArray(operations) ? operations : [operations];
    const operation = all[0];
    const target = scope;
    setBusy(true);
    try {
      let next: Awaited<ReturnType<typeof saveEvent>>;
      if (demo) {
        next = await saveEvent(target, operation, false);
        for (const more of all.slice(1)) next = await saveEvent(target, more, false);
      } else next = await saveSupervisedEvents(target, shop!.id, all, requestId);
      if (activeScope.current === target) {
        setState(next);
        channel.current?.postMessage('changed');
        const low = next.ledger.materials.some(
          (m) =>
            m.available < 0 &&
            (operation.kind === 'material.wasted'
              ? m.id === operation.data.materialId
              : next.ledger.saleAdjustments
                  .filter((a) => all.some((o) => o.id === a.id))
                  .flatMap((a) => a.stockChanges ?? [])
                  .some((c) => c.materialId === m.id)),
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
  // A cashier's correction request: sent to the server for an Admin or higher to approve.
  async function sendCorrectionRequest(operation: SupervisedEvent) {
    if (demo || !shop || !online) throw Error('Connect to the internet to request a correction.');
    setBusy(true);
    try {
      await submitCorrectionRequest(shop.id, operation);
      setRequestsVersion((v) => v + 1);
      setMessage('Correction request sent. An Admin or Manager will review it.', 'success');
    } finally {
      setBusy(false);
    }
  }
  async function completeCheckout(operation: CheckoutEvent): Promise<CheckoutRecord> {
    if (busy || !ready || !scope || legacyConflict) throw Error('Please wait until the workspace is ready.');
    const target = scope;
    operation = {
      ...operation,
      data: {
        ...operation.data,
        accountId:
          operation.data.accountId ??
          defaultMoneyAccount(ledger, operation.data.methodLabel || operation.data.method),
        termsAndConditions:
          operation.data.termsAndConditions ?? branding.settings.documents.invoiceTerms ?? '',
      },
    };
    // "Assign to" chosen at checkout: assigned after the sale, not kept on the job itself.
    const assignTo = new Map(
      operation.data.jobs
        .filter((j) => (j as { assignTo?: string[] }).assignTo?.length)
        .map((j) => [j.id, (j as { assignTo?: string[] }).assignTo as string[]]),
    );
    operation = {
      ...operation,
      data: {
        ...operation.data,
        jobs: operation.data.jobs.map(
          ({ assignTo: _a, ...j }: (typeof operation.data.jobs)[number] & { assignTo?: string[] }) => j,
        ),
      },
    };
    setBusy(true);
    try {
      let next = await saveEvent(target, operation, !demo);
      if (activeScope.current !== target)
        throw Error('Workspace changed. The checkout was saved in the original workspace.');
      // Team work: the usual people for each stage are assigned to the new jobs.
      if (teamWork.on) {
        const ids = new Set(operation.data.jobs.map((j) => j.id));
        const sold = next.ledger.jobs.filter((j) => ids.has(j.id));
        const assign = [
          ...usualAssignEvents(next.ledger, sold, branding.settings, teamWork.actor),
          ...sold
            .filter((j) => assignTo.has(j.id))
            .map((j) => assignEvent(next.ledger, j, '', assignTo.get(j.id) as string[], teamWork.actor)),
        ];
        if (assign.length) next = await saveEvents(target, assign as TeamEvent[], !demo);
      }
      // Partners: what each partner job takes from the partner's stock (partners.mjs).
      const fromStock = next.ledger.jobs.filter(
        (j) => operation.data.jobs.some((x) => x.id === j.id) && (j.partner?.fromStock ?? 0) > 0,
      );
      if (fromStock.length)
        next = await saveEvents(
          target,
          fromStock.map((j) =>
            partnerEvent('partner.stock_taken', { id: j.partner!.itemId, jobId: j.id }),
          ) as never,
          !demo,
        );
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
            printReceipt(settings, record, docBusiness, pending),
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
  /** Conflict Inbox: an Admin reviews a drawer closed automatically overnight. */
  async function reviewDrawer(id: string, counted: number | null, note: string) {
    if (demo || !online || !scope || !shop) throw Error('Connect to review drawers.');
    const target = scope;
    const { data, error } = await supabase!.rpc('review_drawer_closing', {
      p_shop: shop.id,
      p_id: id,
      p_counted: counted,
      p_note: note,
    });
    if (error) throw Error(error.message);
    await mutateState(target, (current) => ({
      ...current,
      ledger: {
        ...current.ledger,
        drawerClosings: current.ledger.drawerClosings.map((d) => (d.id === id ? data : d)),
      },
    }));
    if (activeScope.current === target) setState(await readState(target));
    channel.current?.postMessage('changed');
    setMessage('Drawer reviewed.');
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
      freshPassword.current = true;
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
      canAccessPage('Sale Adjustments', shop?.accessLevel ?? 0, pageAccess));
  // A deposit with no job: corrected by the ranks the business allows (Business Settings →
  // Corrections); anyone else sends a request for one of them to approve.
  const depositRank = depositCorrectionRank(branding.settings.corrections);
  const canRequestDeposit = !demo && online && (shop?.accessLevel ?? 0) >= 1;
  const correctPaymentAction =
    canCorrectPayments || canRequestDeposit
      ? (payment: Payment) => {
          const deposit = isDepositWithoutJob(ledger, payment);
          if (deposit && !demo && (shop?.accessLevel ?? 0) < depositRank) setRequestingPayment(payment);
          else if (canCorrectPayments) setCorrectingPayment(payment);
          else setMessage('Ask an Admin or Manager to correct this payment.', 'warning');
        }
      : undefined;
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
  const [syncStatus, syncNow] = useAutoSync({
    scope,
    enabled: !demo && !!scope && ready && !switchUser,
    online,
    paused: busy || legacyConflict,
    pendingKey: state.pending.map((item) => item.id).join(','),
    pollMs: (branding.settings.security.syncMinutes ?? 2) * 60000,
    run: async () => {
      const target = scope;
      const shopId = shop!.id;
      const next = await syncLedger(target, shopId);
      slowSyncs.current = 0;
      if (activeScope.current === target) {
        setState(next);
        channel.current?.postMessage('changed');
      }
      // Tell the developer console how this device is doing; it may ask the device to sign out.
      const report = await reportDevice(target, shopId, next);
      // Once a day the History check runs in the background when the device is idle; its new
      // results are reported straight away.
      void historyCheckIfDue(target, next.ledger).then((ran) => {
        if (ran) void reportDevice(target, shopId, next, true);
      });
      void sendProblems(shopId);
      if (report.deviceLimit) {
        await Promise.all([
          supabase!.auth.signOut({ scope: 'local' }),
          businessAuth!.auth.signOut({ scope: 'local' }),
        ]);
        setSession(null);
        setBusinessSession(null);
        setShop(null);
        setMessage(
          `This business already uses its ${report.deviceLimit} devices. Ask the owner to sign out a device it no longer uses, or to upgrade the plan. Any unsent work is kept on this device.`,
          'error',
        );
      } else if (report.signOut) {
        await confirmSignedOut(shopId);
        await Promise.all([
          supabase!.auth.signOut({ scope: 'local' }),
          businessAuth!.auth.signOut({ scope: 'local' }),
        ]);
        setSession(null);
        setBusinessSession(null);
        setShop(null);
        setMessage(
          'This device was signed out by PrintShopLedger support. Any unsent work is kept and sends after the next sign-in.',
          'warning',
        );
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
      if (!/subscription has ended/i.test(errorMessage(error)))
        recordProblem('sync', errorMessage(error), {
          stack: error instanceof Error ? String(error.stack ?? '').slice(0, 1500) : '',
          appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
          pending: state.pending.length,
        });
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
  /** Download this business's copy afresh on the next sync, and sync now (unsent work goes first). */
  async function downloadAgain(target: string) {
    const next = await requestFullSync(target);
    if (activeScope.current === target) setState(next);
    syncNow();
  }
  // Business Settings → Security → History kept on devices: a device following the business default
  // downloads its copy again when the default changes.
  const businessKeep = branding.settings.security.historyKeep ?? 'all';
  const brandingReadyForKeep = branding.ready && branding.version > 0;
  useEffect(() => {
    if (demo || !scope || !brandingReadyForKeep) return;
    if (setBusinessKeep(scope, businessKeep)) void downloadAgain(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, businessKeep, brandingReadyForKeep]);
  // A branch switching between the main prices and its own: its devices receive every item priced
  // afresh (the items themselves did not change, so a normal sync would not bring them).
  const branchPriceMode =
    multiBranch && activeBranch
      ? `${activeBranch.id}:${ownPrices(branding.settings, activeBranch.id)}:${ownCustomers(branding.settings, activeBranch.id)}`
      : '';
  useEffect(() => {
    if (demo || !scope || !brandingReadyForKeep || !branchPriceMode) return;
    const key = `printshopledger:branch-prices:v1:${scope}`;
    let before: string | null = null;
    try {
      before = localStorage.getItem(key);
      localStorage.setItem(key, branchPriceMode);
    } catch {}
    if (before !== null && before !== branchPriceMode && before.split(':')[0] === activeBranch?.id)
      void downloadAgain(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, branchPriceMode, brandingReadyForKeep]);
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
  const syncTone =
    !ready || syncStatus === 'syncing'
      ? 'busy'
      : hasConflict || !online || syncStatus === 'retrying'
        ? 'warn'
        : state.pending.length
          ? 'pending'
          : 'ok';
  // Connection and sync state: the Wi-Fi icon with Connected / Offline and the changes waiting.
  const syncIndicator = !demo && scope && (
    <span className="sync-status" data-tone={syncTone} role="status" aria-live="polite" title={syncLabel}>
      <Icon name={online ? 'wifi' : 'sync'} />{' '}
      <span className="sync-label">
        {online ? 'Connected' : 'Offline'}
        <small>
          {syncLabel} · {state.pending.length} pending change{state.pending.length === 1 ? '' : 's'}
        </small>
      </span>
    </span>
  );
  // Drawers to review: every branch's from the main branch (General Manager), else this branch's.
  const drawerView = !multiBranch || (activeBranch?.id ?? MAIN) === MAIN ? state.ledger : ledger;
  // Alerts that used to sit above every page (repeating expenses, loans, late jobs, low stock
  // elsewhere, drawers to review) now wait in the Notices panel with the notice board.
  const autoClosedDrawers =
    !demo && (shop?.accessLevel ?? 0) >= 2 && allowed('Conflict Inbox')
      ? drawerView.drawerClosings.filter((d) => d.autoClosed && d.reviewStatus !== 'reviewed').length
      : 0;
  const goTo = (target: Page) => {
    setNoticesOpen(false);
    setPage(target);
  };
  // Team work: a Manager corrected one of my entries (owner's rule): I am told, until I dismiss it.
  const teamAlerts = [
    ...(session && teamOn(ledger, branding.settings)
      ? correctionAlerts(ledger, session.user.id, teamSeen).map(({ record, c }) => ({
          jobId: record.jobId,
          at: c.at ?? '',
          byLabel: c.byLabel,
          reason: c.reason,
          what: 'entry',
        }))
      : []),
    ...(session
      ? materialCorrectionAlerts(ledger, session.user.id, teamSeen).map(({ job, c }) => ({
          jobId: job.id,
          at: c.at,
          byLabel: c.byLabel,
          reason: c.reason,
          what: 'materials entry',
        }))
      : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const alerts: NoticeAlert[] = [
    ...(teamAlerts.length
      ? [
          {
            key: 'team-corrections',
            text: teamAlerts
              .slice(0, 3)
              .map(
                (a) =>
                  `Your ${a.what} on job #${a.jobId.slice(0, 8).toUpperCase()} was corrected by ${a.byLabel ?? 'a Manager'} (Manager): ${a.reason}`,
              )
              .join(' · '),
            action: {
              label: 'Open the job',
              icon: 'jobs' as const,
              run: () => {
                setSelectedJob(teamAlerts[0].jobId);
                goTo('Jobs');
              },
            },
            dismiss: () => {
              const at = teamAlerts[0].at;
              setTeamSeen(at);
              try {
                localStorage.setItem(`psl-team-seen:${scope}`, at);
              } catch {}
            },
          },
        ]
      : []),
    ...(loansDue.length
      ? [
          {
            key: 'loans',
            text: `Loan repayment${loansDue.length === 1 ? '' : 's'} ${loansDue
              .map(
                (l) =>
                  `${l.name} (${l.overdue ? 'overdue since' : 'due'} ${l.due}, owed ${currency(l.owed)})`,
              )
              .join(', ')}.`,
            action: { label: 'Accounts', icon: 'payments' as const, run: () => goTo('Accounts') },
            dismiss: () => setLoansSeen(true),
          },
        ]
      : []),
    ...(dueRepeatCount
      ? [
          {
            key: 'repeats',
            text: `${dueRepeatCount} repeating expense${dueRepeatCount === 1 ? ' is' : 's are'} due to record.`,
            action: { label: 'Review', icon: 'expenses' as const, run: () => goTo('Expenses') },
            dismiss: () => setRepeatsSeen(true),
          },
        ]
      : []),
    ...(lateJobs
      ? [
          {
            key: 'late',
            text: `${lateJobs} job(s) have been at a stage too long.`,
            action: {
              label: 'Show them',
              icon: 'jobs' as const,
              run: () => {
                dismissLateReminder(scope, businessDay(new Date().toISOString()));
                setLateSeen(true);
                try {
                  sessionStorage.setItem(LATE_FILTER_KEY, 'late');
                } catch {}
                goTo('Jobs');
              },
            },
            dismiss: () => {
              dismissLateReminder(scope, businessDay(new Date().toISOString()));
              setLateSeen(true);
            },
          },
        ]
      : []),
    ...(lowElsewhereCount
      ? [
          {
            key: 'low',
            text: `${lowElsewhereCount} item(s) are running low at other locations.`,
            action: {
              label: 'Open Materials',
              icon: 'materials' as const,
              run: () => {
                dismissLowStockReminder(scope, businessDay(new Date().toISOString()));
                setLowStockSeen(true);
                goTo('Materials');
              },
            },
            dismiss: () => {
              dismissLowStockReminder(scope, businessDay(new Date().toISOString()));
              setLowStockSeen(true);
            },
          },
        ]
      : []),
    ...(autoClosedDrawers
      ? [
          {
            key: 'drawers',
            text: `${autoClosedDrawers} drawer(s) were closed automatically and need a review.`,
            action: { label: 'Review drawers', icon: 'inbox' as const, run: () => goTo('Conflict Inbox') },
          },
        ]
      : []),
  ];
  const noticeCount = noticeBoard.unread + alerts.length;
  const canSeeNotices = (!demo && !!scope && !!shop?.id) || alerts.length > 0;
  // Sign out business on this device: in Business Settings (anyone allowed there). Managers and up
  // who can't open Business Settings find it in My Account instead (they always could sign out).
  const businessSignOut =
    supabase && !demo ? (
      <>
        <small>This device is signed in to {businessName}.</small>
        <button
          type="button"
          className="secondary danger-text"
          disabled={busy}
          onClick={async () => {
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
              // Start the next sign-in on the usual first page, not on Settings.
              setPage('Point of Service');
              setMessage('Business signed out.');
            }
          }}
        >
          <Icon name="logout" /> Sign out business
        </button>
      </>
    ) : undefined;
  // Top right of every page (in the title bar on phones): Notices, connection, the person.
  const headerTools = (
    <div className="header-tools">
      {canSeeNotices && (
        <button
          type="button"
          className={`secondary notice-button${noticeCount ? ' has-unread' : ''}`}
          aria-label={`Notices${noticeCount ? `, ${noticeCount} new` : ''}`}
          title="Notices"
          onClick={() => {
            void noticeBoard.refresh();
            setNoticesOpen(true);
          }}
        >
          <Icon name="notice" />
          <span className="notice-label"> Notices</span>
          {noticeCount > 0 && <span className="badge">{noticeCount}</span>}
        </button>
      )}
      {syncIndicator}
      <button
        type="button"
        className="avatar-button"
        aria-label="My Account"
        title={`${demo ? 'Local trial user' : shop?.staffName || 'Not signed in'}: My Account`}
        onClick={() => {
          setNoticesOpen(false);
          setPage('My Account');
        }}
      >
        {initialsFor(demo ? 'Trial' : shop?.staffName || '?', shop?.initials)}
      </button>
    </div>
  );
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
      freshPassword.current = true;
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
      freshPassword.current = true;
      const { data: started, error: failure } = await supabase!.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (failure) throw failure;
      // After a password sign-in, the next face/fingerprint unlock asks for the PIN once.
      void biometricOwner(shop.id).then((owner) => {
        if (owner?.userId === started.session?.user.id) void setNeedsPin(shop.id, true);
      });
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
  // Materials checks: below Admin, the check goes for approval (material-check.mjs).
  const checkActor = {
    ...catalogueActor,
    level: demo ? 5 : (shop?.accessLevel ?? 0),
    confirms: demo || (shop?.accessLevel ?? 0) >= confirmMaterialsRank(branding.settings),
  };
  // Team work (plans/job-assignment.md): on when the business switched it on and its server has it.
  async function saveTeam(events: TeamEvent[]) {
    if (busy || !ready || hasConflict || !scope || (!demo && (!session || !shop || shop.accessLevel === 0)))
      throw new Error('Please wait until the staff workspace is ready.');
    const target = scope;
    setBusy(true);
    setMessage('');
    try {
      const next = await saveEvents(target, events, !demo);
      if (activeScope.current !== target) return;
      setState(next);
      channel.current?.postMessage('changed');
    } finally {
      setBusy(false);
    }
  }
  const teamLedger = demo ? withTrialMember(ledger) : ledger;
  const teamWork: TeamWork = {
    on: teamOn(teamLedger, branding.settings),
    settings: teamSettings(branding.settings),
    ledger: teamLedger,
    actor: { id: checkActor.id, label: checkActor.label, level: checkActor.level },
    busy,
    save: saveTeam,
    saveJob: async (event) => {
      await save(event);
    },
    canExpense: allowed('Expenses'),
  };
  const currentJob = ledger.jobs.find((job) => job.id === selectedJob);
  // Auto-lock (Business Settings → Security): sign the user out after the idle time. The business
  // stays signed in, so the staff sign-in appears with empty fields.
  // Saving refuses work that takes stock below zero when the business blocks it.
  setStockBelowZeroBlocked(branding.settings.jobs.stockBelowZero === 'block');
  setMaterialsAtSale(branding.settings.production.materialsAt);
  setMinOrderRule(branding.settings.jobs.minOrder);
  const lockMinutes = branding.settings.security.autoLockMinutes;
  const lockChoices = lockSettings(branding.settings);
  // The settings kept on the device are enough to decide; the server's copy isn't waited for.
  const settingsKnownEarly = branding.ready || branding.version > 0;
  // PIN lock (My Account → PIN): the screen locks without signing out, and the PIN unlocks it on
  // this device, online or not. People without a PIN are signed out as before.
  const signOutStaff = (text: string) =>
    supabase!.auth.signOut({ scope: 'local' }).then(({ error }: { error: unknown }) => {
      if (error) return;
      setSwitchUser(false);
      setSession(null);
      setMessage(text, 'info');
    });
  // Who the app was last shown unlocked to on this page (see the lock screen below).
  const unlockedFor = useRef('');
  const pinLock = usePinLock({
    scope: demo ? '' : scope,
    userId: !demo && shop && session && shop.userId === session.user.id ? session.user.id : '',
    online,
    fetchHash: async () => {
      const { data, error } = await supabase!.rpc('my_pin', { p_shop: shop!.id });
      if (error) throw Error(error.message);
      return typeof data === 'string' && validPinHash(data) ? data : null;
    },
    signOut: signOutStaff,
    maxTries: lockChoices.pinTries,
    minLength: lockChoices.minPinLength,
    onLockout: () => {
      if (!shop || !session) return;
      noteLockout(shop.id, session.user.id);
      void setNeedsPin(shop.id, true);
    },
  });
  // A PIN is needed (Business Settings → Security → Staff must have a PIN, while auto-lock is on), or
  // the one just used is shorter than the business now requires: asked for before going on.
  const pinNeeded =
    !demo &&
    !!session &&
    !!supabase &&
    pinLock.ready &&
    !pinLock.locked &&
    ((lockChoices.requirePin && lockMinutes > 0 && !pinLock.hasPin && online) || pinLock.shortPin);
  // While locked, the app's open windows step aside (Modal.tsx), before anything is painted.
  const appLocked =
    !demo &&
    !!session &&
    !!scope &&
    (pinLock.locked || (lockedFlag(scope) === session.user.id && !pinLock.ready));
  useLayoutEffect(() => setAppLocked(appLocked), [appLocked]);
  // Remember people on this device (Business Settings → Security; device-people.ts): each
  // sign-in kept up to date as Supabase renews it; nobody is kept when the business turns it off.
  const freshPassword = useRef(false);
  const remembering = !demo && !!supabase && lockChoices.rememberPeople;
  const rememberingNow = useRef(remembering);
  rememberingNow.current = remembering;
  useEffect(() => {
    if (demo || !supabase || !session || !shop || !scope || !settingsKnownEarly) return;
    if (!lockChoices.rememberPeople) {
      // Only the business's own saved settings turn remembering off: for a moment after opening,
      // the settings can be the defaults (off), and that must not forget anyone. (Remembering is
      // only ever turned on by saving the settings, so a business with none has nobody to forget.)
      // Even saved settings can read as the defaults for a moment when someone else signs in (their
      // copy loads), so it must still be off a few seconds later.
      if (branding.version > 0) {
        const shopId = shop.id;
        const timer = setTimeout(() => {
          if (!rememberingNow.current) void forgetEveryone(shopId);
        }, 5000);
        return () => clearTimeout(timer);
      }
      return;
    }
    const password = freshPassword.current;
    freshPassword.current = false;
    void rememberPerson(
      shop.id,
      {
        userId: session.user.id,
        name: shop.staffName,
        username: shop.username,
        rank: shop.accessLevel,
        session,
      },
      { password, days: lockChoices.rememberDays, max: lockChoices.rememberMax },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    scope,
    settingsKnownEarly,
    lockChoices.rememberPeople,
    lockChoices.rememberDays,
    lockChoices.rememberMax,
  ]);
  // Signing the business out of this device forgets everyone it remembered for that business.
  const lastShop = useRef('');
  useEffect(() => {
    if (shop?.id && businessSession) lastShop.current = shop.id;
    else if (!businessSession && lastShop.current) {
      void forgetEveryone(lastShop.current);
      lastShop.current = '';
    }
  }, [shop?.id, businessSession]);
  const [others, setOthers] = useState<RememberedPerson[]>([]);
  useEffect(() => {
    if (!remembering || !shop || !session || !pinLock.locked) {
      setOthers([]);
      return;
    }
    let live = true;
    void listPeople(shop.id, lockChoices.rememberDays, lockChoices.rememberMax).then((people) => {
      if (live) setOthers(people.filter((p) => p.userId !== session.user.id));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remembering, shop?.id, session?.user.id, pinLock.locked]);
  /** Switch user with a PIN on the lock screen (remembered people): '' when switching, else why not. */
  async function switchTo(person: RememberedPerson, pin: string) {
    const shopId = shop!.id;
    const theirs = `${person.userId}:${shopId}`;
    const first = person.name.split(/\s+/)[0] || person.username;
    const record = await readPin(theirs, person.userId);
    if (!record) return `${first} has no PIN on this device. Choose "Someone else" and use their password.`;
    if (!(await checkPin(pin, record.hash))) {
      const tries = record.tries + 1;
      if (tries >= lockChoices.pinTries) {
        await writePin(theirs, person.userId, { ...record, tries: 0, locked: false });
        await forgetPerson(shopId, person.userId);
        if (biometric?.userId === person.userId) await setNeedsPin(shopId, true);
        setOthers((all) => all.filter((p) => p.userId !== person.userId));
        void reportPinLockout(person.userId);
        return `${lockChoices.pinTries} wrong PINs. ${first} must sign in with their password.`;
      }
      await writePin(theirs, person.userId, { ...record, tries });
      const left = lockChoices.pinTries - tries;
      return `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before ${first}'s password is needed.`;
    }
    if (biometric?.userId === person.userId) await setNeedsPin(shopId, false);
    return enterAs(person);
  }
  /** Open the app as a remembered person (their PIN or the device's face/fingerprint was checked). */
  async function enterAs(person: RememberedPerson) {
    const theirs = `${person.userId}:${shop!.id}`;
    const record = await readPin(theirs, person.userId);
    if (record) await writePin(theirs, person.userId, { ...record, tries: 0, locked: false });
    setLockedFlag(theirs, null);
    // The current person's latest sign-in is already remembered (above); put the chosen person's in
    // its place and open the app as them. Offline this works like reopening the app (keptOffline).
    localStorage.setItem(sessionKey(supabase), JSON.stringify(person.session));
    switchedIn(person.userId);
    window.location.reload();
    return '';
  }
  // Face/fingerprint unlock on this device (biometric.ts): who it belongs to, while it still matches
  // their PIN on this device (a changed or cleared PIN turns it off).
  const [biometric, setBiometric] = useState<BiometricOwner | null>(null);
  const [canBiometric, setCanBiometric] = useState(false);
  const [biometricEpoch, setBiometricEpoch] = useState(0);
  useEffect(() => {
    void biometricSupported().then(setCanBiometric);
  }, []);
  useEffect(() => {
    if (demo || !shop) {
      setBiometric(null);
      return;
    }
    let live = true;
    void (async () => {
      let owner = await biometricOwner(shop.id);
      if (owner) {
        const record = await readPin(`${owner.userId}:${shop.id}`, owner.userId);
        if (!record || record.hash !== owner.pinHash || !lockChoices.allowBiometric) {
          if (!record || record.hash !== owner.pinHash) await removeBiometric(shop.id);
          owner = null;
        }
      }
      if (live) setBiometric(owner);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    demo,
    shop?.id,
    session?.user.id,
    pinLock.hasPin,
    pinLock.locked,
    lockChoices.allowBiometric,
    biometricEpoch,
  ]);
  /** Too many wrong PINs: Admins and above get a notice (sent now, or when next online). */
  async function reportPinLockout(userId: string) {
    if (!shop) return;
    noteLockout(shop.id, userId);
    if (online) await sendPinLockouts();
  }
  const sendPinLockouts = () =>
    shop && supabase && session
      ? sendLockouts(shop.id, (userId, device) =>
          supabase!.rpc('report_pin_lockout', { p_shop: shop.id, p_user: userId, p_device: device }),
        )
      : Promise.resolve();
  useEffect(() => {
    if (online && scope && !pinLock.locked) void sendPinLockouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, scope, pinLock.locked]);
  // Remembered people's waiting work goes up as them, with their own sign-in, while someone else
  // uses the app. Someone whose sign-in has ended, or who left the business, is forgotten.
  useEffect(() => {
    if (!remembering || !online || !shop || !session) return;
    const shopId = shop.id;
    const me = session.user.id;
    const { rememberDays: days, rememberMax: max } = lockChoices;
    let live = true;
    const run = async () => {
      for (const person of await listPeople(shopId, days, max)) {
        if (!live || person.userId === me) continue;
        const theirs = `${person.userId}:${shopId}`;
        if (!(await readState(theirs)).pending.length) continue;
        try {
          await syncRememberedWork(
            theirs,
            shopId,
            person.session as { access_token: string; refresh_token: string },
            (renewed) =>
              rememberPerson(
                shopId,
                { ...person, session: renewed },
                { password: false, days, max, seen: false },
              ),
          );
        } catch (error) {
          const text = String((error as { message?: string })?.message ?? error);
          if ((error as { name?: string })?.name === 'AuthApiError' || /access denied/i.test(text))
            await forgetPerson(shopId, person.userId);
        }
      }
    };
    void run();
    const timer = setInterval(run, (branding.settings.security.syncMinutes ?? 2) * 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remembering, online, shop?.id, session?.user.id, lockChoices.rememberDays, lockChoices.rememberMax]);
  /** The others this device remembers, read now. */
  const loadOthers = async () =>
    shop && session
      ? (await listPeople(shop.id, lockChoices.rememberDays, lockChoices.rememberMax)).filter(
          (p) => p.userId !== session.user.id,
        )
      : [];
  /** Whether this device remembers the person signed in now (so stepping away keeps them). */
  const isRemembered = async () =>
    !!shop &&
    !!session &&
    (await listPeople(shop.id, lockChoices.rememberDays, lockChoices.rememberMax)).some(
      (p) => p.userId === session.user.id,
    );
  /** Someone else signs in with their password; the remembered people stay remembered. */
  const stepAway = () => {
    localStorage.removeItem(sessionKey(supabase));
    window.location.reload();
  };
  // Lock when the app opens (Business Settings → Security, on by default): a sign-in kept from
  // before opens at the PIN, or at the password for someone without a PIN (offline, without a PIN,
  // it stays open so work can go on). A sign-in made now is not locked again.
  // Until this has been decided, nothing of the app is drawn (see lockPending below), so a reload never
  // shows the last screen before the lock screen.
  const [openChecked, setOpenChecked] = useState('');
  // The settings kept on the device are enough to decide; the server's copy isn't waited for.
  const settingsKnown = settingsKnownEarly;
  useEffect(() => {
    if (demo || !session || !scope || keptStaff === undefined || !pinLock.ready || !settingsKnown) return;
    const id = session.user.id;
    if (openChecked === id) return;
    // Automated checks (navigator.webdriver) reload pages constantly; they are not "opening the app".
    if (
      keptStaff !== id ||
      branding.settings.security.lockOnOpen === false ||
      navigator.webdriver ||
      switchedIn() === id
    ) {
      switchedIn(null);
      setOpenChecked(id);
      return;
    }
    if (pinLock.hasPin) {
      if (pinLock.locked) setOpenChecked(id);
      else void pinLock.lock().finally(() => setOpenChecked(id));
    } else if (online) {
      // Stays covered until the sign-out lands, so the app isn't shown on the way out.
      void signOutStaff('Sign in to continue.').finally(() => setOpenChecked(id));
    } else setOpenChecked(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, session, scope, keptStaff, pinLock.ready, pinLock.hasPin, settingsKnown, openChecked]);
  const savePin = async (hash: string | null) => {
    const { error } = await supabase!.rpc('set_my_pin', { p_shop: shop!.id, p_hash: hash });
    if (error) throw Error(error.message);
    await pinLock.saved(hash);
  };
  useAutoLock({
    minutes: lockMinutes,
    active: !demo && !!session && !!supabase && !pinLock.locked,
    // With a PIN the lock needs no connection to undo, so it locks offline too.
    online: online || pinLock.hasPin,
    busy,
    onLock: async () => {
      if (await pinLock.lock()) return;
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

  // "Tell customer": the ready message for a job, with the business's wording.
  const tellCustomer = useCallback(
    (job: Job) =>
      readyMessage(ledger, job, {
        business: businessName,
        template: branding.settings.jobs.readyMessage,
        terms: branding.settings.terms,
        messages: branding.settings.messages,
      }),
    [
      ledger,
      businessName,
      branding.settings.jobs.readyMessage,
      branding.settings.terms,
      branding.settings.messages,
    ],
  );
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

  // Nothing of the app is drawn until the lock is settled: a device locked before the reload (the
  // flag is read straight from device storage) opens at the lock screen, and until the PIN data and
  // the open lock are checked only a plain screen shows.
  const flaggedNow = !demo && !!session && !!scope && lockedFlag(scope) === session.user.id;
  const lockPending = !demo && !!session && !!scope && (!pinLock.ready || openChecked !== session.user.id);
  const lockScreen =
    !demo && session && (pinLock.locked || (flaggedNow && !pinLock.ready)) ? (
      <PinLockScreen
        name={shop?.staffName ?? ''}
        username={shop?.username ?? ''}
        minutes={lockMinutes}
        onUnlock={async (pin) => {
          const problem = await pinLock.unlock(pin);
          if (!problem && biometric?.userId === session.user.id) await setNeedsPin(shop!.id, false);
          return problem;
        }}
        biometric={
          biometric &&
          canBiometric &&
          !biometric.needsPin &&
          (biometric.userId === session.user.id ||
            (remembering && others.some((p) => p.userId === biometric.userId)))
            ? {
                name: biometric.name || biometric.username,
                onUse: async () => {
                  if (!(await verifyBiometric(biometric)))
                    return 'Face/fingerprint not recognised. Use the PIN.';
                  if (biometric.userId === session.user.id) return pinLock.unlockTrusted();
                  const person = (await loadOthers()).find((p) => p.userId === biometric.userId);
                  return person ? enterAs(person) : 'Use the PIN.';
                },
              }
            : undefined
        }
        onSwitchUser={async () => {
          // Remembering people: step away without signing out, so this person can come back with
          // their PIN. Otherwise sign out as before.
          // (Who the device remembers decides, not the settings now: for a moment after someone
          // else signs in, their copy of the settings can read as the defaults. Turning remembering
          // off forgets everyone, so anyone still listed may be offered.)
          if (!demo && supabase && (await isRemembered())) return stepAway();
          await pinLock.clear();
          signOutStaff('Signed out. The next person can sign in.');
        }}
        loadPeople={!demo && supabase ? loadOthers : undefined}
        onSwitchTo={async (userId, pin) => {
          const person = (await loadOthers()).find((p) => p.userId === userId);
          return person ? switchTo(person, pin) : 'Choose who you are again.';
        }}
        onSignOutBusiness={
          (shop?.accessLevel ?? 0) >= 3
            ? async () => {
                await pinLock.clear();
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
                  setPage('Point of Service');
                  setMessage('Business signed out.');
                }
              }
            : undefined
        }
      />
    ) : null;
  // Locked while working: the app stays in place behind the lock screen (hidden and unreachable), so
  // an open sale or form is still there after unlocking. Only the person it was locked for can unlock
  // into it; switching to someone else reloads the app. A device that opens already locked shows only
  // the lock screen: nothing of the app has been drawn yet.
  if (lockScreen && unlockedFor.current !== session?.user.id) return lockScreen;
  if (!lockScreen && session && !lockPending) unlockedFor.current = session.user.id;
  if (lockPending && !lockScreen)
    return <StartupScreen error="" onRetry={() => setAuthEpoch((value) => value + 1)} />;
  if (needBranchChoice && !lockScreen)
    return (
      <AuthShell>
        <h1>Choose your branch</h1>
        <p>{businessName} has more than one branch. Which branch is this device in today?</p>
        <div className="branch-choices">
          {branchChoices.map((b) => (
            <button key={b.id} type="button" onClick={() => void changeBranch(b.id)}>
              <Icon name="customers" /> {b.name}
              {b.address && <small>{b.address}</small>}
            </button>
          ))}
        </div>
      </AuthShell>
    );

  if (restriction === 'locked' && !lockScreen)
    return (
      <AuthShell>
        <h1>{shop?.name ?? 'PrintShopLedger'}</h1>
        <p role="alert">
          This business’s PrintShopLedger subscription has ended. Contact PrintShopLedger to renew; your
          records are safe and come back as soon as it is renewed.
        </p>
        {subscription.message && <p>{subscription.message}</p>}
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await Promise.all([
              supabase!.auth.signOut({ scope: 'local' }),
              businessAuth!.auth.signOut({ scope: 'local' }),
            ]);
            setSession(null);
            setBusinessSession(null);
            setShop(null);
          }}
        >
          <Icon name="close" /> Sign out business
        </button>
      </AuthShell>
    );

  const app = (
    <BusinessOptionsContext.Provider
      value={{
        ...branding.settings.options,
        // In the business's order (Business Settings → Dropdowns & workflow).
        paymentMethods: orderMethods(
          accountPaymentOptions(ledger, branding.settings.options.paymentMethods),
          branding.settings.options.methodOrder,
        ),
      }}
    >
      <TermsProvider value={branding.settings.terms}>
        <ReadyMessageContext.Provider value={tellCustomer}>
          <MessagesContext.Provider
            value={{
              settings: branding.settings.messages,
              business: businessName,
              legacyReady: branding.settings.jobs.readyMessage ?? '',
              customers: state.ledger.customers,
            }}
          >
            <TemplateAuditContext.Provider
              value={demo || canSeeTemplateCosts(branding.settings.pricing, shop?.accessLevel ?? 0)}
            >
              <TemplateDocumentContext.Provider
                value={{
                  business: docBusiness,
                  scope,
                  preparedBy: demo ? 'Local trial user' : shop?.staffName || session?.user.email || '',
                }}
              >
                <PeriodDefaultsContext.Provider value={branding.settings.periods}>
                  <div className="app">
                    <Sidebar
                      title={businessName}
                      trailing={mobileLayout ? headerTools : null}
                      header={
                        <div className="brand">
                          {branding.sidebarLogo ? (
                            <img
                              className="sidebar-business-logo"
                              src={branding.sidebarLogo}
                              alt={businessName + ' logo'}
                            />
                          ) : (
                            <strong className="brand-title">{businessName}</strong>
                          )}
                        </div>
                      }
                      footer={
                        <div className="sidebar-user sidebar-user-card">
                          <span className="user-avatar" aria-hidden="true">
                            {initialsFor(demo ? 'Trial' : shop?.staffName || '?', shop?.initials)}
                          </span>
                          <span className="sidebar-user-text">
                            <strong>{demo ? 'trial' : shop?.username || 'Not signed in'}</strong>
                            <small className="staff-rank">
                              {demo ? 'Trial' : (shop?.role ?? '').replace(/_/g, ' ')}
                            </small>
                          </span>
                          <span className="sidebar-user-actions">
                            {!demo && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Lock"
                                title={
                                  pinLock.hasPin
                                    ? 'Lock (your PIN unlocks it)'
                                    : 'Lock (sign in again to continue)'
                                }
                                disabled={busy}
                                onClick={async () => {
                                  if (!(await pinLock.lock()))
                                    signOutStaff('Locked. Sign in to continue, or set a PIN in My Account.');
                                }}
                              >
                                <Icon name="lock" />
                              </button>
                            )}
                            {demo && supabase && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Business sign in"
                                title="Business sign in"
                                disabled={busy}
                                onClick={() => setDemo(false)}
                              >
                                <Icon name="login" />
                              </button>
                            )}
                            {!demo && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Switch user"
                                title="Switch user"
                                disabled={busy || !online}
                                onClick={() => {
                                  setSwitchUser(true);
                                  setMessage('');
                                }}
                              >
                                <Icon name="switchUser" />
                              </button>
                            )}
                            {!demo && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Logout"
                                title="Logout (the business stays signed in)"
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
                                <Icon name="logout" />
                              </button>
                            )}
                          </span>
                          <span className="sidebar-user-name">
                            {demo ? 'Local trial user' : shop?.staffName || ''}
                          </span>
                        </div>
                      }
                    >
                      <nav aria-label="Main">
                        {(navigationPages as Page[])
                          .filter(
                            (item) =>
                              // Material Waste lives inside Materials; it has its own menu entry only for
                              // someone who can record waste but not open Materials.
                              !(
                                (item === 'Material Waste' || item === 'Stock Count') &&
                                allowed('Materials')
                              ) &&
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
                                  page === item ||
                                  (item === 'Materials' &&
                                    (page === 'Material Waste' || page === 'Stock Count'))
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
                        <button
                          className={helpFor !== undefined ? 'active' : ''}
                          onClick={() => setHelpFor(null)}
                        >
                          <Icon name="help" />
                          Help
                        </button>
                      </nav>
                    </Sidebar>
                    <main>
                      <header>
                        <div>
                          <span className="eyebrow">
                            PrintShopLedger
                            {demo
                              ? ' · Local trial'
                              : multiBranch && activeBranch
                                ? ` · ${activeBranch.name}`
                                : ''}
                          </span>
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
                        {!mobileLayout && headerTools}
                      </header>
                      {subscriptionBanner && (
                        <p
                          className={`notice subscription-notice ${subscriptionBanner.tone === 'error' ? 'notice-error' : subscriptionBanner.tone === 'warning' ? 'notice-warning' : ''}`}
                          role={subscriptionBanner.tone === 'info' ? 'status' : 'alert'}
                        >
                          {subscriptionBanner.text}
                        </p>
                      )}
                      {noticesOpen && (
                        <NoticeBoard
                          shopId={shop?.id ?? ''}
                          canPost={!demo && (shop?.accessLevel ?? 0) >= 3}
                          alerts={alerts}
                          notices={noticeBoard.notices}
                          online={online}
                          onChanged={noticeBoard.refresh}
                          onClose={() => setNoticesOpen(false)}
                          branch={
                            multiBranch
                              ? {
                                  id: activeBranch?.id ?? MAIN,
                                  names: branchNames,
                                  everywhere: (shop?.accessLevel ?? 0) >= 4,
                                }
                              : undefined
                          }
                        />
                      )}
                      {!noticesOpen && noticeBoard.notices.some((n) => n.pinned && !n.readAt) && (
                        <div className="notice" role="status">
                          <Icon name="notice" /> New notice:{' '}
                          <strong>{noticeBoard.notices.find((n) => n.pinned && !n.readAt)!.title}</strong>{' '}
                          <button className="secondary" onClick={() => setNoticesOpen(true)}>
                            Read it
                          </button>
                        </div>
                      )}
                      {(page === 'Point of Service' || page === 'Jobs') && (
                        <PendingChecksBanner
                          ledger={ledger}
                          busy={busy || legacyConflict}
                          actor={checkActor}
                          onSave={async (event) => {
                            await save(event);
                          }}
                        />
                      )}
                      {helpFor !== undefined && (
                        <HelpPanel
                          page={helpFor}
                          rank={demo ? 5 : (shop?.accessLevel ?? 1)}
                          businessName={businessName}
                          onClose={() => setHelpFor(undefined)}
                        />
                      )}
                      {pinNeeded && (
                        <Modal
                          title={pinLock.shortPin ? 'Choose a longer PIN' : 'Set your PIN'}
                          busy={busy}
                          closeLabel="Sign out"
                          onClose={() => void signOutStaff('Signed out. Set a PIN next time you sign in.')}
                        >
                          <p>
                            {pinLock.shortPin
                              ? `${businessName} now asks for a PIN of at least ${lockChoices.minPinLength} digits. Choose a new one to go on.`
                              : `${businessName} asks everyone to have a PIN. When the app locks, your PIN unlocks it, even without internet.`}
                          </p>
                          <PinForm
                            has={pinLock.hasPin}
                            min={lockChoices.minPinLength}
                            required
                            disabled={busy}
                            setBusy={setBusy}
                            save={savePin}
                            onMessage={(text, tone) => setMessage(text, tone ?? 'success')}
                          />
                        </Modal>
                      )}
                      {switchUser && (
                        <Modal title="Switch user" busy={busy} onClose={() => setSwitchUser(false)}>
                          <p>Business: {shop?.name}. Sign in with your staff username and password.</p>
                          <StaffLoginForm
                            feedback={feedback}
                            busy={busy}
                            online={online}
                            onSubmit={staffLogin}
                          />
                          <FeedbackBanner message={message} tone={messageTone} login />
                        </Modal>
                      )}
                      {staleApp && !needRefresh && (
                        <div className="notice notice-warning" role="alert">
                          Part of the app could not load. If it keeps failing, reload the app; saved work
                          stays on this device.{' '}
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => window.location.reload()}
                          >
                            <Icon name="sync" /> Reload app
                          </button>
                        </div>
                      )}
                      {needRefresh && (
                        <div className="notice">
                          An app update is ready.{' '}
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => void updateServiceWorker(true)}
                          >
                            <Icon name="sync" /> Update app
                          </button>
                        </div>
                      )}
                      <FeedbackBanner message={branding.error} tone="warning" />
                      <FeedbackBanner message={message} tone={messageTone} />
                      <ShareChooser />
                      {hasConflict && !canReviewConflicts && (
                        <div className="notice" role="alert">
                          <strong>Admin review required.</strong>
                          <p>
                            Conflicts have been sent to the business inbox when connected. An Admin, Manager
                            or Developer can review them remotely. Sales sharing affected stock or customer
                            accounts wait; unrelated sales can continue. Pending work remains saved on this
                            device.
                          </p>
                          <button
                            className="secondary"
                            disabled={!online || busy}
                            onClick={() => setSupervisorLogin(true)}
                          >
                            <Icon name="audit" /> Supervisor review
                          </button>
                        </div>
                      )}
                      {Object.keys(state.syncConflicts ?? {}).length > 0 && canReviewConflicts && (
                        <div className="notice notice-warning">
                          {heldWork.eventIds.size} pending operations await review. Unaffected sales can
                          continue.{' '}
                          <button className="secondary" onClick={() => setPage('Conflict Inbox')}>
                            <Icon name="inbox" /> Open conflict inbox
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
                            <Icon name="close" /> End supervisor review
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
                            <Icon name="details" /> Review changes
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
                          defaultTerms={branding.settings.documents.invoiceTerms}
                          canChooseWorkflow={demo || (shop?.accessLevel ?? 0) >= 2}
                          discountPolicy={discountPolicy(
                            branding.settings.discounts,
                            demo ? 5 : (shop?.accessLevel ?? 0),
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
                            <button disabled={busy || !online}>
                              <Icon name="add" /> Create workspace
                            </button>
                          </form>
                          <p className="muted">
                            If you should join an existing business, ask its administrator to add your
                            account.
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
                                ledger={masterLedger}
                                loadFullHistory={
                                  shop && !demo && state.ledger.historySummary?.cutoff
                                    ? async () => viewOf(await fetchFullLedger(scope, shop.id))
                                    : undefined
                                }
                                historyKey={`${scope}:${masterBranch}:${activeBranch?.id ?? ''}`}
                                branchControl={branchControl}
                                ready={ready}
                                online={online}
                                pending={state.pending.length}
                                lastSynced={state.lastSynced}
                                branding={docBusiness}
                                businessName={businessName}
                                customerId={reportCustomer}
                                onCustomerChange={setReportCustomer}
                                payeeId={reportPayee}
                                onPayeeChange={setReportPayee}
                                access={{
                                  customers:
                                    demo || canAccessPage('Customers', shop?.accessLevel ?? 0, pageAccess),
                                  jobs: demo || canAccessPage('Jobs', shop?.accessLevel ?? 0, pageAccess),
                                  payments:
                                    demo || canAccessPage('Payments', shop?.accessLevel ?? 0, pageAccess),
                                  expenses:
                                    demo || canAccessPage('Expenses', shop?.accessLevel ?? 0, pageAccess),
                                  costs:
                                    demo ||
                                    canSeeTemplateCosts(branding.settings.pricing, shop?.accessLevel ?? 0),
                                  stock:
                                    demo ||
                                    canAccessPage('Stock History', shop?.accessLevel ?? 0, pageAccess) ||
                                    canAccessPage('Materials', shop?.accessLevel ?? 0, pageAccess),
                                  accounts:
                                    demo || canAccessPage('Accounts', shop?.accessLevel ?? 0, pageAccess),
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
                                onReceipt={setReceipt}
                                countDue={
                                  allowed('Stock Count') &&
                                  countReminderDue(ledger, branding.settings.production.stockCount)
                                }
                                onCount={() => setPage('Stock Count')}
                                ledger={masterLedger}
                                branchControl={branchControl}
                                branches={masterBranches}
                                ready={ready}
                                online={online}
                                pending={state.pending.length}
                                lastSynced={state.lastSynced}
                                access={{
                                  customers:
                                    demo || canAccessPage('Customers', shop?.accessLevel ?? 0, pageAccess),
                                  sales: demo || canAccessPage('Jobs', shop?.accessLevel ?? 0, pageAccess),
                                  payments:
                                    demo || canAccessPage('Payments', shop?.accessLevel ?? 0, pageAccess),
                                  expenses:
                                    demo || canAccessPage('Expenses', shop?.accessLevel ?? 0, pageAccess),
                                  materials:
                                    demo || canAccessPage('Materials', shop?.accessLevel ?? 0, pageAccess),
                                  costs:
                                    demo ||
                                    canSeeTemplateCosts(branding.settings.pricing, shop?.accessLevel ?? 0),
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
                              requests={
                                !demo && shop ? (
                                  <PendingRequestsPanel
                                    ledger={ledger}
                                    actor={salesActor}
                                    busy={busy || hasConflict}
                                    canSave={online}
                                    canApproveDeposits={demo || (shop.accessLevel ?? 0) >= depositRank}
                                    version={requestsVersion}
                                    load={() => listCorrectionRequests(shop.id)}
                                    onApprove={approveOperation}
                                    onReject={(id, note) => rejectCorrectionRequest(shop.id, id, note)}
                                  />
                                ) : undefined
                              }
                            />
                          ) : page === 'Partners' ? (
                            <PartnersPage
                              ledger={ledger}
                              level={demo ? 5 : (shop?.accessLevel ?? 0)}
                              busy={busy || hasConflict}
                              canSave={demo || online}
                              onSave={saveCount}
                              onSaveService={markPartnerService}
                            />
                          ) : page === 'Stock Count' ? (
                            <>
                              {materialTabs}
                              <StockCountPage
                                ledger={ledger}
                                level={demo ? 5 : (shop?.accessLevel ?? 0)}
                                actor={catalogueActor}
                                settings={branding.settings.production.stockCount}
                                busy={busy || hasConflict}
                                canSave={demo || online}
                                onSave={saveCount}
                              />
                            </>
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
                              <section className="panel editor">
                                <h2>Conflict inbox</h2>
                                <p>Remote reviews are available in a connected business workspace.</p>
                              </section>
                            ) : (
                              <>
                                {(shop?.accessLevel ?? 0) >= 2 && (
                                  <DrawerReviews
                                    closings={drawerView.drawerClosings}
                                    ledger={drawerView}
                                    branchName={
                                      multiBranch && drawerView === state.ledger
                                        ? (id) =>
                                            branchNames[id ?? MAIN] ?? branchNames[MAIN] ?? 'Main branch'
                                        : undefined
                                    }
                                    online={online}
                                    onReview={reviewDrawer}
                                  />
                                )}
                                <ConflictInbox
                                  canConfigureAccounts={shop?.accessLevel === 5}
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
                              </>
                            )
                          ) : page === 'My Account' ? (
                            <>
                              {businessSignOut &&
                                (shop?.accessLevel ?? 0) >= 3 &&
                                !allowed('Business Settings') && (
                                  <section className="panel device-sign-out">{businessSignOut}</section>
                                )}
                              <AccountPage
                                key={`${scope}:${shop?.username}:${shop?.initials ?? ''}`}
                                shopId={shop?.id ?? ''}
                                userId={session?.user.id ?? ''}
                                businessAccount={!!session && session.user.id === businessSession?.user.id}
                                username={shop?.username ?? ''}
                                online={online}
                                demo={demo}
                                themePreference={branding.preference}
                                setThemePreference={branding.setTheme}
                                staffName={shop?.staffName ?? ''}
                                initials={shop?.initials ?? ''}
                                pin={
                                  !demo && supabase
                                    ? {
                                        has: pinLock.hasPin,
                                        min: lockChoices.minPinLength,
                                        required: lockChoices.requirePin && lockMinutes > 0,
                                        save: savePin,
                                      }
                                    : undefined
                                }
                                deviceControls={
                                  !demo && supabase && shop && session ? (
                                    <DeviceLockOptions
                                      name={shop.staffName || shop.username}
                                      remembering={remembering}
                                      rememberDays={lockChoices.rememberDays}
                                      onForgetMe={async () => {
                                        await forgetPerson(shop.id, session.user.id);
                                      }}
                                      biometric={
                                        lockChoices.allowBiometric && canBiometric
                                          ? {
                                              owner: biometric?.name || biometric?.username || null,
                                              mine: biometric?.userId === session.user.id,
                                              hasPin: pinLock.hasPin,
                                              onTurnOn: async () => {
                                                const scopeHere = `${session.user.id}:${shop.id}`;
                                                const record = await readPin(scopeHere, session.user.id);
                                                if (!record) throw Error('Set a PIN first.');
                                                await registerBiometric(shop.id, {
                                                  userId: session.user.id,
                                                  name: shop.staffName || shop.username,
                                                  username: shop.username,
                                                  pinHash: record.hash,
                                                });
                                                setBiometricEpoch((value) => value + 1);
                                              },
                                              onTurnOff: async () => {
                                                await removeBiometric(shop.id);
                                                setBiometricEpoch((value) => value + 1);
                                              },
                                            }
                                          : undefined
                                      }
                                      disabled={busy}
                                      setBusy={setBusy}
                                      onMessage={(text, tone) => setMessage(text, tone ?? 'success')}
                                    />
                                  ) : undefined
                                }
                                onChanged={(message) => {
                                  setMessage(message);
                                  setStaffEpoch((value) => value + 1);
                                }}
                              />
                              {branchChoices.length > 1 && (
                                <BranchSwitch
                                  branches={branchChoices}
                                  activeId={activeBranch?.id ?? ''}
                                  activeName={activeBranch?.name ?? ''}
                                  pending={state.pending.length}
                                  onChange={(id, name) => {
                                    void changeBranch(id);
                                    setMessage(`This device now works in ${name}.`);
                                  }}
                                />
                              )}
                              <DeviceStorageCard
                                pending={state.pending.length}
                                lastSynced={state.lastSynced}
                                syncing={syncStatus === 'syncing'}
                                history={scope ? { ledger: state.ledger, scope } : undefined}
                                onKeepChange={
                                  demo || !scope
                                    ? undefined
                                    : async (choice) => {
                                        setKeepChoice(scope, choice);
                                        await downloadAgain(scope);
                                      }
                                }
                                onSyncAll={demo || !scope ? undefined : () => downloadAgain(scope)}
                              />
                            </>
                          ) : page === 'Edit Products' ? (
                            <EditProductsPage
                              key={scope}
                              ledger={ledger}
                              ready={ready}
                              busy={busy || hasConflict}
                              onEdit={(id) => setProductEdit(id)}
                              actor={catalogueActor}
                              onSaveMany={canEditCatalogue ? saveCatalogueMany : undefined}
                              onSaveStock={demo || shop?.role !== 'cashier' ? saveCatalogue : undefined}
                              businessName={businessName}
                              canRecordPurchase={demo || allowed('Expenses')}
                              onSaveExpense={saveCatalogue}
                            />
                          ) : page === 'Pricing Templates' ? (
                            <PricingTemplatesPage
                              key={scope}
                              settings={businessBranding.settings}
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
                              teamReady={demo || teamReady(state.ledger)}
                              settings={businessBranding.settings}
                              branchList={
                                !demo && multiBranch
                                  ? openBranches.filter((b) => b.kind !== 'store' && b.id !== MAIN)
                                  : undefined
                              }
                              branchItems={
                                chooseItems
                                  ? { services: state.ledger.services, save: saveBranchItems, online }
                                  : undefined
                              }
                              version={branding.version}
                              ready={branding.ready}
                              online={online}
                              demo={demo}
                              modifiedAt={branding.modifiedAt}
                              accessLevel={demo ? 5 : (shop?.accessLevel ?? 0)}
                              onSave={branding.save}
                              onReload={branding.reload}
                              deviceSignOut={businessSignOut}
                              accountSettings={
                                <AccountsPage
                                  configurationOnly
                                  canConfigure={demo || (shop?.accessLevel ?? 0) >= 4}
                                  ledger={allBranchesLedger({
                                    ...state.ledger,
                                    pricing: branding.settings.pricing,
                                  })}
                                  branches={multiBranch ? openBranches : undefined}
                                  seesAll={ownerView}
                                  currentBranch={activeBranch?.id ?? 'main'}
                                  busy={busy || hasConflict}
                                  actor={salesActor}
                                  onSave={saveCatalogue}
                                  brand={docBusiness}
                                />
                              }
                              loadStaff={
                                demo || !shop
                                  ? undefined
                                  : async () => {
                                      // The owner sees every branch's staff here, from any branch.
                                      let { data, error } = await supabase!.rpc(
                                        (shop.accessLevel ?? 0) >= 4 ? 'list_all_staff' : 'list_shop_users',
                                        { p_shop: shop.id },
                                      );
                                      // Until the server has list_all_staff: this branch's staff.
                                      if (error?.code === 'PGRST202')
                                        ({ data, error } = await supabase!.rpc('list_shop_users', {
                                          p_shop: shop.id,
                                        }));
                                      if (error) throw error;
                                      return data ?? [];
                                    }
                              }
                            />
                          ) : page === 'Payees' ? (
                            <PayeesPage
                              ledger={ledger}
                              businessName={businessName}
                              onStatement={
                                demo || canAccessPage('Reports', shop?.accessLevel ?? 0, pageAccess)
                                  ? (id) => {
                                      setReportPayee(id);
                                      setPage('Reports');
                                    }
                                  : undefined
                              }
                              branches={ownerBranches}
                              busy={busy || hasConflict}
                              actor={salesActor}
                              onSave={saveCatalogue}
                            />
                          ) : page === 'Accounts' ? (
                            <AccountsPage
                              canHide={demo || (shop?.accessLevel ?? 0) >= 4}
                              ledger={
                                ownerView
                                  ? allBranchesLedger({ ...state.ledger, pricing: branding.settings.pricing })
                                  : ledger
                              }
                              branches={multiBranch ? openBranches : undefined}
                              seesAll={ownerView}
                              currentBranch={activeBranch?.id ?? 'main'}
                              busy={busy || hasConflict}
                              actor={salesActor}
                              onSave={saveCatalogue}
                              brand={docBusiness}
                              onSaveExpense={saveCatalogue}
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
                            <>
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
                              {!demo && shop && shop.accessLevel < 2 && (
                                <MyCorrectionsPanel
                                  ledger={ledger}
                                  userId={session!.user.id}
                                  busy={busy || hasConflict}
                                  online={online}
                                  version={requestsVersion}
                                  load={() => listCorrectionRequests(shop.id)}
                                  onRequest={setRequestingJob}
                                  onWithdraw={(id) => withdrawCorrectionRequest(shop.id, id)}
                                />
                              )}
                            </>
                          ) : page === 'Payment Reminders' ? (
                            <RemindersPage
                              key={scope}
                              ledger={ledger}
                              ready={ready}
                              busy={busy || legacyConflict}
                              branding={docBusiness}
                              actor={salesActor}
                              onSave={saveCatalogue}
                              onReceivePayment={(id) => openPayment(id)}
                              onOpenCustomer={
                                demo || canAccessPage('Customers', shop?.accessLevel ?? 0, pageAccess)
                                  ? (id) => {
                                      setCustomerToOpen(id);
                                      setPage('Customers');
                                    }
                                  : undefined
                              }
                            />
                          ) : page === 'Quotations' ? (
                            <QuotationsPage
                              key={scope}
                              ledger={ledger}
                              scope={scope}
                              ready={ready}
                              busy={busy || legacyConflict}
                              branding={docBusiness}
                              actor={salesActor}
                              discountPolicy={discountPolicy(
                                branding.settings.discounts,
                                demo ? 5 : (shop?.accessLevel ?? 0),
                              )}
                              canDeleteAny={demo || (shop?.accessLevel ?? 0) >= 2}
                              onSave={saveCatalogue}
                              onCreateOrder={(quote) => {
                                setForm(null);
                                setQuoteOrder(quote);
                              }}
                              start={quotationStart}
                            />
                          ) : page === 'Point of Service' &&
                            branding.settings.businessType === 'retail' &&
                            !posOrders ? (
                            <QuickSale
                              key={resuming?.kind === 'quick' ? resuming.id : 'pos'}
                              embedded
                              ledger={ledger}
                              actor={salesActor}
                              busy={busy || legacyConflict}
                              held={resuming?.kind === 'quick' ? resuming : undefined}
                              onHold={holdCurrentSale}
                              heldList={heldHere}
                              onResumeHeld={(sale) => setResuming(sale)}
                              onDiscardHeld={(sale) =>
                                scope && setHeld(removeHeld(deviceStorage(), scope, sale.id))
                              }
                              onOrders={() => setPosOrders(true)}
                              onSave={completeHeldCheckout}
                              onClose={() => setResuming(null)}
                              onReceipt={setReceipt}
                              jobSettings={branding.settings.jobs}
                              canChooseWorkflow={demo || (shop?.accessLevel ?? 0) >= 2}
                              tileSettings={branding.settings.tiles}
                              brand={{ primary: branding.settings.primary, accent: branding.settings.accent }}
                              defaultTerms={branding.settings.documents.invoiceTerms}
                              discountPolicy={discountPolicy(
                                branding.settings.discounts,
                                demo ? 5 : (shop?.accessLevel ?? 0),
                              )}
                            />
                          ) : page === 'Point of Service' ? (
                            <PointOfServicePage
                              ledger={ledger}
                              busy={busy || legacyConflict}
                              ready={ready}
                              onCheckout={
                                featureOn(branding.settings, 'Jobs')
                                  ? () => {
                                      setPaymentCustomer('');
                                      setForm('job');
                                    }
                                  : undefined
                              }
                              onPayment={() => openPayment()}
                              onQuickSale={() => {
                                setForm(null);
                                if (branding.settings.businessType === 'retail') setPosOrders(false);
                                else setQuickSale(true);
                              }}
                              onJob={setSelectedJob}
                              onNext={(job, mode) => setJobToAdvance({ job, mode })}
                              onBulkAction={(jobs, mode) => setBatchToAdvance({ jobs, mode })}
                              onDue={canChangeDue ? setDeadlineJobs : undefined}
                              onReceipt={setReceipt}
                              held={heldHere}
                              onResumeHeld={(sale) => {
                                setPaymentCustomer('');
                                setCheckoutStart(null);
                                setResuming(sale);
                                if (sale.kind === 'quick') {
                                  setForm(null);
                                  if (branding.settings.businessType === 'retail') setPosOrders(false);
                                  else setQuickSale(true);
                                } else {
                                  setQuickSale(false);
                                  setForm('job');
                                }
                              }}
                              onDiscardHeld={(sale) =>
                                scope && setHeld(removeHeld(deviceStorage(), scope, sale.id))
                              }
                            />
                          ) : page === 'Users' && teamWork.on && usersTab !== 'users' ? (
                            <>
                              <UsersTabs value={usersTab} onChange={setUsersTab} />
                              <TeamPage
                                section={usersTab}
                                branches={multiBranch ? openBranches : undefined}
                                refused={state.teamRefused}
                              />
                            </>
                          ) : page === 'Users' ? (
                            <>
                              {teamWork.on && <UsersTabs value={usersTab} onChange={setUsersTab} />}
                              <UsersPage
                                key={scope}
                                shopId={shop?.id ?? ''}
                                actorId={session?.user.id ?? ''}
                                businessUserId={businessSession?.user.id ?? ''}
                                role={shop?.role ?? ''}
                                online={online}
                                demo={demo}
                                onChanged={() => setStaffEpoch((value) => value + 1)}
                                branchNames={multiBranch ? branchNames : undefined}
                                branchName={multiBranch ? activeBranch?.name : undefined}
                                pageAccess={branding.settings.pageAccess}
                                branches={multiBranch ? openBranches : undefined}
                                onPagesChanged={pageLimit.reload}
                              />
                            </>
                          ) : page === 'Print Settings' ? (
                            <PrintSettingsPage
                              key={scope}
                              scope={scope}
                              ready={ready}
                              trusted={!!signingShop}
                              business={docBusiness}
                            />
                          ) : page === 'Customers' ? (
                            <CustomersPage
                              key={`${scope}:${customerToOpen}`}
                              initialAccountId={customerToOpen}
                              branches={ownerBranches}
                              onStatement={
                                demo ||
                                (['Reports', 'Jobs', 'Payments'] as const).every((name) =>
                                  canAccessPage(name, shop?.accessLevel ?? 0, pageAccess),
                                )
                                  ? (id) => {
                                      setReportCustomer(id);
                                      setReportPayee('');
                                      setPage('Reports');
                                    }
                                  : undefined
                              }
                              ledger={customersPageLedger}
                              ready={ready}
                              busy={busy || hasConflict}
                              actor={catalogueActor}
                              onSave={saveCatalogue}
                              onSaveField={saveCatalogue}
                              onRecordPayment={(id) => openPayment(id)}
                              onRefundCredit={
                                demo || (canCorrectPayments && (shop?.accessLevel ?? 0) >= depositRank)
                                  ? setRefundingCustomer
                                  : undefined
                              }
                            />
                          ) : page === 'Materials' ? (
                            <>
                              {materialTabs}
                              <MaterialsPage
                                key={scope}
                                materials={ledger.materials.filter((m) => !m.hiddenHere)}
                                history={ledger.materialHistory}
                                valuation={stockValuation(ledger)}
                                unitCost={(materialId) => materialUnitCost(ledger, materialId)}
                                ready={ready}
                                busy={(!demo && shop?.role === 'cashier') || busy || hasConflict}
                                actor={catalogueActor}
                                onSave={saveCatalogue}
                                reserved={reservedMap(ledger)}
                                shelves={Object.fromEntries(
                                  (ledger.materialShelves ?? []).map((x) => [x.id, x.shelf]),
                                )}
                                onSetShelf={
                                  demo || (shop?.accessLevel ?? 0) >= 2 ? setMaterialShelf : undefined
                                }
                                expenses={ledger.expenses}
                                payees={ledger.payees}
                                accounts={ledger.moneyAccounts}
                                businessName={businessName}
                                canRecordPurchase={demo || allowed('Expenses')}
                                onSaveExpense={saveCatalogue}
                                locations={
                                  !demo && multiBranch && activeBranch
                                    ? {
                                        here: activeBranch.id,
                                        list: openBranches,
                                        stock: state.ledger.locationStock,
                                        // Admin and higher may send from any location they work in.
                                        sendFrom:
                                          ownerView || (shop?.accessLevel ?? 0) >= 2
                                            ? branchChoices.map((b) => b.id)
                                            : [activeBranch.id],
                                        userId: shop?.userId ?? '',
                                        seesAll: ownerView,
                                        requests: state.ledger.stockRequests ?? [],
                                        request: async (materialId, from, quantity, note) => {
                                          await requestStock(shop!.id, materialId, from, quantity, note);
                                          setMessage(
                                            'Request sent. It shows under Stock requests after the next sync.',
                                          );
                                          syncNow();
                                        },
                                        answer: async (id, send, quantity, reply) => {
                                          const asked = (state.ledger.stockRequests ?? []).find(
                                            (r) => r.id === id,
                                          );
                                          await answerStockRequest(
                                            shop!.id,
                                            id,
                                            send,
                                            quantity,
                                            reply,
                                            asked
                                              ? locationUnitCost(state.ledger, asked.materialId, asked.from)
                                              : null,
                                          );
                                          setMessage(send ? 'Stock sent.' : 'Request declined.');
                                          syncNow();
                                        },
                                        cancel: async (id) => {
                                          await cancelStockRequest(shop!.id, id);
                                          setMessage('Request withdrawn.');
                                          syncNow();
                                        },
                                        minimums: branding.settings.stockMinimums,
                                        setMinimum:
                                          activeBranch.id !== MAIN && (shop?.accessLevel ?? 0) >= 2
                                            ? async (materialId, minimum) => {
                                                const { error } = await supabase!.rpc(
                                                  'set_location_minimum',
                                                  {
                                                    p_shop: shop!.id,
                                                    p_location: activeBranch.id,
                                                    p_material: materialId,
                                                    p_minimum: minimum,
                                                  },
                                                );
                                                if (error) throw Error(error.message);
                                                await businessBranding.reload();
                                                setMessage(
                                                  `Minimum saved for ${activeBranch.name}.`,
                                                  'success',
                                                );
                                              }
                                            : undefined,
                                        transfer: async (materialId, from, to, quantity, reason) => {
                                          await transferStock(
                                            shop!.id,
                                            materialId,
                                            from,
                                            to,
                                            quantity,
                                            reason,
                                            // What it cost where it leaves, so it arrives at that value.
                                            locationUnitCost(state.ledger, materialId, from),
                                          );
                                          setMessage(
                                            'Stock transferred. Quantities update with the next sync.',
                                          );
                                          syncNow();
                                        },
                                      }
                                    : undefined
                                }
                              />
                            </>
                          ) : page === 'Services' ? (
                            <ServicesPage
                              branchPrice={
                                !demo &&
                                multiBranch &&
                                activeBranch &&
                                ownPrices(branding.settings, activeBranch.id)
                                  ? {
                                      branchName: activeBranch.name,
                                      set: async (serviceId, price) => {
                                        const { error } = await supabase!.rpc('set_branch_price', {
                                          p_shop: shop!.id,
                                          p_service: serviceId,
                                          p_price: price,
                                        });
                                        if (error) throw Error(error.message);
                                        setMessage(
                                          price === null
                                            ? `${activeBranch.name} now uses the business price.`
                                            : `Price saved for ${activeBranch.name}. It shows after the next sync.`,
                                        );
                                        syncNow();
                                      },
                                    }
                                  : undefined
                              }
                              key={scope}
                              services={
                                chooseItems
                                  ? state.ledger.services
                                  : ledger.services.filter((item) => !item.notSoldHere)
                              }
                              soldAt={
                                chooseItems
                                  ? {
                                      branches: chosenBranches,
                                      current: activeBranch?.id ?? MAIN,
                                      set: saveItemBranches,
                                    }
                                  : undefined
                              }
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
                              online={online}
                              cutoff={state.ledger.historySummary?.cutoff ?? ''}
                              loadOlder={
                                shop && !demo && state.ledger.historySummary?.cutoff
                                  ? async () => viewOf(await fetchFullLedger(scope, shop.id)).materialHistory
                                  : undefined
                              }
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
                              onHold={holdJob}
                              onBulkAction={(jobs, mode) => setBatchToAdvance({ jobs, mode })}
                              onDue={canChangeDue ? setDeadlineJobs : undefined}
                              onReceipt={setReceipt}
                              onCorrectPayment={correctPaymentAction}
                              canCorrectPayment={(p) => canCorrectPayments || isDepositWithoutJob(ledger, p)}
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
                      {deadlineJobs && (
                        <DueDateDialog
                          jobs={deadlineJobs}
                          busy={busy}
                          actor={salesActor}
                          onSave={saveCatalogue}
                          onClose={() => setDeadlineJobs(null)}
                        />
                      )}
                      {currentJob && (
                        <JobDetails
                          onDue={canChangeDue ? setDeadlineJobs : undefined}
                          job={currentJob}
                          ledger={ledger}
                          busy={busy}
                          hasConflict={hasConflict}
                          legacyConflict={legacyConflict}
                          customerHeld={heldWork.resources.has('customer:' + currentJob.customerId)}
                          canAdjust={
                            demo || canAccessPage('Sale Adjustments', shop?.accessLevel ?? 0, pageAccess)
                          }
                          canSave={demo || online}
                          onClose={() => setSelectedJob(null)}
                          onAdjust={(job) => {
                            setSelectedJob(null);
                            setAdjustingJob(job);
                          }}
                          onAction={(job, mode) => setJobToAdvance({ job, mode })}
                          onPayment={openPayment}
                          actor={catalogueActor}
                          checkActor={checkActor}
                          onMaterialsCheck={async (event) => {
                            await save(event);
                          }}
                          onHold={holdJob}
                          onParts={async (event) => {
                            await save(event as LedgerEvent);
                          }}
                          canRemoveHandover={demo || (shop?.accessLevel ?? 0) >= 2}
                          onExtraMaterials={
                            demo || (shop?.accessLevel ?? 0) >= extraMaterialsRank(branding.settings)
                              ? async (event) => {
                                  await save(event);
                                }
                              : undefined
                          }
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
                          key={form === 'job' && resuming?.kind === 'checkout' ? resuming.id : (form ?? '')}
                          ledger={ledger}
                          actor={salesActor}
                          busy={busy}
                          paymentOnly={form === 'payment'}
                          initialCustomer={form === 'payment' ? paymentCustomer : ''}
                          startTemplate={form === 'job' ? (checkoutStart ?? undefined) : undefined}
                          held={form === 'job' && resuming?.kind === 'checkout' ? resuming : undefined}
                          fromQuotation={form === 'job' ? heldQuotation(resuming) : undefined}
                          onHold={form === 'job' ? holdCurrentSale : undefined}
                          onSave={completeHeldCheckout}
                          onClose={() => {
                            setForm(null);
                            setResuming(null);
                          }}
                          onReceipt={setReceipt}
                          jobSettings={branding.settings.jobs}
                          defaultTerms={branding.settings.documents.invoiceTerms}
                          canChooseWorkflow={demo || (shop?.accessLevel ?? 0) >= 2}
                          discountPolicy={discountPolicy(
                            branding.settings.discounts,
                            demo ? 5 : (shop?.accessLevel ?? 0),
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
                          key={resuming?.kind === 'quick' ? resuming.id : 'new'}
                          ledger={ledger}
                          actor={salesActor}
                          busy={busy}
                          held={resuming?.kind === 'quick' ? resuming : undefined}
                          onHold={holdCurrentSale}
                          heldList={heldHere}
                          onResumeHeld={(sale) => setResuming(sale)}
                          onDiscardHeld={(sale) =>
                            scope && setHeld(removeHeld(deviceStorage(), scope, sale.id))
                          }
                          onSave={completeHeldCheckout}
                          onClose={() => {
                            setQuickSale(false);
                            setResuming(null);
                          }}
                          onReceipt={setReceipt}
                          jobSettings={branding.settings.jobs}
                          canChooseWorkflow={demo || (shop?.accessLevel ?? 0) >= 2}
                          tileSettings={branding.settings.tiles}
                          brand={{ primary: branding.settings.primary, accent: branding.settings.accent }}
                          defaultTerms={branding.settings.documents.invoiceTerms}
                          discountPolicy={discountPolicy(
                            branding.settings.discounts,
                            demo ? 5 : (shop?.accessLevel ?? 0),
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
                                quotationId: quoteOrder.id,
                                reference: quotationRef(quoteOrder.id),
                                customerId: start.customerId,
                                customerName: quoteOrder.customerName,
                                customerPhone: quoteOrder.customerPhone,
                                lines: start.lines,
                                orderDiscount: start.orderDiscount,
                                changes: start.changes,
                              }}
                              onSave={async (operation) => {
                                // The sale carries the quotation and marks it converted as it saves.
                                const record = await completeCheckout(operation);
                                setQuoteOrder(null);
                                return record;
                              }}
                              onHold={(sale) => {
                                holdCurrentSale(sale);
                                setQuoteOrder(null);
                              }}
                              onClose={() => setQuoteOrder(null)}
                              onReceipt={setReceipt}
                              jobSettings={branding.settings.jobs}
                              defaultTerms={branding.settings.documents.invoiceTerms}
                              canChooseWorkflow={demo || (shop?.accessLevel ?? 0) >= 2}
                              discountPolicy={discountPolicy(
                                branding.settings.discounts,
                                demo ? 5 : (shop?.accessLevel ?? 0),
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
                      {requestingJob && (
                        <SaleAdjustmentEditor
                          request
                          ledger={ledger}
                          job={ledger.jobs.find((j) => j.id === requestingJob.id) ?? requestingJob}
                          busy={busy}
                          actor={salesActor}
                          onClose={() => setRequestingJob(null)}
                          onSave={(event) => sendCorrectionRequest(Array.isArray(event) ? event[0] : event)}
                        />
                      )}
                      {requestingPayment && (
                        <PaymentCorrectionDialog
                          request
                          ledger={ledger}
                          payment={
                            ledger.payments.find((p) => p.id === requestingPayment.id) ?? requestingPayment
                          }
                          busy={busy}
                          actor={salesActor}
                          onClose={() => setRequestingPayment(null)}
                          onSave={sendCorrectionRequest}
                        />
                      )}
                      {refundingCustomer && (
                        <CreditRefundDialog
                          ledger={ledger}
                          customerId={refundingCustomer}
                          busy={busy}
                          actor={salesActor}
                          onClose={() => setRefundingCustomer('')}
                          onSave={async (event) => {
                            await approveOperation(event);
                            // The refund slip, from the records as the refund leaves them.
                            const slip = refundSlipFor(
                              applySaleAdjustment(ledger, event) as Ledger,
                              event.id,
                            );
                            if (slip) setReceipt(slip);
                          }}
                        />
                      )}
                      {correctingPayment &&
                        // A part of a split sale: the whole sale is corrected together.
                        receiptPayments(ledger, correctingPayment.checkoutId ?? correctingPayment.id).length >
                          1 && (
                          <SplitCorrectionDialog
                            ledger={ledger}
                            payments={receiptPayments(
                              ledger,
                              correctingPayment.checkoutId ?? correctingPayment.id,
                            )}
                            busy={busy}
                            actor={salesActor}
                            onClose={() => setCorrectingPayment(null)}
                            onSave={approveOperation}
                          />
                        )}
                      {correctingPayment &&
                        receiptPayments(ledger, correctingPayment.checkoutId ?? correctingPayment.id)
                          .length <= 1 && (
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
                      {soldAsk && (
                        <Modal
                          title={
                            soldAsk.items.length > 1
                              ? 'Where are these items sold?'
                              : 'Where is this item sold?'
                          }
                          onClose={() => soldAsk.resolve(null)}
                        >
                          <p>
                            <strong>{soldAsk.items.join(', ')}</strong>
                          </p>
                          <p>
                            Branches that sell every item sell it anyway. Tick the branches that sell only
                            chosen items and should sell it too.
                          </p>
                          {chosenBranches.map((b) => (
                            <label key={b.id} className="check-label">
                              <input
                                type="checkbox"
                                checked={soldAsk.picks.includes(b.id)}
                                onChange={(e) =>
                                  setSoldAsk({
                                    ...soldAsk,
                                    picks: e.target.checked
                                      ? [...soldAsk.picks, b.id]
                                      : soldAsk.picks.filter((id) => id !== b.id),
                                  })
                                }
                              />
                              {b.name}
                            </label>
                          ))}
                          <div className="material-actions">
                            <button type="button" className="secondary" onClick={() => soldAsk.resolve(null)}>
                              Cancel
                            </button>
                            <button type="button" onClick={() => soldAsk.resolve(soldAsk.picks)}>
                              <Icon name="save" /> Save
                            </button>
                          </div>
                        </Modal>
                      )}
                      {receipt && (
                        <ReceiptView
                          ledger={ledger}
                          record={ledger.checkouts.find((r) => r.id === receipt.id) ?? receipt}
                          scope={scope}
                          business={docBusiness}
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
                            receipt.kind !== 'refund' &&
                            receiptPayments(ledger, receipt.id).length &&
                            (canCorrectPayments ||
                              (canRequestDeposit &&
                                receiptPayments(ledger, receipt.id).length === 1 &&
                                isDepositWithoutJob(ledger, receiptPayments(ledger, receipt.id)[0])))
                              ? () => {
                                  const [payment] = receiptPayments(ledger, receipt.id);
                                  setReceipt(null);
                                  correctPaymentAction?.(payment);
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
                          confirms={checkActor.confirms}
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
                                level: demo ? 5 : (shop?.accessLevel ?? 0),
                                confirms: checkActor.confirms,
                              },
                              undefined,
                              { ledger: state.ledger, usages },
                            );
                            if (!events.length) throw Error('No selected items can take this action.');
                            // Team work: moving several at once credits the people assigned.
                            const teamEvents: TeamEvent[] = !teamWork.on
                              ? []
                              : batchProgressPlan(batchToAdvance.jobs, batchToAdvance.mode, targetStage)
                                  .filter((row) => !row.reason)
                                  .flatMap((row) =>
                                    autoWorkEvents(state.ledger, row.job, row.target, teamWork.actor),
                                  );
                            setBusy(true);
                            try {
                              const next = await saveEvents(targetScope, [...events, ...teamEvents], !demo);
                              if (activeScope.current === targetScope) {
                                setState(next);
                                channel.current?.postMessage('changed');
                                setBatchToAdvance(null);
                                setMessage(
                                  'Selected items updated. Changes sync automatically when connected.',
                                );
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
                          confirms={checkActor.confirms}
                          onClose={() => setJobToAdvance(null)}
                          onSave={async (targetStage, usages, work) => {
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
                                  level: demo ? 5 : (shop?.accessLevel ?? 0),
                                  confirms: checkActor.confirms,
                                },
                                usages,
                              );
                              // Team work: the "Done by" step's records, or the people assigned.
                              const job = jobToAdvance.job;
                              // An outside vendor's cost: an expense for this job, with the vendor
                              // added to Payees when new (saved before the work that names them).
                              const vendorEvents = work
                                ? vendorExpenseEvents(state.ledger, job, targetStage, work, teamWork.actor)
                                : null;
                              const teamEvents: TeamEvent[] = !teamWork.on
                                ? []
                                : work
                                  ? workEvents(job, targetStage, vendorEvents?.work ?? work, teamWork.actor)
                                  : autoWorkEvents(state.ledger, job, targetStage, teamWork.actor);
                              const next = await saveEvents(
                                targetScope,
                                [...events, ...(vendorEvents?.events ?? []), ...teamEvents],
                                !demo,
                              );
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
          </MessagesContext.Provider>
        </ReadyMessageContext.Provider>
      </TermsProvider>
    </BusinessOptionsContext.Provider>
  );
  // The same shape locked or not, so React keeps the app (and what is open in it) while locked.
  return (
    <>
      <div className="app-layer" hidden={!!lockScreen} inert={!!lockScreen}>
        <AppLayer.Provider value>
          <CostMethodContext.Provider value={costMethodOf(branding.settings)}>
            <TeamContext.Provider value={teamWork}>
              <PayeeRulesContext.Provider
                value={{
                  payeeExtra: branding.settings.jobs.payeeExtra === 'ask' ? 'ask' : 'advance',
                  useAdvance: (['auto', 'never'].includes(branding.settings.jobs.useAdvance)
                    ? branding.settings.jobs.useAdvance
                    : 'ask') as 'ask' | 'auto' | 'never',
                }}
              >
                {app}
              </PayeeRulesContext.Provider>
            </TeamContext.Provider>
          </CostMethodContext.Provider>
        </AppLayer.Provider>
      </div>
      {lockScreen}
    </>
  );
}
