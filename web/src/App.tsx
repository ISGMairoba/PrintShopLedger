import SaleAdjustmentsPage,{SaleAdjustmentEditor,AdjustmentHistory} from './SaleAdjustmentsPage';
import MaterialWastePage from './MaterialWastePage';
import {useFeedbackMessage, FeedbackBanner} from './Feedback';
import ConflictInbox from './ConflictInbox';
import {blockedWork} from './sync-dependencies.mjs';
import {approveConflictReview,clearConflictApproval} from './conflict-review';
import {paymentName} from './business-options.mjs';
import {BusinessOptionsContext} from './BusinessOptionsContext';
import useBusinessBranding from './useBusinessBranding';
import BusinessSettingsPage from './BusinessSettingsPage';
import AccountPage from './AccountPage';
import {canAccessPage, pages} from './page-access.mjs';
import ExpensesPage from './ExpensesPage';
import JobTable from './JobTable';
import JobActions,{type ProgressMode} from './JobActions';
import JobProgressDialog from './JobProgressDialog';
import {progressEvents,lastJobPayment} from './job-progress.mjs';
import MySalesPage from './MySalesPage';
import PointOfServicePage from './PointOfServicePage';
import CheckoutEditor from './CheckoutEditor';
import ReceiptView from './ReceiptView';
import { receiptHtml, receiptIntegrityError } from './receipts.mjs';
import { printAfterTransaction } from './printing';
import useAutoSync from './useAutoSync';
import Sidebar from './Sidebar';
import ResponsiveTable from './ResponsiveTable';
import Icon from './Icon';
import PrintSettingsPage from './PrintSettingsPage';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Session } from '@supabase/supabase-js';
import { customerBalance, emptyLedger, jobBalance } from './domain.mjs';
import { ExpenseSyncConflict, resolveCloudExpense, supabase, businessAuth, syncLedger, MaterialSyncConflict, resolveCloudMaterial, ServiceSyncConflict, resolveCloudService, CustomerSyncConflict, resolveCloudCustomer, CheckoutSyncConflict, JobSyncConflict, resolvePendingWork, checkoutReviewBase, saveSupervisedEvent } from './cloud';
import { readState, saveEvent, saveEvents, mutateState } from './storage';
import MaterialsPage from './MaterialsPage';
import CustomersPage from './CustomersPage';
import UsersPage from './UsersPage';
import CustomerEditor from './CustomerEditor';
import { SortHeader, useTableSort } from './TableSort';
import ServicesPage from './ServicesPage';
import ServiceConflictReview from './ServiceConflictReview';
import StockHistoryPage from './StockHistoryPage';
import type { LedgerEvent, LocalState, Payment, MaterialEvent, ServiceEvent, CustomerEvent, Job, CheckoutEvent, CheckoutRecord, DrawerCommand, ExpenseEvent, SupervisedEvent } from './types';

type Shop = { id: string; name: string; userId:string; role: string; rank: number; accessLevel: number; username: string; staffName: string };
type Page = 'Dashboard' | 'Sale Adjustments' | 'Material Waste' | 'My Sales' | 'Point of Service' | 'Jobs' | 'Customers' | 'Payments' | 'Materials' | 'Stock History' | 'Services' | 'Print Settings' | 'Users' | 'Expenses' | 'My Account' | 'Business Settings' | 'Conflict Inbox';
const DashboardPage=lazy(()=>import('./DashboardPage'));
const currency = (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount / 100);
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'Something went wrong.';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [businessSession, setBusinessSession] = useState<Session | null>(null);
  const [switchUser, setSwitchUser] = useState(false);
  const [staffEpoch, setStaffEpoch] = useState(0);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authStartupError,setAuthStartupError]=useState('');
  const [authEpoch,setAuthEpoch]=useState(0);
  const [demo, setDemo] = useState(!supabase);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [workspaceLookup,setWorkspaceLookup]=useState({key:'',status:'loading',error:''});
  const workspaceIdentity=`${businessSession?.user.id??''}:${session?.user.id??'locked'}`;
  const [state, setState] = useState<LocalState>({ ledger: emptyLedger(), pending: [] });
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('Point of Service');
  const [supervisor,setSupervisor]=useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<'customer' | 'job' | 'payment' | null>(null);
  const [receipt,setReceipt]=useState<CheckoutRecord|null>(null);
  const [jobToAdvance,setJobToAdvance]=useState<{job:Job;mode:ProgressMode}|null>(null);
  const [adjustingJob,setAdjustingJob]=useState<Job|null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [paymentCustomer, setPaymentCustomer] = useState('');
  const [message, setMessage, messageTone] = useFeedbackMessage('success');
  const [busy, setBusy] = useState(false);
  const [expenseConflict,setExpenseConflict]=useState<ExpenseSyncConflict|null>(null);
  const [checkoutConflict,setCheckoutConflict]=useState<CheckoutSyncConflict|null>(null);
  const [jobConflict,setJobConflict]=useState<JobSyncConflict|null>(null);
  const [customerConflict, setCustomerConflict] = useState<CustomerSyncConflict | null>(null);
  const [serviceConflict, setServiceConflict] = useState<ServiceSyncConflict | null>(null);
  const [conflict, setConflict] = useState<MaterialSyncConflict | null>(null);

  const [supervisorLogin,setSupervisorLogin]=useState(false);
  const [conflictReviewHidden, setConflictReviewHidden] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const scope = demo ? 'local-trial' : businessSession && session && shop && shop.userId===session.user.id && shop.accessLevel>0 ? `${session.user.id}:${shop.id}` : '';
  const branding=useBusinessBranding(shop?.id??'',scope,demo?'Local trial':shop?.name??'',online,demo);
  const pageAllowed = demo || (page==='Conflict Inbox'&&!!supervisor) || canAccessPage(page, shop?.accessLevel ?? 0,branding.settings.pageAccess);
  useEffect(() => { if (!demo && branding.ready && session && shop?.userId === session.user.id && !pageAllowed) {setPage((pages.find(item=>canAccessPage(item,shop?.accessLevel??0,branding.settings.pageAccess))??'My Account') as Page);setForm(null);setSelectedJob(null);setReceipt(null);setAdjustingJob(null);} }, [pageAllowed, branding.ready, demo, session?.user.id, shop?.userId]);
  const businessName=branding.settings.businessName||shop?.name||'Business';
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const channel = useRef<BroadcastChannel | null>(null);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const ledger = state.ledger;
  useEffect(()=>{if(ready&&receipt&&!ledger.checkouts.some(item=>item.id===receipt.id)&&!state.pending.some(item=>item.id===receipt.id))setReceipt(null);},[ready,receipt,ledger.checkouts,state.pending]);
  const total = ledger.jobs.reduce((sum, job) => sum + job.amount, 0);
  const paid = ledger.payments.reduce((sum, payment) => sum + payment.allocations.reduce((allocated,item)=>allocated+item.amount,0), 0);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setAuthStartupError('');
    const deadline=setTimeout(()=>{if(active)setAuthStartupError('Your saved sign-in is taking too long to load. Check your connection and retry.');},25000);
    Promise.all([supabase.auth.getSession(), businessAuth!.auth.getSession()]).then(([staff, business]) => {
      if (!active) return;
      clearTimeout(deadline);
      if (staff.error || business.error) setMessage(staff.error?.message || business.error?.message || '', 'error');
      setSession(staff.data.session); setBusinessSession(business.data.session); setAuthReady(true);
    }).catch(error => { clearTimeout(deadline);if (active) { setMessage(errorMessage(error),'error'); setAuthReady(true); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => { if (active) setSession(current); });
    const { data: businessListener } = businessAuth!.auth.onAuthStateChange((_event, current) => { if (active) setBusinessSession(current); });
    return () => { active = false;clearTimeout(deadline); listener.subscription.unsubscribe(); businessListener.subscription.unsubscribe(); };
  }, [authEpoch]);

  useEffect(() => {
    if (!businessSession || demo || !supabase) { setShops([]); setShop(null); return; }
    let active = true;
    setWorkspaceLookup({key:workspaceIdentity,status:'loading',error:''});
    // The SDK can wait for an auth lock before fetch starts, so fetch's abort
    // signal alone does not bound the time spent on this screen.
    const deadline=setTimeout(()=>{if(active)setWorkspaceLookup({key:workspaceIdentity,status:'error',error:'The business server is taking too long to respond. Please retry.'});},25000);
    const cacheKey = `printshopledger-business-workspaces:${businessSession.user.id}:${session?.user.id ?? 'locked'}`;
    async function loadShops() {
      try {
        let available: Shop[];
        if (navigator.onLine) {
          const [businessResult,staff]=await Promise.all([
            businessAuth!.rpc('list_business_shops').abortSignal(AbortSignal.timeout(20000)),
            session ? supabase!.rpc('list_my_shops').abortSignal(AbortSignal.timeout(20000)) : Promise.resolve({data:[],error:null})
          ]);
          const {data:businesses,error:businessError}=businessResult;
          if (businessError) throw businessError;
          if (staff.error) throw staff.error;
          available = (businesses ?? []).map((business: {id:string;name:string}) => ({
            ...business, userId:'', role: '', rank: 0, accessLevel: 0, username: '', staffName: '',
            ...(staff.data ?? []).find((membership: Shop) => membership.id === business.id)
          }));
          try{localStorage.setItem(cacheKey, JSON.stringify(available));}catch{/* A full device cache must not block a successful online sign-in. */}
        } else {available = JSON.parse(localStorage.getItem(cacheKey) ?? '[]');if(!available.length)throw Error('Connect to load your business workspace.');}
        if (active) { clearTimeout(deadline);setShops(available); setShop(current => available.find(item => item.id === current?.id) ?? available[0] ?? null);setWorkspaceLookup({key:workspaceIdentity,status:'ready',error:''}); }
      } catch (error) { clearTimeout(deadline);if (active) setWorkspaceLookup({key:workspaceIdentity,status:'error',error:errorMessage(error)}); }
    }
    void loadShops();
    return () => { active = false;clearTimeout(deadline); };
  }, [businessSession?.user.id, session?.user.id, demo, online, staffEpoch]);

  useEffect(() => {
    setReady(false); setState({ ledger: emptyLedger(), pending: [] });
    clearConflictApproval();setSupervisor('');setSupervisorLogin(false);
    setExpenseConflict(null);setCheckoutConflict(null);setJobConflict(null);setReceipt(null);setJobToAdvance(null);setForm(null); setSelectedJob(null);setAdjustingJob(null); setQuery(''); setConflict(null); setServiceConflict(null); setCustomerConflict(null); setConflictReviewHidden(false);
    if (!scope) return;
    let active = true;
    const refresh = () => readState(scope).then(value => { if (active) { setState(value); setReady(true); } })
      .catch(error => { if (active) setMessage(`Local storage failed: ${errorMessage(error)}`,'error'); });
    void refresh();
    const broadcast = new BroadcastChannel(`printshopledger:${scope}`);
    channel.current = broadcast; broadcast.onmessage = () => { void refresh(); };
    return () => { active = false; broadcast.close(); if (channel.current === broadcast) channel.current = null; };
  }, [scope]);

  async function save(operation: LedgerEvent) {
    if(!scope)throw new Error('Sign in to a staff workspace first.');
    const target = scope;
    const next = await saveEvent(target, operation, !demo);
    if (activeScope.current !== target) return;
    setState(next); channel.current?.postMessage('changed'); setForm(null);
    setMessage(demo ? 'Saved on this device.' : 'Saved on this device. Changes sync automatically when connected.');
  }
  async function saveCatalogue(operation: MaterialEvent | ServiceEvent | CustomerEvent | ExpenseEvent) {
    if (busy || !ready || hasConflict || (!demo && (!session || !shop || shop.userId!==session.user.id || shop.accessLevel===0))) throw new Error('Please wait until the staff workspace is ready.');
    setBusy(true); setMessage('');
    try { await save(operation); } finally { setBusy(false); }
  }
  async function approveOperation(operation:SupervisedEvent){
    if(busy||!ready||!scope||hasConflict||(!demo&&(!online||(shop?.accessLevel??0)<2)))throw Error('Connect and finish syncing as Admin, Manager or Developer before approving.');
    const target=scope;setBusy(true);
    try{
      const next=demo?await saveEvent(target,operation,false):await saveSupervisedEvent(target,shop!.id,operation);
      if(activeScope.current===target){setState(next);channel.current?.postMessage('changed');const low=next.ledger.materials.some(m=>m.available<0&&(operation.kind==='material.wasted'?m.id===operation.data.materialId:next.ledger.saleAdjustments.find(a=>a.id===operation.id)?.stockChanges?.some(c=>c.materialId===m.id)));setMessage(operation.kind==='material.wasted'?`Waste saved. Stock and history updated.${low?' Stock warning: this material is below zero.':''}`:operation.kind==='sale.refunded'?'Refund saved. Customer credit and drawer totals updated.':`Sale adjustment saved. Account, stock and history updated.${low?' Stock warning: a material is below zero.':''}`,low?'warning':'success');}
    }finally{setBusy(false);}
  }
  async function completeCheckout(operation:CheckoutEvent):Promise<CheckoutRecord>{
    if(busy||!ready||!scope||legacyConflict)throw Error('Please wait until the workspace is ready.');
    const target=scope;setBusy(true);
    try{
      let next=await saveEvent(target,operation,!demo);
      if(activeScope.current!==target)throw Error('Workspace changed. The checkout was saved in the original workspace.');
      setState(next);channel.current?.postMessage('changed');
      let syncProblem='';
      if(!demo&&online){try{next=await syncLedger(target,shop!.id);if(activeScope.current===target)setState(next);}catch(error){syncProblem=errorMessage(error);if(activeScope.current===target){if(error instanceof ExpenseSyncConflict)setExpenseConflict(error);if(error instanceof CheckoutSyncConflict)setCheckoutConflict(error);if(error instanceof JobSyncConflict)setJobConflict(error);if(error instanceof MaterialSyncConflict)setConflict(error);if(error instanceof ServiceSyncConflict)setServiceConflict(error);if(error instanceof CustomerSyncConflict)setCustomerConflict(error);}}}
      const record=next.ledger.checkouts.find(r=>r.id===operation.id)!;
      const pending=next.pending.some(e=>e.id===operation.id);
      setMessage(syncProblem|| (demo?'Checkout saved on this device.':pending?'Checkout saved on this device. It will sync automatically.':'Checkout confirmed and saved.'),syncProblem?'warning':'success');
      const receiptWarning=receiptIntegrityError(record);
      const printed=receiptWarning?{status:'failed',message:receiptWarning}:await printAfterTransaction(target,`Receipt ${record.id.slice(0,8)}`,receiptHtml(record,branding.settings,pending),true);
      if(activeScope.current===target&&printed.status==='failed')setMessage(`Checkout saved. Receipt printing failed: ${printed.message}. Open the receipt to retry.`,'warning');
      return record;
    }finally{setBusy(false);}
  }
  async function closeDrawer(command:DrawerCommand){
    if(demo||!online||busy||!ready||!scope||!session||!shop)throw Error('Connect and sign in to close the drawer.');
    const target=scope,shopId=shop.id;setBusy(true);setMessage('');
    try{
      const synced=await syncLedger(target,shopId);
      if(activeScope.current!==target)throw Error('Your signed-in user changed. Reopen the drawer.');
      setState(synced);channel.current?.postMessage('changed');
      if(synced.pending.length)throw Error('Finish syncing and reviewing pending sales before handing over the drawer.');
      if(synced.pending.length)throw Error('Finish syncing pending sales before closing.');
      const {data,error}=await supabase!.functions.invoke('close-drawer',{body:{shopId,...command}});
      if(error){let message=error.message;const response=(error as {context?:Response}).context;if(response)try{message=(await response.json()).error||message;}catch{}throw Error(message);}
      if(activeScope.current!==target)throw Error('Handover saved. Sign in as the receiving user to continue.');
      // Cache the server-confirmed closing before the outgoing staff session is replaced.
      // Preserve any concurrent local work; this confirmation does not create an outbox event.
      let cacheWarning='';
      try {
        const closedIds=new Set<string>(data.closing.checkoutIds);
        await mutateState(target,current=>({...current,ledger:{...current.ledger,
          drawerClosings:[...current.ledger.drawerClosings.filter(d=>d.id!==data.closing.id),data.closing],
          checkouts:current.ledger.checkouts.map(r=>closedIds.has(r.id)?{...r,drawerClosingId:data.closing.id}:r)
        }}));
        channel.current?.postMessage('changed');
      }catch{cacheWarning=' Reconnect before reviewing the outgoing user’s sales on this device.';}
      if(activeScope.current!==target)throw Error('Handover saved. Sign in as the receiving user to continue.');
      await supabase!.auth.signOut({scope:'local'});
      const {error:sessionError}=await supabase!.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
      if(sessionError){await supabase!.auth.signOut({scope:'local'});throw Error('Handover saved. Sign in as the receiving user to continue.');}
      setPage('My Sales');setStaffEpoch(value=>value+1);setMessage(`Drawer handover saved. ${data.closing.toUserLabel} is now signed in.${cacheWarning}`,cacheWarning?'warning':'success');
    }catch(error){
      if(error instanceof ExpenseSyncConflict)setExpenseConflict(error);if(error instanceof CheckoutSyncConflict)setCheckoutConflict(error);
      if(error instanceof JobSyncConflict)setJobConflict(error);
      if(error instanceof MaterialSyncConflict)setConflict(error);
      if(error instanceof ServiceSyncConflict)setServiceConflict(error);
      if(error instanceof CustomerSyncConflict)setCustomerConflict(error);
      throw error;
    }finally{setBusy(false);}
  }
  const legacyConflict=!!(expenseConflict||conflict||serviceConflict||customerConflict||checkoutConflict||jobConflict);
  const heldWork=blockedWork(state);
  const hasConflict=legacyConflict||heldWork.eventIds.size>0;
  const canReviewConflicts=demo||(shop?.accessLevel??0)>=2||!!supervisor;
  useEffect(()=>{if(!hasConflict&&!state.pending.length){clearConflictApproval();setSupervisor('');setSupervisorLogin(false);}},[hasConflict,state.pending.length]);
  useEffect(()=>{if(!supervisor)return;const timer=setTimeout(()=>{clearConflictApproval();setSupervisor('');setConflictReviewHidden(true);},5*60000);return()=>clearTimeout(timer);},[supervisor]);
  const syncStatus=useAutoSync({
    scope,enabled:!demo&&!!scope&&ready&&!switchUser,online,
    paused:busy||legacyConflict,
    pendingKey:state.pending.map(item=>item.id).join(','),
    run:async()=>{
      const target=scope;
      const next=await syncLedger(target,shop!.id);
      if(activeScope.current===target){setState(next);channel.current?.postMessage('changed');}
    },
    onError:(error)=>{
      const target=scope;void readState(target).then(next=>{if(activeScope.current===target)setState(next);});
      setMessage(errorMessage(error),'error');
      if(error instanceof ExpenseSyncConflict||error instanceof CheckoutSyncConflict||error instanceof JobSyncConflict||error instanceof MaterialSyncConflict||error instanceof ServiceSyncConflict||error instanceof CustomerSyncConflict){
        setMessage(errorMessage(error),'error');setConflictReviewHidden(false);
        if(error instanceof ExpenseSyncConflict)setExpenseConflict(error);if(error instanceof CheckoutSyncConflict)setCheckoutConflict(error);if(error instanceof JobSyncConflict)setJobConflict(error);
        if(error instanceof MaterialSyncConflict)setConflict(error);
        if(error instanceof ServiceSyncConflict)setServiceConflict(error);
        if(error instanceof CustomerSyncConflict)setCustomerConflict(error);
        return 'pause';
      }
    }
  });
  const syncLabel=!ready?'Loading':hasConflict?'Review changes':!online?'Waiting for connection':syncStatus==='syncing'?'Syncing…':syncStatus==='retrying'?'Waiting to retry':state.pending.length?'Changes pending':state.lastSynced?'Saved':'Connecting…';
  async function resolveConflict(choice: 'local' | 'cloud') {
    if (!conflict || !shop || busy) return;
    const target = scope;
    setBusy(true);
    try {
      const next = await resolveCloudMaterial(target, shop.id, conflict.local.id, choice, conflict.local.lastEventId, conflict.remote.lastEventId);
      if (activeScope.current === target) { setState(next); setConflict(null); channel.current?.postMessage('changed'); setMessage('Choice saved. Remaining changes will sync automatically.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error),'error'); if (error instanceof MaterialSyncConflict) setConflict(error); } }
    finally { setBusy(false); }
  }
  async function resolveServiceConflict(choice: 'local' | 'cloud', materialId: string | null) {
    if (!serviceConflict || !shop || busy) return;
    const target = scope; setBusy(true);
    try {
      const next = await resolveCloudService(target, shop.id, serviceConflict.local.id, choice, serviceConflict.local.lastEventId, serviceConflict.remote?.lastEventId ?? null, materialId);
      if (activeScope.current === target) { setState(next); setServiceConflict(null); channel.current?.postMessage('changed'); setMessage('Choice saved. Remaining changes will sync automatically.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error),'error'); if (error instanceof ServiceSyncConflict) setServiceConflict(error); if (error instanceof CustomerSyncConflict) setCustomerConflict(error); } }
    finally { setBusy(false); }
  }
  async function resolveCustomerConflict(choice: 'local' | 'cloud') {
    if (!customerConflict || !shop || busy) return;
    const target = scope; setBusy(true);
    try {
      const next = await resolveCloudCustomer(target, shop.id, customerConflict.local.id, choice, customerConflict.local.lastEventId, customerConflict.remote?.lastEventId ?? null);
      if (activeScope.current === target) { setState(next); setCustomerConflict(null); channel.current?.postMessage('changed'); setMessage('Choice saved. Remaining changes will sync automatically.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error),'error'); if (error instanceof CustomerSyncConflict) setCustomerConflict(error); } }
    finally { setBusy(false); }
  }
  function openPayment(customerId = '') {
    setSelectedJob(null); setPaymentCustomer(customerId); setForm('payment'); setMessage('');
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const { data: business, error } = await businessAuth!.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) });
      if (error || !business.session) throw error || new Error('Could not sign in to the business.');
      const { error: staffError } = await supabase!.auth.signInWithPassword({email:String(data.get('email')),password:String(data.get('password'))});
      if (staffError) throw staffError;
      setBusinessSession(business.session); setDemo(false); setSwitchUser(false); setMessage('');
    } catch (error) { setMessage(errorMessage(error),'error'); }
    finally { setBusy(false); }
  }
  async function createWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!businessSession||busy||!online)return;
    setBusy(true);setMessage('');
    const data=new FormData(e.currentTarget);
    try {
      // Workspace creation belongs to the business identity, including when an
      // old staff session remains on this device after another business login.
      if(session?.user.id!==businessSession.user.id){
        const {error}=await supabase!.auth.setSession({access_token:businessSession.access_token,refresh_token:businessSession.refresh_token});
        if(error)throw error;
      }
      const {error}=await businessAuth!.rpc('create_shop',{p_name:String(data.get('businessName')).trim()}).abortSignal(AbortSignal.timeout(20000));
      if(error)throw error;
      // Reload through the guarded lookup; a failed read after creation must
      // never leave the creation form open and invite a duplicate business.
      setWorkspaceLookup({key:workspaceIdentity,status:'loading',error:''});
      setStaffEpoch(value=>value+1);setMessage('Business workspace created.');
    }catch(error){setMessage(errorMessage(error),'error');}
    finally{setBusy(false);}
  }
  async function staffLogin(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!shop||!businessAuth||busy)return;setBusy(true);setMessage('');
    const form=new FormData(e.currentTarget);
    try{
      const {data,error}=await businessAuth.functions.invoke('staff-login',{body:{shopId:shop.id,username:String(form.get('username')??''),password:String(form.get('password')??'')}});
      if(error){let message=error.message;const response=(error as {context?:Response}).context;if(response)try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
      const {error:failure}=await supabase!.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
      if(failure)throw failure;setSwitchUser(false);setStaffEpoch(value=>value+1);setPage('Point of Service');
    }catch(error){setMessage(errorMessage(error),'error');}finally{setBusy(false);}
  }
  function staffLoginForm(){return <form onSubmit={staffLogin}><label>Username<input name="username" autoComplete="username" aria-invalid={messageTone==='error'&&!!message} maxLength={40} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" aria-invalid={messageTone==='error'&&!!message} required/></label><button disabled={busy||!online}>{busy?'Signing in…':'Sign in user'}</button></form>;}
  const customerName = (id: string) => ledger.customers.find(customer => customer.id === id)?.name ?? 'Unknown customer';
  const currentJob = ledger.jobs.find(job => job.id === selectedJob);
  const search = query.toLowerCase();
  const jobSorting = useTableSort<Job>('createdAt','desc');
  const paymentSorting = useTableSort<Payment>('createdAt','desc');
  const matchingJobs = jobSorting.sortRows(ledger.jobs.filter(job => `${job.description} ${job.service} ${customerName(job.customerId)} ${ledger.customers.find(c=>c.id===job.customerId)?.phone??''} ${job.productionStatus??'Added'} ${job.id}`.toLowerCase().includes(search)),{createdAt:job=>Date.parse(job.createdAt),service:job=>job.service,description:job=>job.description,id:job=>job.id,customer:job=>customerName(job.customerId),amount:job=>job.amount,
    paid:job=>jobBalance(ledger,job).paid,outstanding:job=>jobBalance(ledger,job).outstanding,status:job=>job.productionStatus??'Added',lastPayment:job=>Date.parse(lastJobPayment(ledger,job)??'')||0,source:job=>job.source??''});
  const matchingPayments = paymentSorting.sortRows(ledger.payments.filter(payment => `${payment.id} ${customerName(payment.customerId)} ${payment.reference} ${paymentName(payment)}`.toLowerCase().includes(search)),
    {createdAt:payment=>Date.parse(payment.createdAt),id:payment=>payment.id,date:payment=>Date.parse(payment.paidOn),customer:payment=>customerName(payment.customerId),amount:payment=>payment.amount,method:paymentName,
      allocations:payment=>payment.allocations.map(allocation=>ledger.jobs.find(job=>job.id===allocation.jobId)?.description??'').join(', ')});


  if (!authReady) return <main className="auth"><section className="auth-card"><h1>{authStartupError?"Could not restore your sign-in":"Opening PrintShopLedger…"}</h1>{authStartupError&&<><p role="alert">{authStartupError}</p><button onClick={()=>setAuthEpoch(value=>value+1)}>Retry sign-in loading</button></>}</section></main>;
  if (!demo && !businessSession) return <main className="auth"><div className="auth-card">
    <div className="brand-mark">S</div><h1>PrintShopLedger</h1><p>Every job. Every payment. Clearly tracked.</p>
    <form onSubmit={login}><label>Business email<input name="email" type="email" autoComplete="username" aria-invalid={messageTone==='error'&&!!message} required /></label>
      <label>Business password<input name="password" type="password" autoComplete="current-password" aria-invalid={messageTone==='error'&&!!message} required /></label>
      <button disabled={busy || !online}>Sign in</button></form>
    <button className="secondary" onClick={() => { setDemo(true); setMessage(''); }}>Try locally on this device</button>
    <p className="muted">Local trial data stays separate from business workspaces.</p><FeedbackBanner message={message} tone={messageTone} login/>
  </div></main>;

  if(!demo&&businessSession&&(workspaceLookup.key!==workspaceIdentity||workspaceLookup.status!=='ready'))return <main className="auth"><section className="auth-card"><h1>{workspaceLookup.key===workspaceIdentity&&workspaceLookup.status==='error'?'Could not load your business':'Loading business workspace…'}</h1>{workspaceLookup.key===workspaceIdentity&&workspaceLookup.status==='error'&&<><p>Your sign-in succeeded, but the workspace lookup failed. This does not mean you need to create another workspace.</p><p role="alert">{workspaceLookup.error||'The server did not respond. Please retry.'}</p><button disabled={!online} onClick={()=>setStaffEpoch(value=>value+1)}>Retry workspace lookup</button></>}<button className="secondary" onClick={async()=>{await Promise.all([supabase!.auth.signOut(),businessAuth!.auth.signOut()]);}}>Sign out</button></section></main>;
  if(!demo&&businessSession&&shops.length>0&&(!session||!shop||shop.userId!==session.user.id||shop.accessLevel===0)) return <main className="auth"><section className="auth-card"><h1>Staff sign in</h1><p>The business is signed in. Enter your username and password.</p><label>Business<select value={shop?.id??''} onChange={e=>setShop(shops.find(item=>item.id===e.target.value)??null)}>{shops.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{staffLoginForm()}<FeedbackBanner message={message} tone={messageTone} login/></section></main>;

  return <BusinessOptionsContext.Provider value={branding.settings.options}><div className="app">
    <Sidebar title={businessName} header={<>
      <div className="brand">{branding.settings.logo&&<img className="sidebar-business-logo" src={branding.settings.logo} alt={businessName+" logo"}/>}<div className="brand-copy">{!branding.settings.logo&&<strong className="brand-title">{businessName}</strong>}<span className={`connection ${online ? 'online' : ''}`} role="status">{online ? 'Online' : 'Offline'} · {state.pending.length} pending changes</span></div></div>
      <div className="sidebar-user"><strong>{demo ? 'Local trial user' : shop?.staffName || 'Not signed in'}{(demo || shop?.username) && ` (${demo ? 'trial' : shop?.username})`}</strong><small className="staff-rank">{demo ? 'Trial' : shop?.role}</small></div>
    </>} footer={<>
      {!demo&&<button className="secondary" disabled={busy||!online} onClick={()=>{setSwitchUser(true);setMessage('');}}>Switch user</button>}
      {!demo&&<button className="secondary" disabled={busy} onClick={async()=>{const {error}=await supabase!.auth.signOut({scope:'local'});if(error)setMessage(error.message,'error');else{setSession(null);setMessage('User signed out. Business remains signed in.');}}}>Logout</button>}
      {supabase && (demo || (shop?.accessLevel ?? 0) >= 3) && <button className="secondary" disabled={busy} onClick={async () => {
        if (demo) { setDemo(false); return; }
        if ((shop?.accessLevel ?? 0) < 3) return;
        const results = await Promise.all([supabase!.auth.signOut({scope:'local'}),businessAuth!.auth.signOut({scope:'local'})]);
        const failure=results.find(result=>result.error)?.error;
        if(failure)setMessage(failure.message,'error');else{setSession(null);setBusinessSession(null);setShop(null);setMessage('Business signed out.');}
      }}>{demo ? 'Business sign in' : 'Sign out business'}</button>}
    </>}>
      <nav aria-label="Main">{(pages as Page[]).filter(item=>demo||(item==='Conflict Inbox'&&!!supervisor)||canAccessPage(item,shop?.accessLevel??0,branding.settings.pageAccess)).map(item => <button key={item} className={page === item ? 'active' : ''}
        onClick={() => { setPage(item); setSelectedJob(null); setForm(null); setQuery(''); }}><Icon name={({'Dashboard':'table','Point of Service':'services','My Sales':'drawer',Jobs:'jobs',Customers:'customers',Payments:'payments',Expenses:'expenses',Materials:'materials',Services:'services','Stock History':'history','Print Settings':'quantity',Users:'customers','My Account':'customers','Business Settings':'quantity','Conflict Inbox':'history','Sale Adjustments':'history','Material Waste':'materials'} as const)[item]}/>{item}</button>)}</nav>
    </Sidebar>
    <main><header><div><span className="eyebrow">{demo ? 'LOCAL TRIAL' : businessName}</span><h1>{page}</h1><p>{page === 'Dashboard' ? 'Sales, collections, expenses and current business position.' : page === 'Sale Adjustments' ? 'Approve and review changes to sales and customer credit.' : page === 'Material Waste' ? 'Track extra material use, damage and reprints.' : page === 'Business Settings' ? '' : page === 'Conflict Inbox' ? 'Review pending work from connected staff devices.' : page === 'My Account' ? 'Manage your username and password.' : page === 'Expenses' ? 'Record expenses, payments and material purchases.' : page === 'My Sales' ? 'Review your transactions and record a verified drawer handover.' : page === 'Users' ? 'Manage staff accounts, ranks and business access.' : page === 'Print Settings' ? 'Set default printer, paper, font and margins for this device.' : page === 'Customers' ? 'Manage customer details and credit limits.' : page === 'Materials' ? 'Manage materials, quantities and pricing requirements.' : page === 'Stock History' ? 'Review every material change and stock adjustment.' : page === 'Services' ? 'Define services, their base materials and prices.' : 'Track work and keep every payment attached to its job.'}</p></div>
      {!demo&&scope&&<span className="sync-status" role="status" aria-live="polite"><Icon name="sync"/> {syncLabel}{state.pending.length>0&&` (${state.pending.length})`}</span>}</header>
      {switchUser&&<Modal title="Switch user" busy={busy} onClose={()=>setSwitchUser(false)}><p>Business: {shop?.name}. Sign in with your staff username and password.</p>{staffLoginForm()}<FeedbackBanner message={message} tone={messageTone} login/></Modal>}
      {needRefresh && <div className="notice">An app update is ready. <button className="secondary" disabled={busy} onClick={() => void updateServiceWorker(true)}>Update app</button></div>}
      <FeedbackBanner message={branding.error} tone="warning"/><FeedbackBanner message={message} tone={messageTone}/>
      {hasConflict&&!canReviewConflicts&&<div className="notice" role="alert"><strong>Admin review required.</strong><p>Conflicts have been sent to the business inbox when connected. An Admin, Manager or Developer can review them remotely. Sales sharing affected stock or customer accounts wait; unrelated sales can continue. Pending work remains saved on this device.</p><button className="secondary" disabled={!online||busy} onClick={()=>setSupervisorLogin(true)}>Supervisor review</button></div>}
      {Object.keys(state.syncConflicts??{}).length>0&&canReviewConflicts&&<div className="notice notice-warning">{heldWork.eventIds.size} pending operations await review. Unaffected sales can continue. <button className="secondary" onClick={()=>setPage('Conflict Inbox')}>Open conflict inbox</button></div>}
      {hasConflict&&supervisor&&<div className="notice">Supervisor review: {supervisor}. The cashier remains signed in.<button className="secondary" onClick={()=>{clearConflictApproval();setSupervisor('');}}>End supervisor review</button></div>}
      {supervisorLogin&&<Modal title="Supervisor conflict review" busy={busy} onClose={()=>setSupervisorLogin(false)}><p>An Admin or higher rank must enter their credentials and personally review the pending work. This does not switch the cashier or move their saved sales.</p><form onSubmit={async event=>{event.preventDefault();if(busy||!online||!businessAuth||!shop)return;const form=new FormData(event.currentTarget);setBusy(true);try{const name=await approveConflictReview(businessAuth,scope,shop.id,String(form.get('username')),String(form.get('password')));if(activeScope.current===scope){setSupervisor(name);setSupervisorLogin(false);setConflictReviewHidden(false);if(Object.keys(state.syncConflicts??{}).length)setPage('Conflict Inbox');setMessage('Supervisor access verified for five minutes.');}else clearConflictApproval();}catch(error){setMessage(errorMessage(error),'error');}finally{setBusy(false);}}}><label>Supervisor username<input name="username" autoComplete="username" aria-invalid={messageTone==='error'&&!!message} required/></label><label>Supervisor password<input name="password" type="password" autoComplete="current-password" aria-invalid={messageTone==='error'&&!!message} required/></label><button disabled={busy||!online}>Verify supervisor</button></form><FeedbackBanner message={message} tone={messageTone} login/></Modal>}
      {hasConflict&&canReviewConflicts&&conflictReviewHidden&&<div className="notice notice-warning">Sync is paused while you review an edit conflict. <button className="secondary" onClick={()=>setConflictReviewHidden(false)}>Review changes</button></div>}
      {expenseConflict&&!conflictReviewHidden && canReviewConflicts&&<Modal title="Review expense changes" wide busy={busy} onClose={()=>setConflictReviewHidden(true)}>
        <p>{expenseConflict.message}</p><div className="table-wrap"><table><thead><tr><th>Field</th><th>This device</th><th>Business version</th></tr></thead><tbody>
        <tr><td>Description</td><td>{expenseConflict.local.description}</td><td>{expenseConflict.remote?.description??'Not available'}</td></tr>
        <tr><td>Total cost</td><td>{currency(expenseConflict.local.amount)}</td><td>{expenseConflict.remote?currency(expenseConflict.remote.amount):'—'}</td></tr>
        {(['incurredOn','category','payee','note','receiptReference'] as const).map(field=><tr key={field}><td>{{incurredOn:'Date incurred',category:'Category',payee:'Supplier',note:'Notes',receiptReference:'Receipt reference'}[field]}</td><td>{expenseConflict.local[field]||'—'}</td><td>{expenseConflict.remote?.[field]||'—'}</td></tr>)}
        <tr><td>Recorded payments</td><td>{currency(expenseConflict.local.payments.reduce((sum,p)=>sum+p.amount,0))}</td><td>{currency(expenseConflict.remote?.payments.reduce((sum,p)=>sum+p.amount,0)??0)}</td></tr>
        <tr><td>Status</td><td>{expenseConflict.local.voided?'Voided':'Active'}</td><td>{expenseConflict.remote?.voided?'Voided':'Active'}</td></tr>
        <tr><td>Materials</td><td>{expenseConflict.local.materials.map(m=>`${m.name}: ${m.quantity} ${m.measurementUnit}`).join(' · ')||'None'}</td><td>{expenseConflict.remote?.materials.map(m=>`${m.name}: ${m.quantity} ${m.measurementUnit}`).join(' · ')||'None'}</td></tr>
        </tbody></table></div><p>Reapplying keeps business payments and applies your pending expense changes against the latest stock. Keeping the business version discards this device’s pending changes to this expense.</p>
        <div className="material-actions">{(['local','cloud'] as const).map(choice=><button key={choice} disabled={busy} className={choice==='cloud'?'secondary':''} onClick={async()=>{setBusy(true);const target=scope;try{const next=await resolveCloudExpense(target,shop!.id,expenseConflict.local.id,choice,expenseConflict.local.lastEventId,expenseConflict.remote?.lastEventId??null);if(activeScope.current===target){setState(next);setExpenseConflict(null);channel.current?.postMessage('changed');setMessage('Expense review saved. Sync will resume automatically.');}}catch(error){setMessage(errorMessage(error),'error');if(error instanceof ExpenseSyncConflict)setExpenseConflict(error);}finally{setBusy(false);}}}>{choice==='local'?'Reapply pending changes':'Keep business version'}</button>)}</div>
      </Modal>}
      {checkoutConflict&&!conflictReviewHidden && canReviewConflicts&&<CheckoutEditor key={checkoutConflict.event.id+JSON.stringify(checkoutConflict.cloud.payments)+JSON.stringify(checkoutConflict.cloud.services)} ledger={checkoutReviewBase(state,checkoutConflict.cloud,checkoutConflict.event.id)} initialCheckout={checkoutConflict.event.data} actor={{id:session!.user.id,label:shop?.staffName||session!.user.email||session!.user.id}} busy={busy} paymentOnly={!checkoutConflict.event.data.jobs.length} onClose={()=>setConflictReviewHidden(true)} onReceipt={setReceipt} onSave={async operation=>{setBusy(true);const target=scope;try{const next=await resolvePendingWork(target,shop!.id,checkoutConflict.event.id,operation);if(activeScope.current===target){setState(next);setCheckoutConflict(null);channel.current?.postMessage('changed');setMessage('Pending checkout updated. Use the updated receipt; syncing will resume automatically.');}return next.ledger.checkouts.find(r=>r.id===operation.id)!;}catch(error){if(error instanceof ExpenseSyncConflict)setExpenseConflict(error);if(error instanceof CheckoutSyncConflict)setCheckoutConflict(error);throw error;}finally{setBusy(false);}}}/>}
      {jobConflict&&!conflictReviewHidden && canReviewConflicts&&<Modal title="Review job progress" busy={busy} onClose={()=>setConflictReviewHidden(true)}><p>{jobConflict.message}</p><p>Business status: {jobConflict.cloud.jobs.find(j=>j.id===jobConflict.event.data.id)?.productionStatus??'Added'}</p><button disabled={busy} onClick={async()=>{setBusy(true);const target=scope;try{const next=await resolvePendingWork(target,shop!.id,jobConflict.event.id,null,jobConflict.event.data.id);if(activeScope.current===target){setState(next);setJobConflict(null);channel.current?.postMessage('changed');}}catch(error){setMessage(errorMessage(error),'error');}finally{setBusy(false);}}}>Use business status</button></Modal>}
      {customerConflict && !conflictReviewHidden && canReviewConflicts && <Modal title="Review conflicting customer edits" wide busy={busy} onClose={() => setConflictReviewHidden(true)}>
        <FeedbackBanner message={message} tone={messageTone}/>
        <div className="table-wrap"><table><thead><tr><th>Field</th><th>This device</th><th>Business workspace</th></tr></thead><tbody>
          {(['name','phone','address','creditLimit','archived','modifiedByLabel'] as const).map(field => <tr key={field}><td>{{name:'Full name',phone:'Phone',address:'Address',creditLimit:'Credit limit',archived:'Archived',modifiedByLabel:'Modified by'}[field]}</td>
            <td>{field==='creditLimit'?currency(customerConflict.local.creditLimit):String(customerConflict.local[field])}</td>
            <td>{customerConflict.remote ? field==='creditLimit'?currency(customerConflict.remote.creditLimit):String(customerConflict.remote[field]) : 'Not available'}</td></tr>)}
        </tbody></table></div>
        <p>Keeping the business version discards pending edits to this customer. Other pending records are kept.</p>
        <div className="material-actions"><button disabled={busy} onClick={() => void resolveCustomerConflict('local')}>Keep this device's version</button><button className="secondary" disabled={busy} onClick={() => void resolveCustomerConflict('cloud')}>Keep business version</button></div>
      </Modal>}
      {serviceConflict && !conflictReviewHidden && canReviewConflicts && <ServiceConflictReview key={serviceConflict.local.lastEventId + (serviceConflict.remote?.lastEventId ?? '') + serviceConflict.materials.map(item => item.lastEventId).join('')} conflict={serviceConflict} busy={busy} message={message} onClose={() => setConflictReviewHidden(true)} onResolve={resolveServiceConflict} />}
      {conflict && !conflictReviewHidden && canReviewConflicts && <Modal title="Review conflicting material edits" wide busy={busy} onClose={() => setConflictReviewHidden(true)}>
        <FeedbackBanner message={message} tone={messageTone}/>
        <div className="table-wrap"><table><thead><tr><th>Field</th><th>This device</th><th>Business workspace</th></tr></thead><tbody>
          <tr><td>Name</td><td>{conflict.local.name}</td><td>{conflict.remote.name}</td></tr>
          <tr><td>Available</td><td>{conflict.local.available}</td><td>{conflict.remote.available}</td></tr>
          <tr><td>Measurement unit</td><td>{conflict.local.measurementUnit}</td><td>{conflict.remote.measurementUnit}</td></tr>
          <tr><td>Require size</td><td>{conflict.local.requireSize ? 'Yes' : 'No'}</td><td>{conflict.remote.requireSize ? 'Yes' : 'No'}</td></tr>
          <tr><td>Status</td><td>{conflict.local.archived ? 'Archived' : 'Active'}</td><td>{conflict.remote.archived ? 'Archived' : 'Active'}</td></tr>
          <tr><td>Modified by</td><td>{conflict.local.modifiedByLabel}</td><td>{conflict.remote.modifiedByLabel}</td></tr>
        </tbody></table></div><p>Reapplying your edits preserves business stock movements. Stock additions add your pending quantities to the current business stock; stock-count corrections use your chosen count. Keeping the business version discards pending edits to this material. Other pending records are kept.</p>
        <div className="material-actions"><button disabled={busy} onClick={() => void resolveConflict('local')}>Reapply pending edits</button><button className="secondary" disabled={busy} onClick={() => void resolveConflict('cloud')}>Keep business version</button></div>
      </Modal>}
      {!demo && !shop ? <section className="auth-card"><h2>Create your business workspace</h2><p>Each business gets its own customers, jobs and payments.</p><form onSubmit={createWorkspace}><label>Business name<input name="businessName" maxLength={160} required /></label><button disabled={busy || !online}>Create workspace</button></form><p className="muted">If you should join an existing business, ask its administrator to add your account.</p></section> : <>
        {page === 'Dashboard' && pageAllowed ? <Suspense fallback={<section className="panel empty" role="status">Loading dashboard charts…</section>}><DashboardPage ledger={ledger} ready={ready} online={online} pending={state.pending.length} lastSynced={state.lastSynced} access={{customers:demo||canAccessPage('Customers',shop?.accessLevel??0,branding.settings.pageAccess),sales:demo||canAccessPage('Jobs',shop?.accessLevel??0,branding.settings.pageAccess),payments:demo||canAccessPage('Payments',shop?.accessLevel??0,branding.settings.pageAccess),expenses:demo||canAccessPage('Expenses',shop?.accessLevel??0,branding.settings.pageAccess),materials:demo||canAccessPage('Materials',shop?.accessLevel??0,branding.settings.pageAccess)}}/></Suspense> : !pageAllowed ? <p role="alert">You do not have access to this page.</p> : page === 'Sale Adjustments' ? <SaleAdjustmentsPage recentDays={branding.settings.corrections.recentDays} ledger={ledger} ready={ready} busy={busy||hasConflict} canSave={demo||online} onAdjust={setAdjustingJob}/> : page === 'Material Waste' ? <MaterialWastePage ledger={ledger} ready={ready} busy={busy||hasConflict} canSave={demo||online} actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.email||session!.user.id}} onSave={approveOperation}/> : page === 'Conflict Inbox' ? (demo?<section className="panel"><h2>Conflict inbox</h2><p>Remote reviews are available in a connected business workspace.</p></section>:<ConflictInbox key={scope} scope={scope} shopId={shop!.id} online={online} onChanged={()=>{if(activeScope.current!==scope)return;void readState(scope).then(next=>{if(activeScope.current===scope)setState(next);});setMessage('Review saved. The original device will receive it automatically when connected.');}}/>) : page === 'My Account' ? <AccountPage key={`${scope}:${shop?.username}`} shopId={shop?.id??''} userId={session?.user.id??''} businessAccount={!!session && session.user.id===businessSession?.user.id} username={shop?.username??''} online={online} demo={demo} themePreference={branding.preference} setThemePreference={branding.setTheme} onChanged={message=>{setMessage(message);setStaffEpoch(value=>value+1);}}/> : page === 'Business Settings' ? <BusinessSettingsPage key={scope} settings={branding.settings} version={branding.version} ready={branding.ready} online={online} demo={demo} modifiedAt={branding.modifiedAt} onSave={branding.save} onReload={branding.reload}/> : page === 'Expenses' ? <ExpensesPage key={scope} ledger={ledger} ready={ready} busy={(!demo&&(shop?.accessLevel??0)<2)||busy||hasConflict} actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.email||session!.user.id}} pending={state.pending} onSave={saveCatalogue}/> : page === 'My Sales' ? <MySalesPage key={scope} ledger={ledger} userId={demo?'local-trial':session!.user.id} username={demo?'trial':shop?.username??''} name={demo?'Local trial user':shop?.staffName??''} ready={ready} busy={busy||hasConflict} online={online} demo={demo} pending={state.pending.length} onReceipt={setReceipt} onHandover={closeDrawer}/> : page === 'Point of Service' ? <PointOfServicePage ledger={ledger} busy={busy||legacyConflict} ready={ready} onCheckout={()=>{setPaymentCustomer('');setForm('job');}} onPayment={()=>openPayment()} onJob={setSelectedJob} onNext={(job,mode)=>setJobToAdvance({job,mode})} onReceipt={setReceipt}/> : page === 'Users' ? <UsersPage key={scope} shopId={shop?.id ?? ''} actorId={session?.user.id ?? ''} businessUserId={businessSession?.user.id ?? ''} role={shop?.role ?? ''} online={online} demo={demo} onChanged={()=>setStaffEpoch(value=>value+1)} /> : page === 'Print Settings' ? <PrintSettingsPage key={scope} scope={scope} ready={ready}/> : page === 'Customers' ? <CustomersPage key={scope} ledger={ledger} ready={ready} busy={busy || hasConflict}
          actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.user_metadata.full_name||session!.user.email||session!.user.id}} onSave={saveCatalogue} onRecordPayment={id=>openPayment(id)} /> : page === 'Materials' ? <MaterialsPage key={scope} materials={ledger.materials} history={ledger.materialHistory} ready={ready} busy={(!demo && shop?.role === 'cashier') || busy || hasConflict}
          actor={{ id: demo ? 'local-trial' : session!.user.id, label: demo ? 'Local trial user' : shop?.staffName || session!.user.user_metadata.full_name || session!.user.email || session!.user.id }}
          onSave={saveCatalogue} /> : page === 'Services' ? <ServicesPage key={scope} services={ledger.services} materials={ledger.materials} ready={ready} busy={(!demo && shop?.role === 'cashier') || busy || hasConflict}
          actor={{ id: demo ? 'local-trial' : session!.user.id, label: demo ? 'Local trial user' : shop?.staffName || session!.user.user_metadata.full_name || session!.user.email || session!.user.id }} onSave={saveCatalogue} /> : page === 'Stock History' ? <StockHistoryPage key={scope} history={ledger.materialHistory} materials={ledger.materials} pending={state.pending} ready={ready} demo={demo} /> : <>
        <section className="stats"><article><span>Total job value</span><strong>{currency(total)}</strong><small>{ledger.jobs.length} jobs</small></article>
          <article><span>Paid against jobs</span><strong>{currency(paid)}</strong><small>Allocated to individual jobs</small></article>
          <article><span>Outstanding</span><strong>{currency(total - paid)}</strong><small>{ledger.jobs.filter(job => jobBalance(ledger, job).outstanding > 0).length} jobs awaiting payment</small></article></section>
        <section className="panel"><div className="toolbar"><label className="list-sort-select">Sort by<select aria-label={page==='Jobs'?'Sort jobs by':'Sort payments by'} value={page==='Jobs'?jobSorting.key:paymentSorting.key} onChange={e=>(page==='Jobs'?jobSorting:paymentSorting).toggle(e.target.value)}>
          {page==='Jobs'?<><option value="createdAt">Created at</option><option value="id">Job ID</option><option value="description">Description</option><option value="service">Service</option><option value="customer">Customer</option><option value="amount">Job amount</option><option value="paid">Paid</option><option value="outstanding">Outstanding</option><option value="status">Job stage</option><option value="lastPayment">Last payment date</option></>:<><option value="createdAt">Created at</option><option value="id">Payment ID</option><option value="date">Payment date</option><option value="customer">Customer</option><option value="amount">Amount</option><option value="method">Method</option><option value="allocations">Job allocations</option></>}
        </select></label><button className="secondary" onClick={()=>{const sorting=page==='Jobs'?jobSorting:paymentSorting;sorting.toggle(sorting.key);}}>{(page==='Jobs'?jobSorting:paymentSorting).direction==='asc'?'Ascending ↑':'Descending ↓'}</button><input aria-label={`Search ${page.toLowerCase()}`} placeholder={`Search ${page.toLowerCase()}.`} value={query} onChange={e => setQuery(e.target.value)} />
          <button disabled={!ready || busy || legacyConflict || (page==='Payments'&&!ledger.customers.length)} onClick={() => {
            setMessage(''); if (page === 'Payments') openPayment(); else setForm('job');
          }}><Icon name="add"/> {page === 'Jobs' ? 'New job' : 'Record payment'}</button></div>
          {!ready ? <div className="empty">Loading saved records.</div> : page === 'Jobs' ? <>
            {!ledger.jobs.length ? <div className="empty"><div className="empty-icon">?</div><h2>Your jobs start here</h2><p>Add a customer, create their job, then record payments against it.</p>
              {!ledger.customers.length && <button onClick={() => setForm('customer')}>Add your first customer</button>}</div> : <div className="table-wrap"><JobTable ledger={ledger} jobs={matchingJobs} sorting={jobSorting} busy={busy||legacyConflict} onJob={setSelectedJob} onAction={(job,mode)=>setJobToAdvance({job,mode})}/>{!matchingJobs.length && <p className="empty">No matching jobs.</p>}</div>}</>
          : <>{!ledger.payments.length ? <div className="empty"><h2>A clear payment trail</h2><p>Payments appear here with the jobs they cover.</p></div> : <div className="table-wrap"><ResponsiveTable extraSortOptions={[{key:"createdAt",label:"Created at"},{key:"date",label:"Payment date"}]} columns={[{index:0,label:"Payment",details:[1]},{index:2,label:"Amount",details:[3]},{index:4,label:"Jobs"}]}><table><thead><tr><SortHeader label="Payment" column="id" sort={paymentSorting}/><SortHeader label="Customer" column="customer" sort={paymentSorting}/><SortHeader label="Amount" column="amount" sort={paymentSorting}/><SortHeader label="Method" column="method" sort={paymentSorting}/><SortHeader label="Job allocations" column="allocations" sort={paymentSorting}/></tr></thead><tbody>
            {matchingPayments.map(payment => <tr key={payment.id}>
              <td>#{shortId(payment.id)}<small>{dateLabel(payment.paidOn)}{payment.reference && ` · ${payment.reference}`}</small></td><td>{customerName(payment.customerId)}</td><td>{currency(payment.amount)}<small>Wallet used: {currency(payment.walletUsed??0)}</small><small>Wallet added: {currency(payment.walletAdded??0)}</small></td><td>{paymentName(payment)}</td>
              <td>{payment.refundId&&<strong>Refund: {currency(payment.walletUsed??0)}<small>Money returned to customer</small></strong>}{payment.checkoutId&&ledger.checkouts.find(r=>r.id===payment.checkoutId)&&<button className="text-button" onClick={()=>setReceipt(ledger.checkouts.find(r=>r.id===payment.checkoutId)!)}>Receipt</button>}{payment.allocations.map(allocation => <small key={allocation.jobId}>{ledger.jobs.find(job => job.id === allocation.jobId)?.description} - {currency(allocation.amount)}</small>)}</td></tr>)}</tbody></table></ResponsiveTable></div>}</>}
        </section>
        </>}
        <p className="footnote">{demo ? 'Local trial · This device only · No cloud uploads' : `Last synced: ${state.lastSynced ? new Date(state.lastSynced).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : 'Not yet synced'}`} · Currency: NGN</p>
      </>}
      {currentJob && <Modal title={currentJob.description} wide busy={busy} onClose={() => setSelectedJob(null)}><span className="eyebrow">JOB #{shortId(currentJob.id)}</span><p>{customerName(currentJob.customerId)} · {currentJob.service}</p>
        <div className="detail-summary"><span>Job amount <strong>{currency(currentJob.amount)}</strong></span><span>Paid <strong>{currency(jobBalance(ledger, currentJob).paid)}</strong></span><span>Outstanding <strong>{currency(jobBalance(ledger, currentJob).outstanding)}</strong></span></div>
        {currentJob.productionStatus==='Cancelled'&&<p className="notice notice-warning">This sale was cancelled. Original receipts and adjustments remain in history.</p>}
        <h3>Payment history</h3>{ledger.payments.filter(payment => payment.allocations.some(allocation => allocation.jobId === currentJob.id)).map(payment => <div className="history" key={payment.id}>
          <span>{dateLabel(payment.paidOn)} · {paymentName(payment)}<small>{payment.reference || `Payment #${shortId(payment.id)}`}</small></span><strong>{currency(payment.allocations.find(allocation => allocation.jobId === currentJob.id)!.amount)}</strong></div>)}
        {!ledger.payments.some(payment => payment.allocations.some(allocation => allocation.jobId === currentJob.id)) && <p className="muted">No payments recorded yet.</p>}
        {(demo||canAccessPage('Sale Adjustments',shop?.accessLevel??0,branding.settings.pageAccess))&&<button className="secondary" disabled={busy||hasConflict||(!demo&&!online)} onClick={()=>{setSelectedJob(null);setAdjustingJob(currentJob);}}>Adjust sale / refund</button>}
        <AdjustmentHistory records={ledger.saleAdjustments.filter(r=>r.jobId===currentJob.id||r.paymentChanges.some(p=>[...p.before.allocations,...p.after.allocations].some(a=>a.jobId===currentJob.id)))}/>
        <JobActions job={currentJob} busy={busy||legacyConflict} onAction={(job,mode)=>setJobToAdvance({job,mode})}/>
        <button disabled={busy || legacyConflict || heldWork.resources.has('customer:'+currentJob.customerId) || jobBalance(ledger, currentJob).outstanding <= 0} onClick={() => openPayment(currentJob.customerId)}>Receive customer payment</button>
      </Modal>}
      {form === 'customer' && <CustomerEditor customers={ledger.customers} busy={busy} actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.user_metadata.full_name||session!.user.email||session!.user.id}} onSave={saveCatalogue} onClose={()=>setForm(null)} />}
      {form && form !== 'customer' && <CheckoutEditor ledger={ledger} actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.email||session!.user.id}} busy={busy} paymentOnly={form==='payment'} initialCustomer={form==='payment'?paymentCustomer:''} onSave={completeCheckout} onClose={()=>setForm(null)} onReceipt={setReceipt}/>}
      {adjustingJob&&<SaleAdjustmentEditor ledger={ledger} job={adjustingJob} busy={busy} actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.email||session!.user.id}} onClose={()=>setAdjustingJob(null)} onSave={approveOperation}/>}
      {receipt&&<ReceiptView ledger={ledger} record={ledger.checkouts.find(r=>r.id===receipt.id)??receipt} scope={scope} business={branding.settings} adjustments={ledger.saleAdjustments.filter(a=>a.before.checkoutId===receipt.id||receipt.jobBalances.some(j=>j.id===a.jobId)||a.paymentChanges.some(p=>p.before.id===receipt.id||p.before.checkoutId===receipt.id||[...p.before.allocations,...p.after.allocations].some(x=>receipt.jobBalances.some(j=>j.id===x.jobId))))} pending={state.pending.some(e=>e.id===receipt.id)} onClose={()=>setReceipt(null)}/>}
      {jobToAdvance&&<JobProgressDialog job={jobToAdvance.job} mode={jobToAdvance.mode} busy={busy} onClose={()=>setJobToAdvance(null)} onSave={async targetStage=>{
        if(busy||!ready||!scope||legacyConflict)throw Error('Wait until the workspace is ready.');
        const targetScope=scope;setBusy(true);
        try {
          const events=progressEvents(jobToAdvance.job,targetStage,{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':shop?.staffName||session!.user.email||session!.user.id});
          const next=await saveEvents(targetScope,events,!demo);
          if(activeScope.current===targetScope){setState(next);channel.current?.postMessage('changed');setJobToAdvance(null);setMessage('Job stages saved in order. Changes sync automatically when connected.');}
        }finally{setBusy(false);}
      }}/>}

    </main>
  </div></BusinessOptionsContext.Provider>;
}


