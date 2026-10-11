import {useMemo,useState} from 'react';
import ResponsiveTable from './ResponsiveTable';
import {dashboardRange,validRange} from './dashboard.mjs';
import {customerStatement,statementSections,reportFileName} from './reports.mjs';
import {customerCode} from './customers.mjs';
import {currency} from './receipts.mjs';
import {downloadCsv} from './export-csv';
import type {Branding} from './useBusinessBranding';
import type {Ledger} from './types';
import './dashboard.css';
import './reports.css';

type Props={ledger:Ledger;ready:boolean;online:boolean;pending:number;lastSynced?:string;branding:Branding;businessName:string;customerId:string;onCustomerChange:(id:string)=>void};
type Tab='Customer statement'|'Transactions'|'Summary';
type StatementJob={id:string;ref:string;date:string;service:string;description:string;stage:string;amount:number;paid:number;outstanding:number;status:string};
type StatementPayment={id:string;ref:string;date:string;method:string;reference:string;refund:boolean;received:number;creditUsed:number;creditAdded:number;jobsPaid:{job:string;amount:number}[]};
type StatementAdjustment={id:string;ref:string;date:string;action:string;job:string;chargeBefore:number;chargeAfter:number;refund:number;reason:string;approvedBy:string};

const jobWidths=[9,8,12,24,9,10,10,10,10];
const pdfLayout={
 widths:{'Account summary':[2,3],'Jobs in this period':jobWidths,'Earlier jobs still owing':jobWidths,'Later jobs still owing':jobWidths,
  'Payments in this period':[9,9,12,12,11,10,10,27],'Corrections and refunds in this period':[9,9,12,16,10,10,10,15,10]},
 numeric:{'Jobs in this period':[5,6,7],'Earlier jobs still owing':[5,6,7],'Later jobs still owing':[5,6,7],'Payments in this period':[4,5,6],'Corrections and refunds in this period':[4,5,6]}
};

function JobTable({jobs,label}:{jobs:StatementJob[];label:string}){
 if(!jobs.length)return <p className="muted">No jobs.</p>;
 return <div className="table-wrap"><ResponsiveTable columns={[{index:1,label:'Job'},{index:4,label:'Amount',details:[5]},{index:6,label:'Outstanding'}]}><table aria-label={label}><thead><tr><th>Date</th><th>Job</th><th>Service</th><th>Stage</th><th>Amount</th><th>Paid</th><th>Outstanding</th></tr></thead>
  <tbody>{jobs.map(j=><tr key={j.id}><td>{j.date}</td><td>{j.description}<small>{j.ref}</small></td><td>{j.service}</td><td>{j.stage}</td><td>{currency(j.amount)}</td><td>{currency(j.paid)}</td><td>{currency(j.outstanding)}<small>{j.status}</small></td></tr>)}</tbody></table></ResponsiveTable></div>;
}

export default function ReportsPage({ledger,ready,online,pending,lastSynced,branding,businessName,customerId,onCustomerChange}:Props){
 const [tab,setTab]=useState<Tab>('Customer statement');
 const [preset,setPreset]=useState('month'),[range,setRange]=useState(()=>dashboardRange('month'));
 const [query,setQuery]=useState(''),[includePaid,setIncludePaid]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const valid=validRange(range.from,range.to);
 const customers=useMemo(()=>[...ledger.customers].sort((a,b)=>a.name.localeCompare(b.name)),[ledger.customers]);
 const matches=customers.filter(c=>c.id===customerId||[c.name,c.phone,customerCode(c.id,ledger.customers)].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 const statement=useMemo(()=>{
  if(!valid||!customerId||!ledger.customers.some(c=>c.id===customerId))return null;
  return customerStatement(ledger,customerId,range.from,range.to,{includePaid});
 },[ledger,customerId,range.from,range.to,valid,includePaid]);
 if(!ready)return <section className="panel empty" role="status">Loading report records…</section>;

 const title='Customer statement';
 const file=statement?reportFileName('Statement',statement.customer.name,`${statement.from} to ${statement.to}`):'';
 const subtitle=statement?[`${statement.customer.name} (${statement.customer.code})${statement.customer.phone?' - '+statement.customer.phone:''}`,`Period: ${statement.from} to ${statement.to}`,'Balances are current as of the generated time, including later payments and corrections.']:[];
 async function exportPdf(){
  if(!statement||busy)return;setBusy(true);setError('');
  try{const {downloadReportPdf}=await import('./report-pdf');downloadReportPdf(file,branding.businessName?branding:businessName,{title,subtitle,sections:statementSections(statement),generatedAt:new Date().toISOString(),...pdfLayout});}
  catch(cause){setError(cause instanceof Error?cause.message:'Could not create the PDF.');}
  finally{setBusy(false);}
 }
 function exportCsv(){
  if(!statement)return;setError('');
  try{downloadCsv(file,[branding.businessName||businessName,title,...subtitle],statementSections(statement));}
  catch(cause){setError(cause instanceof Error?cause.message:'Could not create the spreadsheet.');}
 }
 const t=statement?.totals;
 const card=(label:string,value:number,note?:string)=><article key={label}><span>{label}</span><strong>{currency(value)}</strong>{note&&<small>{note}</small>}</article>;

 return <div className="dashboard reports">
  <div className="settings-tabs" role="tablist" aria-label="Reports">{(['Customer statement','Transactions','Summary'] as Tab[]).map(item=><button key={item} role="tab" aria-selected={tab===item} className={tab===item?'active':'secondary'} tabIndex={tab===item?0:-1} onClick={()=>setTab(item)}>{item}</button>)}</div>
  {tab!=='Customer statement'?<section className="panel empty" role="status">{tab} report is coming in the next release.</section>:<>
  <section className="panel dashboard-filters report-filters">
   <label>Find customer<input type="search" placeholder="Name, phone or customer ID" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label>Customer<select value={customerId} onChange={e=>onCustomerChange(e.target.value)}><option value="">Choose a customer</option>{matches.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?` · ${c.phone}`:''}{c.archived?' (archived)':''}</option>)}</select></label>
   <label>Period<select value={preset} onChange={e=>{const value=e.target.value;setPreset(value);if(value!=='custom')setRange(dashboardRange(value));}}><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="30days">Last 30 days</option><option value="custom">Custom dates</option></select></label>
   <label>From<input type="date" value={range.from} onChange={e=>{setPreset('custom');setRange({...range,from:e.target.value});}}/></label>
   <label>To<input type="date" value={range.to} onChange={e=>{setPreset('custom');setRange({...range,to:e.target.value});}}/></label>
   <label className="checkbox"><input type="checkbox" checked={includePaid} onChange={e=>setIncludePaid(e.target.checked)}/>Show fully paid jobs</label>
   <small>Dates use Africa/Lagos.</small>
  </section>
  {!online||pending>0?<div className="dashboard-warning" role="status">{!online?'Offline — showing saved device records. ':''}{pending>0?`${pending} pending changes are included; figures may change after syncing. `:''}Other devices’ unsynced work is not included.</div>:<p className="dashboard-freshness">Showing the records available on this device.{lastSynced&&` Last synced: ${new Date(lastSynced).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})}.`}</p>}
  {!valid?<div className="dashboard-warning" role="alert">Choose valid From and To dates, in order, spanning no more than ten years.</div>
  :!statement||!t?<section className="panel empty">Choose a customer to see their statement.</section>:<>
   <section className="panel report-header"><div><h2>{statement.customer.name}</h2><p>{statement.customer.code}{statement.customer.phone&&` · ${statement.customer.phone}`}{statement.customer.address&&` · ${statement.customer.address}`}{statement.customer.archived&&' · Archived'}</p><small>Credit limit: {currency(statement.customer.creditLimit)}. Balances are current, including payments and corrections made after the period.</small></div>
    <div className="material-actions"><button disabled={busy} onClick={exportCsv}>Download spreadsheet</button><button className="secondary" disabled={busy} onClick={()=>void exportPdf()}>{busy?'Preparing PDF…':'Save as PDF'}</button></div></section>
   {error&&<p role="alert" className="dashboard-warning">{error}</p>}
   <section className="stats dashboard-stats" aria-label="Statement summary">
    {card('Total owed now',t.owedNow,'All unpaid jobs, any date')}
    {card('Credit balance now',t.creditNow,'Customer money held for future jobs')}
    {card('Jobs charged',t.charged,'Jobs created in this period')}
    {card('Money received',t.received,t.refunded?`${currency(t.refunded)} refunded in this period`:'Payments dated in this period')}
   </section>
   <section className="panel"><h2>Jobs in this period</h2><JobTable jobs={statement.jobs as StatementJob[]} label="Jobs in this period"/></section>
   {statement.earlierOwing.length>0&&<section className="panel"><h2>Earlier jobs still owing</h2><p className="muted">Created before {statement.from}; included so the total owed is fully explained.</p><JobTable jobs={statement.earlierOwing as StatementJob[]} label="Earlier jobs still owing"/></section>}
   {statement.laterOwing.length>0&&<section className="panel"><h2>Later jobs still owing</h2><p className="muted">Created after {statement.to}.</p><JobTable jobs={statement.laterOwing as StatementJob[]} label="Later jobs still owing"/></section>}
   <section className="panel"><h2>Payments in this period</h2>{statement.payments.length?<div className="table-wrap"><ResponsiveTable columns={[{index:0,label:'Payment'},{index:2,label:'Received',details:[3,4]},{index:5,label:'Jobs paid'}]}><table aria-label="Payments in this period"><thead><tr><th>Date / method</th><th>Reference</th><th>Money received</th><th>Credit used</th><th>Credit added</th><th>Jobs paid</th></tr></thead>
    <tbody>{(statement.payments as StatementPayment[]).map(p=><tr key={p.id}><td>{p.date} · {p.method}<small>{p.ref}{p.refund?' · Refund to customer':''}</small></td><td>{p.reference}</td><td>{currency(p.received)}</td><td>{currency(p.creditUsed)}</td><td>{currency(p.creditAdded)}</td><td>{p.jobsPaid.map(a=><small key={a.job}>{a.job}: {currency(a.amount)}</small>)}</td></tr>)}</tbody></table></ResponsiveTable></div>:<p className="muted">No payments in this period.</p>}</section>
   {statement.adjustments.length>0&&<section className="panel"><h2>Corrections and refunds in this period</h2><div className="table-wrap"><ResponsiveTable columns={[{index:0,label:'Adjustment'},{index:2,label:'Charge',details:[3]},{index:4,label:'Reason'}]}><table aria-label="Corrections and refunds"><thead><tr><th>Date / type</th><th>Job</th><th>Charge before → after</th><th>Refunded</th><th>Reason / approved by</th></tr></thead>
    <tbody>{(statement.adjustments as StatementAdjustment[]).map(a=><tr key={a.id}><td>{a.date} · {a.action}<small>{a.ref}</small></td><td>{a.job}</td><td>{currency(a.chargeBefore)} → {currency(a.chargeAfter)}</td><td>{currency(a.refund)}</td><td>{a.reason}<small>{a.approvedBy}</small></td></tr>)}</tbody></table></ResponsiveTable></div></section>}
  </>}
  </>}
 </div>;
}
