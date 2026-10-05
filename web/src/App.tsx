import { useEffect, useRef, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Session } from '@supabase/supabase-js';
import { applyEvent, customerBalance, emptyLedger, jobBalance, money } from './domain.mjs';
import { supabase, syncLedger, MaterialSyncConflict, resolveCloudMaterial, ServiceSyncConflict, resolveCloudService, CustomerSyncConflict, resolveCloudCustomer } from './cloud';
import { readState, saveEvent } from './storage';
import MaterialsPage from './MaterialsPage';
import CustomersPage from './CustomersPage';
import CustomerEditor from './CustomerEditor';
import { SortHeader, useTableSort } from './TableSort';
import ServicesPage from './ServicesPage';
import ServiceConflictReview from './ServiceConflictReview';
import StockHistoryPage from './StockHistoryPage';
import type { LedgerEvent, LocalState, Payment, MaterialEvent, ServiceEvent, CustomerEvent, Job } from './types';

type Shop = { id: string; name: string; role: string };
type Page = 'Jobs' | 'Customers' | 'Payments' | 'Materials' | 'Stock History' | 'Services';
const currency = (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount / 100);
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const today = () => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';
const event = (kind: LedgerEvent['kind'], data: LedgerEvent['data']) => ({ id: crypto.randomUUID(), kind, data }) as LedgerEvent;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [demo, setDemo] = useState(!supabase);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [state, setState] = useState<LocalState>({ ledger: emptyLedger(), pending: [] });
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('Jobs');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<'customer' | 'job' | 'payment' | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [paymentCustomer, setPaymentCustomer] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [customerConflict, setCustomerConflict] = useState<CustomerSyncConflict | null>(null);
  const [serviceConflict, setServiceConflict] = useState<ServiceSyncConflict | null>(null);
  const [conflict, setConflict] = useState<MaterialSyncConflict | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const scope = demo ? 'local-trial' : session && shop ? `${session.user.id}:${shop.id}` : '';
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const channel = useRef<BroadcastChannel | null>(null);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const ledger = state.ledger;
  const total = ledger.jobs.reduce((sum, job) => sum + job.amount, 0);
  const paid = ledger.payments.reduce((sum, payment) => sum + payment.amount, 0);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      setSession(data.session); setAuthReady(true);
    }).catch(error => { if (active) { setMessage(errorMessage(error)); setAuthReady(true); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => { if (active) setSession(current); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session || demo || !supabase) { setShops([]); setShop(null); return; }
    let active = true;
    const cacheKey = `printshopledger-workspaces:${session.user.id}`;
    async function loadShops() {
      try {
        let available: Shop[];
        if (navigator.onLine) {
          const { data, error } = await supabase!.rpc('list_my_shops');
          if (error) throw error;
          available = data ?? [];
          localStorage.setItem(cacheKey, JSON.stringify(available));
        } else available = JSON.parse(localStorage.getItem(cacheKey) ?? '[]');
        if (active) { setShops(available); setShop(current => available.find(item => item.id === current?.id) ?? available[0] ?? null); }
      } catch (error) { if (active) setMessage(errorMessage(error)); }
    }
    void loadShops();
    return () => { active = false; };
  }, [session?.user.id, demo, online]);

  useEffect(() => {
    setReady(false); setState({ ledger: emptyLedger(), pending: [] });
    setForm(null); setSelectedJob(null); setQuery(''); setConflict(null); setServiceConflict(null); setCustomerConflict(null);
    if (!scope) return;
    let active = true;
    const refresh = () => readState(scope).then(value => { if (active) { setState(value); setReady(true); } })
      .catch(error => { if (active) setMessage(`Local storage failed: ${errorMessage(error)}`); });
    void refresh();
    const broadcast = new BroadcastChannel(`printshopledger:${scope}`);
    channel.current = broadcast; broadcast.onmessage = () => { void refresh(); };
    return () => { active = false; broadcast.close(); if (channel.current === broadcast) channel.current = null; };
  }, [scope]);

  async function save(operation: LedgerEvent) {
    const target = scope;
    const next = await saveEvent(target, operation, !demo);
    if (activeScope.current !== target) return;
    setState(next); channel.current?.postMessage('changed'); setForm(null);
    setMessage(demo ? 'Saved on this device.' : 'Saved on this device. Sync to send it to your business workspace.');
  }
  async function saveCatalogue(operation: MaterialEvent | ServiceEvent | CustomerEvent) {
    if (busy || !ready) throw new Error('Please wait until the workspace is ready.');
    setBusy(true); setMessage('');
    try { await save(operation); } finally { setBusy(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setMessage('');
    const data = new FormData(e.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    try {
      const id = crypto.randomUUID(), createdAt = new Date().toISOString();
      if (form === 'job') await save(event('job.created', { id, createdAt, customerId: text('customer'), service: text('service'), description: text('description'), amount: money(text('amount')) }));
      else if (form === 'payment') {
        const payment: Payment = { id, createdAt, customerId: paymentCustomer, amount: money(text('amount')),
          method: text('method') as Payment['method'], paidOn: text('paidOn'), reference: text('reference'),
          allocations: Object.entries(allocations).filter(([, value]) => value.trim() && money(value) > 0)
            .map(([jobId, value]) => ({ jobId, amount: money(value) })) };
        // Gives immediate feedback; saveEvent validates again against latest IndexedDB state.
        applyEvent(ledger, event('payment.recorded', payment));
        await save(event('payment.recorded', payment));
      }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function sync() {
    if (busy || !shop) return;
    setBusy(true); setMessage('');
    const target = scope;
    try {
      const next = await syncLedger(target, shop.id);
      if (activeScope.current === target) { setState(next); channel.current?.postMessage('changed'); setMessage('Business workspace synced.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error)); if (error instanceof MaterialSyncConflict) setConflict(error); if (error instanceof ServiceSyncConflict) setServiceConflict(error); if (error instanceof CustomerSyncConflict) setCustomerConflict(error); } }
    finally { setBusy(false); }
  }
  async function resolveConflict(choice: 'local' | 'cloud') {
    if (!conflict || !shop || busy) return;
    const target = scope;
    setBusy(true);
    try {
      const next = await resolveCloudMaterial(target, shop.id, conflict.local.id, choice, conflict.local.lastEventId, conflict.remote.lastEventId);
      if (activeScope.current === target) { setState(next); setConflict(null); channel.current?.postMessage('changed'); setMessage('Choice saved. Sync workspace to continue sending pending changes.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error)); if (error instanceof MaterialSyncConflict) setConflict(error); } }
    finally { setBusy(false); }
  }
  async function resolveServiceConflict(choice: 'local' | 'cloud', materialId: string) {
    if (!serviceConflict || !shop || busy) return;
    const target = scope; setBusy(true);
    try {
      const next = await resolveCloudService(target, shop.id, serviceConflict.local.id, choice, serviceConflict.local.lastEventId, serviceConflict.remote?.lastEventId ?? null, materialId);
      if (activeScope.current === target) { setState(next); setServiceConflict(null); channel.current?.postMessage('changed'); setMessage('Choice saved. Sync workspace to continue sending pending changes.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error)); if (error instanceof ServiceSyncConflict) setServiceConflict(error); if (error instanceof CustomerSyncConflict) setCustomerConflict(error); } }
    finally { setBusy(false); }
  }
  async function resolveCustomerConflict(choice: 'local' | 'cloud') {
    if (!customerConflict || !shop || busy) return;
    const target = scope; setBusy(true);
    try {
      const next = await resolveCloudCustomer(target, shop.id, customerConflict.local.id, choice, customerConflict.local.lastEventId, customerConflict.remote?.lastEventId ?? null);
      if (activeScope.current === target) { setState(next); setCustomerConflict(null); channel.current?.postMessage('changed'); setMessage('Choice saved. Sync workspace to continue sending pending changes.'); }
    } catch (error) { if (activeScope.current === target) { setMessage(errorMessage(error)); if (error instanceof CustomerSyncConflict) setCustomerConflict(error); } }
    finally { setBusy(false); }
  }
  function openPayment(customerId = '', jobId = '') {
    setSelectedJob(null); setPaymentCustomer(customerId); setAllocations(jobId ? { [jobId]: '' } : {}); setForm('payment'); setMessage('');
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) });
      if (error) throw error;
      setDemo(false); setMessage('');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function createWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage('');
    const data = new FormData(e.currentTarget);
    try {
      const { data: id, error } = await supabase!.rpc('create_shop', { p_name: String(data.get('businessName')).trim() });
      if (error) throw error;
      const { data: available, error: listError } = await supabase!.rpc('list_my_shops');
      if (listError) throw listError;
      setShops(available); setShop(available.find((item: Shop) => item.id === id));
      localStorage.setItem(`printshopledger-workspaces:${session!.user.id}`, JSON.stringify(available));
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const customerName = (id: string) => ledger.customers.find(customer => customer.id === id)?.name ?? 'Unknown customer';
  const currentJob = ledger.jobs.find(job => job.id === selectedJob);
  const search = query.toLowerCase();
  const jobSorting = useTableSort<Job>('createdAt','desc');
  const paymentSorting = useTableSort<Payment>('createdAt','desc');
  const matchingJobs = jobSorting.sortRows(ledger.jobs.filter(job => `${job.description} ${job.service} ${customerName(job.customerId)} ${job.id}`.toLowerCase().includes(search)),{createdAt:job=>Date.parse(job.createdAt),service:job=>job.service,description:job=>job.description,id:job=>job.id,customer:job=>customerName(job.customerId),amount:job=>job.amount,
    paid:job=>jobBalance(ledger,job).paid,outstanding:job=>jobBalance(ledger,job).outstanding,status:job=>jobBalance(ledger,job).status});
  const matchingPayments = paymentSorting.sortRows(ledger.payments.filter(payment => `${payment.id} ${customerName(payment.customerId)} ${payment.reference} ${payment.method}`.toLowerCase().includes(search)),
    {createdAt:payment=>Date.parse(payment.createdAt),id:payment=>payment.id,date:payment=>Date.parse(payment.paidOn),customer:payment=>customerName(payment.customerId),amount:payment=>payment.amount,method:payment=>payment.method,
      allocations:payment=>payment.allocations.map(allocation=>ledger.jobs.find(job=>job.id===allocation.jobId)?.description??'').join(', ')});
  const allocated = Object.values(allocations).reduce((sum, value) => { try { return sum + money(value || '0'); } catch { return sum; } }, 0);

  if (!authReady) return <main className="auth"><p>Opening PrintShopLedger.</p></main>;
  if (!demo && !session) return <main className="auth"><div className="auth-card">
    <div className="brand-mark">S</div><h1>PrintShopLedger</h1><p>Every job. Every payment. Clearly tracked.</p>
    <form onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy || !online}>Sign in</button></form>
    <button className="secondary" onClick={() => { setDemo(true); setMessage(''); }}>Try locally on this device</button>
    <p className="muted">Local trial data stays separate from business workspaces.</p>{message && <p role="alert">{message}</p>}
  </div></main>;

  return <div className="app">
    <aside><div className="brand"><div className="brand-mark">S</div><div>PrintShopLedger<small>Business workspace</small></div></div>
      <div className="workspace">{demo ? <><strong>Local trial</strong><small>Explore with your own sample records</small></> :
        <><label>Business<select disabled={busy} value={shop?.id ?? ''} onChange={e => setShop(shops.find(item => item.id === e.target.value) ?? null)}>
          {shops.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>{shop?.role ?? 'No workspace assigned'}</small></>}
      </div>
      <nav aria-label="Main">{(['Jobs', 'Customers', 'Payments', 'Materials', 'Services', 'Stock History'] as Page[]).map((item, index) => <button key={item} className={page === item ? 'active' : ''}
        onClick={() => { setPage(item); setSelectedJob(null); setForm(null); setQuery(''); }}><span aria-hidden="true">{['J', 'C', 'P', 'M', 'S', 'H'][index]}</span>{item}</button>)}</nav>
      <div className="sidebar-bottom"><span className={`connection ${online ? 'online' : ''}`}>{online ? 'Online' : 'Offline'}</span>
        <small>{demo ? 'Data saved on this device' : `${state.pending.length} pending changes`}</small>
        {supabase && <button className="secondary" disabled={busy} onClick={async () => {
          if (demo) { setDemo(false); return; }
          const { error } = await supabase!.auth.signOut({ scope: 'local' });
          if (error) setMessage(error.message); else { setSession(null); setShop(null); setMessage('Signed out.'); }
        }}>{demo ? 'Business sign in' : 'Sign out'}</button>}
      </div>
    </aside>
    <main><header><div><span className="eyebrow">{demo ? 'LOCAL TRIAL' : shop?.name ?? 'BUSINESS WORKSPACE'}</span><h1>{page}</h1><p>{page === 'Customers' ? 'Manage customer details and credit limits.' : page === 'Materials' ? 'Manage materials, quantities and pricing requirements.' : page === 'Stock History' ? 'Review every material change and stock adjustment.' : page === 'Services' ? 'Define services, their base materials and prices.' : 'Track work and keep every payment attached to its job.'}</p></div>
      {!demo && <button className="secondary" onClick={sync} disabled={busy || !online || !shop || !ready}>{busy ? 'Working.' : 'Sync workspace'}</button>}</header>
      {needRefresh && <div className="notice">An app update is ready. <button className="secondary" disabled={busy} onClick={() => void updateServiceWorker(true)}>Update app</button></div>}
      {message && <div className="notice" role="status">{message}</div>}
      {customerConflict && <Modal title="Review conflicting customer edits" wide busy={busy} onClose={() => setCustomerConflict(null)}>
        {message && <p role="status">{message}</p>}
        <div className="table-wrap"><table><thead><tr><th>Field</th><th>This device</th><th>Business workspace</th></tr></thead><tbody>
          {(['name','phone','address','creditLimit','archived','modifiedByLabel'] as const).map(field => <tr key={field}><td>{{name:'Full name',phone:'Phone',address:'Address',creditLimit:'Credit limit',archived:'Archived',modifiedByLabel:'Modified by'}[field]}</td>
            <td>{field==='creditLimit'?currency(customerConflict.local.creditLimit):String(customerConflict.local[field])}</td>
            <td>{customerConflict.remote ? field==='creditLimit'?currency(customerConflict.remote.creditLimit):String(customerConflict.remote[field]) : 'Not available'}</td></tr>)}
        </tbody></table></div>
        <p>Keeping the business version discards pending edits to this customer. Other pending records are kept.</p>
        <div className="material-actions"><button disabled={busy} onClick={() => void resolveCustomerConflict('local')}>Keep this device's version</button><button className="secondary" disabled={busy} onClick={() => void resolveCustomerConflict('cloud')}>Keep business version</button></div>
      </Modal>}
      {serviceConflict && <ServiceConflictReview key={serviceConflict.local.lastEventId + (serviceConflict.remote?.lastEventId ?? '') + serviceConflict.materials.map(item => item.lastEventId).join('')} conflict={serviceConflict} busy={busy} message={message} onClose={() => setServiceConflict(null)} onResolve={resolveServiceConflict} />}
      {conflict && <Modal title="Review conflicting material edits" wide busy={busy} onClose={() => setConflict(null)}>
        {message && <div className="notice" role="status">{message}</div>}
        <div className="table-wrap"><table><thead><tr><th>Field</th><th>This device</th><th>Business workspace</th></tr></thead><tbody>
          <tr><td>Name</td><td>{conflict.local.name}</td><td>{conflict.remote.name}</td></tr>
          <tr><td>Available</td><td>{conflict.local.available}</td><td>{conflict.remote.available}</td></tr>
          <tr><td>Measurement unit</td><td>{conflict.local.measurementUnit}</td><td>{conflict.remote.measurementUnit}</td></tr>
          <tr><td>Require size</td><td>{conflict.local.requireSize ? 'Yes' : 'No'}</td><td>{conflict.remote.requireSize ? 'Yes' : 'No'}</td></tr>
          <tr><td>Status</td><td>{conflict.local.archived ? 'Archived' : 'Active'}</td><td>{conflict.remote.archived ? 'Archived' : 'Active'}</td></tr>
          <tr><td>Modified by</td><td>{conflict.local.modifiedByLabel}</td><td>{conflict.remote.modifiedByLabel}</td></tr>
        </tbody></table></div><p>Keeping the business version discards pending changes to this material on this device. Other pending records are kept.</p>
        <div className="material-actions"><button disabled={busy} onClick={() => void resolveConflict('local')}>Keep this device's version</button><button className="secondary" disabled={busy} onClick={() => void resolveConflict('cloud')}>Keep business version</button></div>
      </Modal>}
      {!demo && !shop ? <section className="auth-card"><h2>Create your business workspace</h2><p>Each business gets its own customers, jobs and payments.</p><form onSubmit={createWorkspace}><label>Business name<input name="businessName" maxLength={160} required /></label><button disabled={busy || !online}>Create workspace</button></form><p className="muted">If you should join an existing business, ask its administrator to add your account.</p></section> : <>
        {page === 'Customers' ? <CustomersPage key={scope} ledger={ledger} ready={ready} busy={busy || !!conflict || !!serviceConflict || !!customerConflict}
          actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':session!.user.user_metadata.full_name||session!.user.email||session!.user.id}} onSave={saveCatalogue} onRecordPayment={id=>openPayment(id)} /> : page === 'Materials' ? <MaterialsPage key={scope} materials={ledger.materials} history={ledger.materialHistory} ready={ready} busy={busy || !!conflict || !!serviceConflict || !!customerConflict}
          actor={{ id: demo ? 'local-trial' : session!.user.id, label: demo ? 'Local trial user' : session!.user.user_metadata.full_name || session!.user.email || session!.user.id }}
          onSave={saveCatalogue} /> : page === 'Services' ? <ServicesPage key={scope} services={ledger.services} materials={ledger.materials} ready={ready} busy={busy || !!conflict || !!serviceConflict || !!customerConflict}
          actor={{ id: demo ? 'local-trial' : session!.user.id, label: demo ? 'Local trial user' : session!.user.user_metadata.full_name || session!.user.email || session!.user.id }} onSave={saveCatalogue} /> : page === 'Stock History' ? <StockHistoryPage key={scope} history={ledger.materialHistory} materials={ledger.materials} pending={state.pending} ready={ready} demo={demo} /> : <>
        <section className="stats"><article><span>Total job value</span><strong>{currency(total)}</strong><small>{ledger.jobs.length} jobs</small></article>
          <article><span>Payments received</span><strong>{currency(paid)}</strong><small>Allocated to individual jobs</small></article>
          <article><span>Outstanding</span><strong>{currency(total - paid)}</strong><small>{ledger.jobs.filter(job => jobBalance(ledger, job).outstanding > 0).length} jobs awaiting payment</small></article></section>
        <section className="panel"><div className="toolbar"><label className="list-sort-select">Sort by<select aria-label={page==='Jobs'?'Sort jobs by':'Sort payments by'} value={page==='Jobs'?jobSorting.key:paymentSorting.key} onChange={e=>(page==='Jobs'?jobSorting:paymentSorting).toggle(e.target.value)}>
          {page==='Jobs'?<><option value="createdAt">Created at</option><option value="id">Job ID</option><option value="description">Description</option><option value="service">Service</option><option value="customer">Customer</option><option value="amount">Job amount</option><option value="paid">Paid</option><option value="outstanding">Outstanding</option><option value="status">Status</option></>:<><option value="createdAt">Created at</option><option value="id">Payment ID</option><option value="date">Payment date</option><option value="customer">Customer</option><option value="amount">Amount</option><option value="method">Method</option><option value="allocations">Job allocations</option></>}
        </select></label><button className="secondary" onClick={()=>{const sorting=page==='Jobs'?jobSorting:paymentSorting;sorting.toggle(sorting.key);}}>{(page==='Jobs'?jobSorting:paymentSorting).direction==='asc'?'Ascending ↑':'Descending ↓'}</button><input aria-label={`Search ${page.toLowerCase()}`} placeholder={`Search ${page.toLowerCase()}.`} value={query} onChange={e => setQuery(e.target.value)} />
          <button disabled={!ready || busy || !ledger.customers.length} onClick={() => {
            setMessage(''); if (page === 'Payments') openPayment(); else setForm('job');
          }}>+ {page === 'Jobs' ? 'New job' : 'Record payment'}</button></div>
          {!ready ? <div className="empty">Loading saved records.</div> : page === 'Jobs' ? <>
            {!ledger.jobs.length ? <div className="empty"><div className="empty-icon">?</div><h2>Your jobs start here</h2><p>Add a customer, create their job, then record payments against it.</p>
              {!ledger.customers.length && <button onClick={() => setForm('customer')}>Add your first customer</button>}</div> : <div className="table-wrap"><table><thead><tr><SortHeader label="Job / service" column="description" sort={jobSorting}/><SortHeader label="Customer" column="customer" sort={jobSorting}/><SortHeader label="Job amount" column="amount" sort={jobSorting}/><SortHeader label="Paid" column="paid" sort={jobSorting}/><SortHeader label="Outstanding" column="outstanding" sort={jobSorting}/><SortHeader label="Status" column="status" sort={jobSorting}/></tr></thead><tbody>
                {matchingJobs.map(job => { const balance = jobBalance(ledger, job); return <tr key={job.id}>
                  <td><button className="text-button" onClick={() => setSelectedJob(job.id)}>{job.description}</button><small>{job.service} � #{shortId(job.id)}</small></td>
                  <td>{customerName(job.customerId)}</td><td>{currency(job.amount)}</td><td>{currency(balance.paid)}</td><td>{currency(balance.outstanding)}</td><td><span className={`badge ${balance.status === 'Fully paid' ? 'paid' : balance.status === 'Unpaid' ? 'unpaid' : 'partial'}`}>{balance.status}</span></td>
                </tr>; })}</tbody></table>{!matchingJobs.length && <p className="empty">No matching jobs.</p>}</div>}</>
          : <>{!ledger.payments.length ? <div className="empty"><h2>A clear payment trail</h2><p>Payments appear here with the jobs they cover.</p></div> : <div className="table-wrap"><table><thead><tr><SortHeader label="Payment" column="id" sort={paymentSorting}/><SortHeader label="Customer" column="customer" sort={paymentSorting}/><SortHeader label="Amount" column="amount" sort={paymentSorting}/><SortHeader label="Method" column="method" sort={paymentSorting}/><SortHeader label="Job allocations" column="allocations" sort={paymentSorting}/></tr></thead><tbody>
            {matchingPayments.map(payment => <tr key={payment.id}>
              <td>#{shortId(payment.id)}<small>{dateLabel(payment.paidOn)}{payment.reference && ` � ${payment.reference}`}</small></td><td>{customerName(payment.customerId)}</td><td>{currency(payment.amount)}</td><td>{payment.method}</td>
              <td>{payment.allocations.map(allocation => <small key={allocation.jobId}>{ledger.jobs.find(job => job.id === allocation.jobId)?.description} - {currency(allocation.amount)}</small>)}</td></tr>)}</tbody></table></div>}</>}
        </section>
        </>}
        <p className="footnote">{demo ? 'Local trial � This device only � No cloud uploads' : `Last synced: ${state.lastSynced ? new Date(state.lastSynced).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : 'Not yet synced'}`} � Currency: NGN</p>
      </>}
      {currentJob && <Modal title={currentJob.description} wide busy={busy} onClose={() => setSelectedJob(null)}><span className="eyebrow">JOB #{shortId(currentJob.id)}</span><p>{customerName(currentJob.customerId)} · {currentJob.service}</p>
        <div className="detail-summary"><span>Job amount <strong>{currency(currentJob.amount)}</strong></span><span>Paid <strong>{currency(jobBalance(ledger, currentJob).paid)}</strong></span><span>Outstanding <strong>{currency(jobBalance(ledger, currentJob).outstanding)}</strong></span></div>
        <h3>Payment history</h3>{ledger.payments.filter(payment => payment.allocations.some(allocation => allocation.jobId === currentJob.id)).map(payment => <div className="history" key={payment.id}>
          <span>{dateLabel(payment.paidOn)} � {payment.method}<small>{payment.reference || `Payment #${shortId(payment.id)}`}</small></span><strong>{currency(payment.allocations.find(allocation => allocation.jobId === currentJob.id)!.amount)}</strong></div>)}
        {!ledger.payments.some(payment => payment.allocations.some(allocation => allocation.jobId === currentJob.id)) && <p className="muted">No payments recorded yet.</p>}
        <button disabled={busy || jobBalance(ledger, currentJob).outstanding <= 0} onClick={() => openPayment(currentJob.customerId, currentJob.id)}>Record payment for this job</button>
      </Modal>}
      {form === 'customer' && <CustomerEditor customers={ledger.customers} busy={busy} actor={{id:demo?'local-trial':session!.user.id,label:demo?'Local trial user':session!.user.user_metadata.full_name||session!.user.email||session!.user.id}} onSave={saveCatalogue} onClose={()=>setForm(null)} />}
      {form && form !== 'customer' && <Modal title={form === 'job' ? 'Create a job' : 'Record a payment'} wide={form === 'payment'} busy={busy} onClose={() => setForm(null)}>
        {message && <div className="notice" role="status">{message}</div>}
        <form onSubmit={submit} key={form}>
          {form === 'job' ? <div className="form-grid"><label>Customer<select name="customer" required defaultValue=""><option value="" disabled>Select customer</option>{ledger.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>Service<input name="service" placeholder="e.g. Banner printing" maxLength={160} required /></label><label>Job description<input name="description" placeholder="e.g. Opening day banner" maxLength={500} required /></label><label>Job amount (?)<input name="amount" inputMode="decimal" type="number" min="0.01" max="1000000000" step="0.01" required /></label></div>
          : <><div className="form-grid"><label>Customer<select required value={paymentCustomer} onChange={e => { setPaymentCustomer(e.target.value); setAllocations({}); }}><option value="" disabled>Select customer</option>{ledger.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>Payment total (?)<input name="amount" inputMode="decimal" type="number" min="0.01" max="1000000000" step="0.01" required /></label><label>Payment method<select name="method"><option>Cash</option><option>POS</option><option>Transfer</option></select></label>
            <label>Payment date<input name="paidOn" type="date" defaultValue={today()} required /></label><label>Reference / note<input name="reference" maxLength={200} placeholder="Optional transfer reference" /></label></div>
            <h3>Allocate this payment</h3><p className="muted">Enter the amount for each job this payment covers.</p>
            {ledger.jobs.filter(job => job.customerId === paymentCustomer && jobBalance(ledger, job).outstanding > 0).map(job => <label className="allocation" key={job.id}>
              <span><strong>{job.description}</strong><small>{job.service} � Outstanding: {currency(jobBalance(ledger, job).outstanding)}</small></span>
              <input aria-label={`Amount for ${job.description}`} type="number" inputMode="decimal" min="0" step="0.01" max={jobBalance(ledger, job).outstanding / 100} placeholder="?0.00" value={allocations[job.id] ?? ''} onChange={e => setAllocations({ ...allocations, [job.id]: e.target.value })} /></label>)}
            {paymentCustomer && !ledger.jobs.some(job => job.customerId === paymentCustomer && jobBalance(ledger, job).outstanding > 0) && <p>This customer has no outstanding jobs.</p>}
            <div className="allocation-total">Total allocated <strong>{currency(allocated)}</strong></div></>}
          <button type="submit" disabled={busy}>{busy ? 'Saving.' : form === 'payment' ? 'Save payment & allocations' : 'Save record'}</button>
        </form>
      </Modal>}
    </main>
  </div>;
}
