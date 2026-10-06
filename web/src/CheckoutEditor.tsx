import CurrencyInput from './CurrencyInput';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { rebalanceManualAllocations } from './manual-allocation.mjs';
import Icon from './Icon';
import CustomerEditor from './CustomerEditor';
import { prepareCheckout, quoteLine, paymentPlan, walletBalance, unpaidJobs, jobSources } from './checkout.mjs';
import { applyCustomerEvent } from './customers.mjs';
import { money, jobBalance, customerBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import type { Ledger, CustomerEvent, CheckoutEvent, CheckoutRecord } from './types';
type Props={ledger:Ledger;actor:{id:string;label:string};busy:boolean;paymentOnly?:boolean;initialCustomer?:string;initialCheckout?:CheckoutRecord;onSave:(event:CheckoutEvent)=>Promise<CheckoutRecord>;onClose:()=>void;onReceipt:(record:CheckoutRecord)=>void};
type ManualAllocationState={amounts:Record<string,string>;editedOrder:string[]};
function balanceDraft(state:ManualAllocationState,limits:Record<string,number>,budget:number,editedId:string|null=null,value?:string):ManualAllocationState{
 const draft=editedId?{...state.amounts,[editedId]:value??''}:state.amounts;
 const numbers=Object.fromEntries(Object.keys(limits).map(id=>[id,money(draft[id]||'0')]));
 const balanced=rebalanceManualAllocations(numbers,limits,budget,state.editedOrder,editedId);
 const amounts:Record<string,string>=Object.fromEntries(Object.entries(balanced.amounts).map(([id,n])=>[id,n===numbers[id]?(draft[id]??''):(Number(n)/100).toFixed(2)]));
 const next={amounts,editedOrder:balanced.editedOrder};
 return JSON.stringify(next)===JSON.stringify(state)?state:next;
}
type CartLine={id:string;serviceId:string;description:string;quantity:string;width:string;height:string;source:string;sourceNote:string};
const line=():CartLine=>({id:crypto.randomUUID(),serviceId:'',description:'',quantity:'1',width:'',height:'',source:'In shop / USB',sourceNote:''});
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'});
export default function CheckoutEditor({ledger,actor,busy,paymentOnly=false,initialCustomer='',initialCheckout,onSave,onClose,onReceipt}:Props){
 const [lines,setLines]=useState<CartLine[]>(()=>initialCheckout?initialCheckout.jobs.map(j=>({...line(),...j,quantity:String(j.quantity),width:j.width==null?'':String(j.width),height:j.height==null?'':String(j.height),source:j.source??'In shop / USB',sourceNote:j.sourceNote??''})):paymentOnly?[]:[line()]);
 const [customerOpen,setCustomerOpen]=useState(false);
 const [customerId,setCustomerId]=useState(initialCheckout?.customerId??initialCustomer);
 const [query,setQuery]=useState(ledger.customers.find(c=>c.id===(initialCheckout?.customerId??initialCustomer))?.name??'');
 const [suggest,setSuggest]=useState(false),[active,setActive]=useState(0),[addingCustomer,setAddingCustomer]=useState(false);
 const [newCustomer,setNewCustomer]=useState<CustomerEvent|null>(initialCheckout?.newCustomer??null);
 const [cashOverride,setCashOverride]=useState<string|null>(initialCheckout?(initialCheckout.cashReceived/100).toFixed(2):null);
 const [useWallet,setUseWallet]=useState(initialCheckout?.useWallet??true),[manual,setManual]=useState(!!initialCheckout?.override);
 const [manualAllocations,setManualAllocations]=useState<ManualAllocationState>(()=>({amounts:Object.fromEntries((initialCheckout?.override??[]).map(a=>[a.jobId,(a.amount/100).toFixed(2)])),editedOrder:[]}));
 const allocations=manualAllocations.amounts;
 const [method,setMethod]=useState(initialCheckout?.method??'Cash'),[paidOn,setPaidOn]=useState(initialCheckout?.paidOn??today()),[reference,setReference]=useState(initialCheckout?.reference??''),[error,setError]=useState('');
 const working:Ledger=newCustomer&&!ledger.customers.some(c=>c.id===newCustomer.data.id)?applyCustomerEvent(ledger,newCustomer):ledger;
 const customer=working.customers.find(c=>c.id===customerId&&!c.archived);
 const matches=working.customers.filter(c=>!c.archived&&`${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase())).slice(0,8);
 const choose=(id:string,name:string)=>{if(!initialCheckout&&id!==customerId)setCashOverride(null);setCustomerId(id);setNewCustomer(current=>current&&current.data.id!==id?null:current);setQuery(name);setSuggest(false);setCustomerOpen(false);setManual(false);setManualAllocations({amounts:{},editedOrder:[]});};
 const editLine=(id:string,key:string,value:string)=>setLines(items=>items.map(item=>item.id===id?{...item,[key]:value}:item));
 const quotedLines=lines.map(item=>{try{return quoteLine(working,item);}catch{return null;}});
 const cartReady=quotedLines.every(item=>item!==null);
 const cartTotal=cartReady?quotedLines.reduce((sum,item)=>sum+item!.amount,0):null;
 const jobs=cartReady?[...working.jobs,...quotedLines.filter(item=>item&&!working.jobs.some(job=>job.id===item.id)).map((item,index)=>({...item!,customerId,createdAt:initialCheckout?.createdAt??new Date().toISOString(),checkoutPosition:index}))]:working.jobs;
 const paymentLedger={...working,jobs};
 const previousBalance=customer?customerBalance(working,customer.id):0;
 const availableWallet=customer&&useWallet?walletBalance(working,customer.id):0;
 const recommended=cartTotal===null?null:Math.max(0,cartTotal+previousBalance-availableWallet);
 const cash=cashOverride??((recommended??0)/100).toFixed(2);
 let preview:CheckoutEvent|null=null,previewError='';
 try{if(customer)preview=prepareCheckout(ledger,{customerId,newCustomer,lines,cashReceived:money(cash||'0'),useWallet,override:manual?Object.entries(allocations).filter(([,n])=>money(n||'0')>0).map(([jobId,n])=>({jobId,amount:money(n)})):null,method,paidOn,reference},actor,'preview',initialCheckout?.createdAt??new Date().toISOString()) as CheckoutEvent;}catch(cause){previewError=cause instanceof Error?cause.message:String(cause);}
 const outstanding=customer?unpaidJobs(paymentLedger,customer.id):[];
 function override(){try{const plan=paymentPlan(paymentLedger,customerId,money(cash||'0'),useWallet);setManualAllocations({amounts:Object.fromEntries(plan.allocations.map((a:{jobId:string;amount:number})=>[a.jobId,(a.amount/100).toFixed(2)])),editedOrder:[]});setManual(true);}catch(cause){setError(String(cause));}}
 const limits:Record<string,number>=Object.fromEntries(outstanding.map((job:{id:string})=>[job.id,jobBalance(paymentLedger,job).outstanding]));
 const limitsKey=JSON.stringify(limits);
 let allocationBudget:number|null=null;
 try{const funds=money(cash||'0')+(useWallet&&customer?walletBalance(working,customer.id):0);if(customer&&cartReady&&Number.isSafeInteger(funds)&&funds>=0)allocationBudget=funds;}catch{}
 useEffect(()=>{if(busy||!manual||allocationBudget===null)return;const currentLimits=JSON.parse(limitsKey) as Record<string,number>;setManualAllocations(state=>{try{return balanceDraft(state,currentLimits,allocationBudget);}catch{return state;}});},[busy,manual,allocationBudget,limitsKey]);
 function editAllocation(jobId:string,value:string){
  setManualAllocations(state=>{try{if(allocationBudget!==null)return balanceDraft(state,limits,allocationBudget,jobId,value);}catch{}
   return {amounts:{...state.amounts,[jobId]:value},editedOrder:[...state.editedOrder.filter(id=>id!==jobId),jobId]};
  });
 }
 const shortage=preview?.data.jobs.reduce((s:Record<string,number>,j)=>({...s,[j.materialId]:(s[j.materialId]??0)+j.materialNeeded}),{});
 return <>
 <Modal title={initialCheckout?'Review pending checkout':paymentOnly?'Receive payment':'New checkout'} wide busy={busy} onClose={onClose}>
 {initialCheckout&&<p className="notice">This checkout is already saved on this device. Keep the money received as originally collected; do not collect it again. Review updated prices, wallet credit and allocations before confirming. An earlier pending receipt will be replaced.</p>}
 {error&&<p className="notice" role="alert">{error}</p>}
 <form onSubmit={async e=>{e.preventDefault();if(busy)return;setError('');try{if(!preview){if(!customer)setCustomerOpen(true);throw Error(previewError||'Select a customer.');}const event=prepareCheckout(ledger,{customerId,newCustomer,lines,cashReceived:money(cash||'0'),useWallet,override:manual?Object.entries(allocations).filter(([,n])=>money(n||'0')>0).map(([jobId,n])=>({jobId,amount:money(n)})):null,method,paidOn,reference},actor,String(crypto.randomUUID()),initialCheckout?.createdAt??new Date().toISOString()) as CheckoutEvent;const record=await onSave(event);onClose();onReceipt(record);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}}>
 <fieldset disabled={busy}>
 {!paymentOnly&&<><h3>Jobs in this checkout</h3>{lines.map((item,index)=>{const service=working.services.find(s=>s.id===item.serviceId),material=working.materials.find(m=>m.id===service?.materialId);const quote=quotedLines[index];return <section className="cart-line" key={item.id}><div className="cart-line-title"><strong>Job {index+1}</strong>{lines.length>1&&<button type="button" className="text-button danger-text" onClick={()=>setLines(v=>v.filter(j=>j.id!==item.id))}>Remove job</button>}</div><div className="form-grid">
 <label>Service<select aria-label="Service" required value={item.serviceId} onChange={e=>editLine(item.id,'serviceId',e.target.value)}><option value="">Select service</option>{working.services.filter(s=>!s.archived&&working.materials.some(m=>m.id===s.materialId&&!m.archived)).map(s=><option key={s.id} value={s.id}>{s.description} — {currency(s.price)}</option>)}</select></label>
 <label>Job description<input required maxLength={500} value={item.description} onChange={e=>editLine(item.id,'description',e.target.value)}/></label>
 <label>Quantity<input type="number" min="0.001" max="1000000" step="0.001" required value={item.quantity} onChange={e=>editLine(item.id,'quantity',e.target.value)}/></label>
 {material?.requireSize&&<><label>Width<input type="number" min="0.001" step="0.001" max="1000000" required value={item.width} onChange={e=>editLine(item.id,'width',e.target.value)}/></label><label>Height<input type="number" min="0.001" step="0.001" max="1000000" required value={item.height} onChange={e=>editLine(item.id,'height',e.target.value)}/></label></>}
 <label>Job received through<select value={item.source} onChange={e=>editLine(item.id,'source',e.target.value)}>{jobSources.map(s=><option key={s}>{s}</option>)}</select></label><label>Source details<input maxLength={200} placeholder="Optional sender, device or reference" value={item.sourceNote} onChange={e=>editLine(item.id,'sourceNote',e.target.value)}/></label></div>
 {quote&&<p>Material: {material?.name} · Usage: {quote.materialNeeded} {quote.measurementUnit} · <strong>{currency(quote.amount)}</strong></p>}</section>;})}<button type="button" className="secondary" disabled={lines.length>=50} onClick={()=>setLines(v=>[...v,line()])}><Icon name="add"/> Add another service</button><p className="cart-total" aria-live="polite"><strong>Total: {cartTotal===null?'—':currency(cartTotal)}</strong>{cartTotal===null&&<small>Complete all job details to calculate the total.</small>}</p></>}
 <section className="checkout-customer"><button type="button" className="secondary customer-section-toggle" aria-expanded={customerOpen} aria-controls="checkout-customer-fields" onClick={()=>{setCustomerOpen(open=>!open);setSuggest(false);}}><Icon name="customers"/> Customer <span>{customer ? `${customer.name} · ${customer.phone}` : 'Select or add a customer'}</span><span aria-hidden="true">{customerOpen?'▴':'▾'}</span></button>
 {customerOpen&&<div id="checkout-customer-fields"> <div className="customer-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setSuggest(false);}}><label>Customer name or phone<input role="combobox" aria-expanded={suggest} aria-controls="customer-matches" aria-autocomplete="list" aria-activedescendant={suggest&&matches[active]?`customer-option-${active}`:undefined} value={query} autoComplete="off" onChange={e=>{setQuery(e.target.value);setCustomerId('');setSuggest(!!e.target.value.trim());setActive(0);setManual(false);setManualAllocations({amounts:{},editedOrder:[]});}} onKeyDown={e=>{if(e.key==='ArrowDown'&&suggest){e.preventDefault();setActive(n=>Math.min(n+1,matches.length-1));}else if(e.key==='ArrowUp'&&suggest){e.preventDefault();setActive(n=>Math.max(0,n-1));}else if(e.key==='Enter'&&suggest&&matches[active]){e.preventDefault();choose(matches[active].id,matches[active].name);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setSuggest(false);}}}/></label>
 {suggest&&<div id="customer-matches" role="listbox" aria-label="Customer suggestions">{matches.map((c,index)=><button key={c.id} id={`customer-option-${index}`} type="button" role="option" aria-selected={index===active} onClick={()=>choose(c.id,c.name)}><strong>{c.name}</strong> <span>{c.phone||'No phone recorded'}</span></button>)}{!matches.length&&<p>No matching customer.</p>}</div>}
 <button type="button" className="secondary" onClick={()=>{setSuggest(false);setAddingCustomer(true);}}><Icon name="add"/> Add new customer</button></div>
 {customer&&<p className="muted">{customer.phone} · Wallet: {currency(walletBalance(working,customer.id))}</p>}
</div>}</section>
 <h3>Payment</h3><div className="form-grid"><label>Money received (₦)<CurrencyInput required value={cash} onValueChange={setCashOverride}/></label><label>Payment method<select value={method} onChange={e=>setMethod(e.target.value)}><option>Cash</option><option>POS</option><option>Transfer</option></select></label><label>Payment date<input type="date" required value={paidOn} onChange={e=>setPaidOn(e.target.value)}/></label><label>Reference / note<input maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label></div>
 {!initialCheckout&&recommended!==null&&<div className="payment-recommendation"><p>Recommended payment: <strong>{currency(recommended)}</strong><small>New jobs {currency(cartTotal??0)} + previous unpaid balance {currency(previousBalance)} − wallet credit {currency(Math.min(Math.max(0,availableWallet),(cartTotal??0)+previousBalance))}</small></p>{cashOverride!==null&&<button type="button" className="secondary" onClick={()=>setCashOverride(null)}>Use recommended amount</button>}</div>}
 <label className="check-label"><input type="checkbox" checked={useWallet} onChange={e=>setUseWallet(e.target.checked)}/> Use available wallet credit when needed</label>
 <div className="allocation-heading"><h3>Job allocations</h3><button type="button" className="secondary" onClick={()=>manual?setManual(false):override()}>{manual?'Use automatic allocation':'Override allocation'}</button></div><p className="muted">{manual?'Your latest edit takes priority. When allocations exceed the available money, earlier-edited allocations reduce first. Each allocation stays within the job’s outstanding balance.':'Automatic allocation pays the oldest unpaid jobs first, including earlier orders.'}</p>{manual&&allocationBudget!==null&&<p className="muted">Available to allocate: {currency(Math.min(allocationBudget,Object.values(limits).reduce((sum,n)=>sum+n,0)))}</p>}
 {outstanding.map((job:{id:string;description:string})=><div className="allocation" key={job.id}><span>{job.description}<small>Job #{job.id.slice(0,8).toUpperCase()} · Outstanding {currency(jobBalance(paymentLedger,job).outstanding)}</small></span>{manual?<CurrencyInput aria-label={`Allocate to ${job.description}`} max={jobBalance(paymentLedger,job).outstanding/100} value={allocations[job.id]??''} onValueChange={value=>editAllocation(job.id,value)}/>:<strong>{currency(preview?.data.allocations.find(a=>a.jobId===job.id)?.amount??0)}</strong>}</div>)}
 {preview&&<div className="checkout-summary"><p>New jobs <strong>{currency(preview.data.total)}</strong></p><p>Wallet used <strong>{currency(preview.data.walletUsed)}</strong></p><p>Added to wallet <strong>{currency(preview.data.walletAdded)}</strong></p><p>Wallet after checkout <strong>{currency(preview.data.walletAfter)}</strong></p><p>Customer outstanding <strong>{currency(preview.data.outstandingAfter)}</strong></p></div>}
 {preview&&customer&&preview.data.outstandingAfter>customer.creditLimit&&<p className="notice" role="status">Credit limit exceeded by {currency(preview.data.outstandingAfter-customer.creditLimit)}. You can still save this order.</p>}
 {shortage&&working.materials.filter(m=>m.available-(shortage[m.id]??0)<0&&(shortage[m.id]??0)>0).map(m=><p className="notice" key={m.id}>Stock warning: {m.name} will have {Math.round((m.available-shortage[m.id])*1000)/1000} {m.measurementUnit}. Saving is allowed; later restocking adds to this balance.</p>)}
 {previewError&&customer&&<p className="muted">{previewError}</p>}
 <button type="submit"><Icon name="save"/> {busy?'Saving…':'Complete checkout'}</button></fieldset></form></Modal>
 {addingCustomer&&<CustomerEditor customers={working.customers} actor={actor} busy={busy} onClose={()=>setAddingCustomer(false)} onSave={async event=>{if(event.kind!=='customer.created')throw Error('Add a new customer.');setNewCustomer(event);choose(event.data.id,event.data.name!);}}/>}
 </>;
}
