import {useMemo,useState} from 'react';
import {dashboardRange,dashboardSummary,validRange} from './dashboard.mjs';
import type {Ledger,Material} from './types';
import './dashboard.css';
const money=(value:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(value/100);
const change=(value:number,previous:number)=>previous===0?(value===0?'No change':'No previous value to compare'):`${value>=previous?'+':''}${((value-previous)/Math.abs(previous)*100).toFixed(1)}% vs previous period`;
type Access={sales:boolean;payments:boolean;expenses:boolean;materials:boolean};
function Trend({rows,sales,payments}:{rows:{date:string;sales:number;collected:number}[];sales:boolean;payments:boolean}){
 const values=rows.flatMap(r=>[...(sales?[r.sales]:[]),...(payments?[r.collected]:[])]),max=Math.max(1,...values),min=Math.min(0,...values),y=(n:number)=>190-(n-min)/(max-min)*165,zero=y(0),width=620/Math.max(1,rows.length);
 return <><div className="dashboard-legend">{sales&&<span><i className="sales-key"/>Sales value</span>}{payments&&<span><i className="collections-key"/>Net collected</span>}</div><svg className="dashboard-chart" viewBox="0 0 700 230" role="img" aria-label="Sales value and net money collected by date. Exact amounts are in the trend data table.">
 <line x1="45" x2="675" y1={zero} y2={zero} stroke="currentColor" opacity=".35"/>
 {rows.map((r,i)=><g key={r.date}>{(sales?[{value:r.sales,color:'var(--brand-primary)',offset:0}]:[]).concat(payments?[{value:r.collected,color:'var(--brand-accent)',offset:sales?1:0}]:[]).map(b=><rect key={b.offset} x={50+i*width+b.offset*width*.4} y={Math.min(zero,y(b.value))} width={Math.max(1,width*.35)} height={Math.abs(y(b.value)-zero)} fill={b.color}><title>{r.date}: {money(b.value)}</title></rect>)}{(i%Math.max(1,Math.ceil(rows.length/6))===0||i===rows.length-1)&&<text x={50+i*width} y="220" fontSize="10" fill="currentColor">{r.date.slice(5)}</text>}</g>)}
 </svg><details><summary>View exact trend amounts</summary><div className="table-wrap"><table><thead><tr><th>Date</th>{sales&&<th>Sales value</th>}{payments&&<th>Net collected</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.date}><td>{r.date}</td>{sales&&<td>{money(r.sales)}</td>}{payments&&<td>{money(r.collected)}</td>}</tr>)}</tbody></table></div></details></>;
}
export default function DashboardPage({ledger,ready,online,pending,lastSynced,access}:{ledger:Ledger;ready:boolean;online:boolean;pending:number;lastSynced?:string;access:Access}){
 const [preset,setPreset]=useState('month'),[range,setRange]=useState(()=>dashboardRange('month'));
 const valid=validRange(range.from,range.to);
 const summary=useMemo(()=>valid?dashboardSummary(ledger,range.from,range.to):null,[ledger,range.from,range.to,valid]);
 if(!ready)return <section className="panel empty" role="status">Loading dashboard records…</section>;
 const card=(label:string,value:number,note:string,comparison?:string)=><article key={label}><span>{label}</span><strong>{money(value)}</strong><small>{note}</small>{comparison&&<small>{comparison}</small>}</article>;
 return <div className="dashboard"><section className="panel dashboard-filters"><label>Period<select value={preset} onChange={e=>{const value=e.target.value;setPreset(value);if(value!=='custom')setRange(dashboardRange(value));}}><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="30days">Last 30 days</option><option value="custom">Custom dates</option></select></label><label>From<input type="date" value={range.from} onChange={e=>{setPreset('custom');setRange({...range,from:e.target.value});}}/></label><label>To<input type="date" value={range.to} onChange={e=>{setPreset('custom');setRange({...range,to:e.target.value});}}/></label><small>Dates use Africa/Lagos.</small></section>
 {!online||pending>0?<div className="dashboard-warning" role="status">{!online?'Offline — showing saved device records. ':''}{pending>0?`${pending} pending changes are included; totals may change after synchronization. `:''}Other devices’ unsynced work is not included.</div>:<p className="dashboard-freshness">Showing the records available on this device.{lastSynced&&` Last synced: ${new Date(lastSynced).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})}.`}</p>}
 {!valid||!summary?<div className="dashboard-warning" role="alert">Choose valid From and To dates, in order, spanning no more than ten years.</div>:<>
 <h2>Selected period</h2><p>Sales use job creation dates and current corrected values. Collections use payment dates, not job dates.</p>
 <section className="stats dashboard-stats" aria-label="Period summary">
 {access.sales&&card('Sales value',summary.sales,`${summary.jobs} jobs · ${summary.cancelled} cancelled`,change(summary.sales,summary.previous.sales))}
 {access.payments&&card('Net collected',summary.netCollected,`${money(summary.collected)} received − ${money(summary.refunded)} refunded`,change(summary.netCollected,summary.previous.netCollected))}
 {access.expenses&&card('Expenses incurred',summary.expenseIncurred,'Expenses dated in this period; voided records excluded')}
 {access.expenses&&card('Expenses paid',summary.expensePaid,'Recorded payments, including older or voided expenses')}
 {access.payments&&access.expenses&&card('Collections less expense payments',summary.netCashFlow,'All payment funding sources included. Not profit or a bank balance.')}
 </section>
 {(access.sales||access.payments)&&<section className="panel dashboard-panel"><h2>{summary.monthly?'Monthly':'Daily'} trend</h2><Trend rows={summary.trend} sales={access.sales} payments={access.payments}/><small>Comparison period: {summary.previous.from} to {summary.previous.to}. Corrections revise the original sale/payment figures.</small></section>}
 <h2>Current position</h2><p>These balances and stock figures cover all dates, not only the selected period.</p><section className="stats dashboard-stats" aria-label="Current balances">
 {access.sales&&access.payments&&card('Outstanding from customers',summary.outstanding,`${summary.outstandingJobs} jobs awaiting payment`)}
 {access.expenses&&card('Unpaid expenses',summary.expenseOutstanding,'Current remaining expense balances')}
 </section><div className="dashboard-grid">
 {access.sales&&<section className="panel dashboard-panel"><h2>Top services</h2><small>By selected-period sales value</small>{summary.services.length?summary.services.map(s=><div className="dashboard-row" key={s.name}><span>{s.name}<small>{s.jobs} jobs</small></span><strong>{money(s.sales)}</strong></div>):<p>No sales in this period.</p>}</section>}
 {access.payments&&<section className="panel dashboard-panel"><h2>Payment methods</h2><small>Selected-period collections less refunds</small>{summary.methods.length?summary.methods.map(m=><div className="dashboard-row" key={m.name}><span>{m.name}</span><strong>{money(m.amount)}</strong></div>):<p>No collections or refunds in this period.</p>}</section>}
 {access.sales&&<section className="panel dashboard-panel"><h2>Job stages</h2><small>All current jobs</small>{summary.stages.length?summary.stages.map(s=><div className="dashboard-row" key={s.name}><span>{s.name}</span><strong>{s.count}</strong></div>):<p>No jobs yet.</p>}</section>}
 {access.materials&&<section className="panel dashboard-panel"><h2>Stock alerts</h2><small>Active materials at zero or below.</small>{summary.stockAlerts.length?<div className="dashboard-warning" role="status">{summary.stockAlerts.map((m:Material)=><div className="dashboard-row" key={m.id}><span>{m.name}<small>ID: {m.id.slice(0,8).toUpperCase()}</small></span><strong>{m.available} {m.measurementUnit}</strong></div>)}</div>:<p>No materials at zero or below.</p>}</section>}
 </div>{!Object.values(access).some(Boolean)&&<section className="panel empty">No summary sections are available under your current page permissions.</section>}
 </>}
 </div>;
}
