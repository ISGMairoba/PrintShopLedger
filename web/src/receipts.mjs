import {paymentName} from './business-options.mjs';
import { escapeHtml } from './print-settings.mjs';
import {receiptBusiness,validLogo} from './business-branding.mjs';
export const currency=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(n/100);
const validMoney=n=>Number.isSafeInteger(n)&&n>=0;
export function balancedReceiptJob(job){return [job.amount,job.paidBefore,job.paidThisCheckout,job.outstandingAfter].every(validMoney)&&job.amount===job.paidBefore+job.paidThisCheckout+job.outstandingAfter;}
export function balancedReceiptTotal(record){return validMoney(record.total)&&(record.jobs??[]).every(job=>validMoney(job.amount))&&record.total===(record.jobs??[]).reduce((sum,job)=>sum+job.amount,0);}
export function receiptIntegrityError(record){
 if((record.jobBalances??[]).some(job=>!balancedReceiptJob(job)))return 'Receipt amounts do not match the saved payment breakdown. Sync and verify this receipt before printing.';
 if(!balancedReceiptTotal(record))return 'Receipt job total does not match its saved jobs. Sync and verify this receipt before printing.';
 return '';
}
const shortRef=id=>String(id??'').slice(0,8).toUpperCase();
const lagos=value=>new Date(value).toLocaleString('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'});
const adjustmentNames={'sale.combined_corrected':'Job and payments corrected','sale.details_corrected':'Job details corrected','payment.corrected':'Payment corrected','sale.corrected':'Sale corrected','sale.cancelled':'Sale cancelled','sale.refunded':'Customer refunded'};

/**
 * Everything a receipt shows, in display order, independent of where it is printed.
 * Amounts that fail the integrity checks are replaced by "Needs verification" and never shown as confirmed.
 */
export function receiptModel(record,business,pending=false,adjustments=[]){
 adjustments=adjustments.filter(item=>!item.groupId||!adjustments.some(parent=>parent.id===item.groupId));
 const b=receiptBusiness(business),c=record.customerSnapshot;
 const balancedTotal=balancedReceiptTotal(record);
 const balances=record.jobBalances??[];
 const allBalanced=balances.every(balancedReceiptJob);
 const items=balances.map(j=>{
  const item=(record.jobs??[]).find(n=>n.id===j.id);
  const ok=balancedReceiptJob(j);
  const details=[item?.quantity!==undefined&&item?.quantity!==null?`Qty ${item.quantity}`:'',item?.requireSize?`Size ${item.width} × ${item.height}`:'',item?.source?`Received: ${item.source}${item.sourceNote?' — '+item.sourceNote:''}`:''].filter(Boolean);
  return {id:j.id,ref:shortRef(j.id),description:j.description,service:j.service,details,quantity:item?.quantity??null,
   amount:ok?currency(j.amount):'Needs verification',paidBefore:ok&&j.paidBefore?currency(j.paidBefore):'',paidNow:currency(j.paidThisCheckout),balance:currency(j.outstandingAfter),ok};
 });
 const totals=[];
 if((record.jobs??[]).length)totals.push({label:'New jobs',value:balancedTotal?currency(record.total):'Needs verification'});
 totals.push({label:`Paid now (${paymentName(record)})`,value:currency(record.cashReceived),strong:true});
 if(record.walletUsed)totals.push({label:'Wallet used',value:currency(record.walletUsed)});
 if(record.walletAdded)totals.push({label:'Added to wallet',value:currency(record.walletAdded)});
 if(balances.length&&allBalanced)totals.push({label:'Balance on these jobs',value:currency(balances.reduce((n,j)=>n+j.outstandingAfter,0)),strong:true});
 const account=[{label:'Customer outstanding',value:currency(record.outstandingAfter)},{label:'Wallet balance',value:currency(record.walletAfter)}];
 const notices=[];
 if(record.corrected)notices.push('Corrected receipt — current job and payment balances');else if(adjustments.length)notices.push('Original receipt — later adjustments listed below');
 if(pending)notices.push('Pending confirmation — saved on this device');
 const contacts=b.receipt.showContacts?[b.phones,b.email,b.website,b.socials].filter(Boolean):[];
 return {
  business:{name:b.businessName,logo:b.receipt.showLogo&&b.logo&&validLogo(b.logo)?b.logo:'',address:b.receipt.showAddress?b.address:'',contacts,primary:b.primary||'#124b40',accent:b.accent||'#d9a126'},
  title:record.corrected?'Corrected receipt':'Receipt',number:shortRef(record.id),date:lagos(record.createdAt),paidOn:record.paidOn,
  customer:{name:c?.name??record.customerId,phone:c?.phone??''},cashier:record.createdByLabel,method:paymentName(record),
  notices,items,totals,account,note:record.reference||'',
  adjustments:adjustments.map(a=>({ref:shortRef(a.id),label:adjustmentNames[a.action]??a.action.replace('sale.',''),job:shortRef(a.jobId),
   lines:[`Charge: ${currency(a.before.amount)} → ${currency(a.after.amount)}`,
    `Quantity: ${a.before.quantity??'—'} → ${a.after.quantity??'—'}`,`Size: ${a.before.width??'—'} × ${a.before.height??'—'} → ${a.after.width??'—'} × ${a.after.height??'—'}`,`Service: ${a.before.service} → ${a.after.service}`,
    ...a.paymentChanges.map(p=>`Payment: ${p.before.methodLabel??p.before.method} ${currency(p.before.amount)} → ${p.after.methodLabel??p.after.method} ${currency(p.after.amount)}`),
    `Credit released: ${currency(a.creditReleased)}`,`Money refunded: ${currency(a.refundAmount)}${a.refundAmount?` (${a.methodLabel??a.method})`:''}`,`Material returned: ${a.returnQuantity}`,`Reason: ${a.reason}`,`Approved by: ${a.changedByLabel} · ${lagos(a.changedAt)}`]})),
  footer:b.receipt.footer||''
 };
}

const safeColour=value=>/^#[0-9a-f]{6}$/i.test(value)?value:'#124b40';
/**
 * Receipt markup. layout 'narrow' suits 80mm/58mm receipt printers (monochrome, single column);
 * 'wide' suits full pages and the screen. Styles are scoped and use tables, which every
 * print renderer (including QZ Tray's) lays out reliably. All values are escaped.
 */
export function receiptHtml(record,business,pending=false,adjustments=[],{layout='wide'}={}){
 const m=receiptModel(record,business,pending,adjustments),e=escapeHtml;
 const brand=safeColour(m.business.primary);
 const row=(label,value,cls='')=>`<tr class="${cls}"><td>${e(label)}</td><td class="r">${e(value)}</td></tr>`;
 const logo=m.business.logo?`<img class="logo" src="${e(m.business.logo)}" alt="Business logo"/>`:'';
 const contact=[m.business.address,...m.business.contacts].filter(Boolean).map(e).join('<br>');
 const notices=m.notices.map(n=>`<p class="notice"><strong>${e(n)}</strong></p>`).join('');
 const adjustmentsHtml=m.adjustments.length?`<h3>Later adjustments</h3>${m.adjustments.map(a=>`<p class="adj"><strong>${e(a.label)} · ${e(a.ref)}</strong><br>Job: ${e(a.job)}<br>${a.lines.map(e).join('<br>')}</p>`).join('')}`:'';
 if(layout==='narrow'){
  const css=`.psl-r{font-size:1em;line-height:1.35;color:#000;width:100%}.psl-r *{box-sizing:border-box}.psl-r .c{text-align:center}.psl-r .r{text-align:right;white-space:nowrap}.psl-r .logo{display:block;margin:0 auto 4px;max-width:60%;max-height:22mm}.psl-r h1{font-size:1.35em;margin:2px 0;text-align:center;text-transform:uppercase;letter-spacing:.5px}.psl-r .contact{font-size:.82em;text-align:center;margin:0 0 4px}.psl-r .title{text-align:center;font-weight:bold;font-size:1.1em;letter-spacing:2px;border-top:2px solid #000;border-bottom:2px solid #000;padding:3px 0;margin:6px 0}.psl-r table{width:100%;border-collapse:collapse}.psl-r td{padding:1px 0;vertical-align:top;border:0}.psl-r .meta td{font-size:.9em}.psl-r .rule{border-top:1px dashed #000;margin:5px 0}.psl-r .item-name{font-weight:bold;padding-top:4px}.psl-r .item-sub{font-size:.82em}.psl-r .amt td{font-size:.92em}.psl-r .strong td{font-weight:bold}.psl-r .total td{font-weight:bold;font-size:1.15em;border-top:2px solid #000;padding-top:3px}.psl-r .notice{border:1px solid #000;padding:3px;text-align:center;font-size:.85em;margin:4px 0}.psl-r h3{font-size:.95em;margin:6px 0 2px;text-transform:uppercase}.psl-r .adj{font-size:.8em;margin:3px 0}.psl-r .foot{text-align:center;margin-top:8px;font-size:.9em}`;
  const items=m.items.map(i=>`<tr><td colspan="2" class="item-name">${e(i.description)}</td></tr><tr><td colspan="2" class="item-sub">${e(i.service)} · ${e(i.ref)}${i.details.length?' · '+i.details.map(e).join(' · '):''}</td></tr>${row('Amount',i.amount,'amt')}${i.paidBefore?row('Paid before',i.paidBefore,'amt'):''}${row('Paid now',i.paidNow,'amt')}${row('Balance',i.balance,'amt strong')}`).join('');
  const totals=m.totals.map((t,k)=>row(t.label,t.value,k===m.totals.length-1&&t.strong?'total':t.strong?'strong':'')).join('');
  return `<style>${css}</style><div class="psl-r">${logo}<h1>${e(m.business.name)}</h1>${contact?`<p class="contact">${contact}</p>`:''}<div class="title">${e(m.title.toUpperCase())}</div>${notices}<table class="meta">${row('Receipt no.',m.number)}${row('Date',m.date)}${row('Customer',m.customer.name)}${m.customer.phone?row('Phone',m.customer.phone):''}${row('Cashier',m.cashier)}${row('Payment date',m.paidOn)}</table><div class="rule"></div><table>${items}</table><div class="rule"></div><table>${totals}</table><div class="rule"></div><table class="meta">${m.account.map(a=>row(a.label,a.value)).join('')}</table>${m.note?`<p class="item-sub">Note: ${e(m.note)}</p>`:''}${adjustmentsHtml}${m.footer?`<p class="foot">${e(m.footer)}</p>`:''}<p class="foot item-sub">${e(m.title)} ${e(m.number)}</p></div>`;
 }
 const css=`.psl-w{color:#1d2b27;line-height:1.45;font-size:1em}.psl-w *{box-sizing:border-box}.psl-w table{width:100%;border-collapse:collapse}.psl-w td,.psl-w th{border:0;padding:0;vertical-align:top;text-align:left}.psl-w .r{text-align:right;white-space:nowrap}.psl-w .head td{padding-bottom:10px}.psl-w h1{font-size:1.6em;margin:0 0 4px;color:${brand}}.psl-w .contact{font-size:.85em;color:#55635e;margin:0}.psl-w .logo{max-width:200px;max-height:90px}.psl-w .band{background:${brand};color:#fff;margin:6px 0 12px}.psl-w .band td{color:#fff;padding:8px 12px;vertical-align:middle}.psl-w .band .t{font-size:1.25em;font-weight:bold;letter-spacing:2px;text-transform:uppercase}.psl-w .meta td{padding:2px 12px 2px 0;font-size:.92em}.psl-w .meta .k{color:#6b7873;width:110px}.psl-w .items{margin-top:12px}.psl-w .items th{font-size:.75em;text-transform:uppercase;letter-spacing:.6px;color:#6b7873;border-bottom:2px solid ${brand};padding:6px 6px}.psl-w .items td{padding:8px 6px;border-bottom:1px solid #e3e8e5}.psl-w .items small{display:block;color:#6b7873;font-size:.8em;margin-top:2px}.psl-w .sum{width:55%;margin:12px 0 0 auto}.psl-w .sum td{padding:4px 6px}.psl-w .sum .strong td{font-weight:bold}.psl-w .sum .total td{font-weight:bold;font-size:1.15em;border-top:2px solid ${brand};color:${brand};padding-top:6px}.psl-w .acct{margin-top:14px;background:#f3f6f4}.psl-w .acct td{padding:4px 12px}.psl-w .notice{border-left:4px solid ${safeColour(m.business.accent)};background:#fdf7e8;padding:6px 10px;margin:6px 0}.psl-w h3{color:${brand};margin:16px 0 4px;font-size:1em}.psl-w .adj{font-size:.85em;margin:4px 0;color:#3c4a45}.psl-w .foot{text-align:center;margin-top:18px;color:#55635e;border-top:1px solid #e3e8e5;padding-top:10px}`;
 const items=m.items.map(i=>`<tr><td>${e(i.description)}<small>${e(i.service)} · ${e(i.ref)}${i.details.length?' · '+i.details.map(e).join(' · '):''}</small></td><td class="r">${e(i.amount)}${i.paidBefore?`<small>Paid before ${e(i.paidBefore)}</small>`:''}</td><td class="r">${e(i.paidNow)}</td><td class="r">${e(i.balance)}</td></tr>`).join('');
 const totals=m.totals.map((t,k)=>row(t.label,t.value,k===m.totals.length-1&&t.strong?'total':t.strong?'strong':'')).join('');
 return `<style>${css}</style><div class="psl-w"><table class="head"><tr><td><h1>${e(m.business.name)}</h1>${contact?`<p class="contact">${contact}</p>`:''}</td><td class="r">${logo}</td></tr></table><table class="band"><tr><td class="t">${e(m.title)}</td><td class="r">No. ${e(m.number)}</td></tr></table>${notices}<table class="meta"><tr><td class="k">Customer</td><td>${e(m.customer.name)}${m.customer.phone?` · ${e(m.customer.phone)}`:''}</td><td class="k">Date</td><td>${e(m.date)}</td></tr><tr><td class="k">Cashier</td><td>${e(m.cashier)}</td><td class="k">Payment date</td><td>${e(m.paidOn)}</td></tr></table>${m.items.length?`<table class="items"><thead><tr><th>Job</th><th class="r">Amount</th><th class="r">Paid now</th><th class="r">Balance</th></tr></thead><tbody>${items}</tbody></table>`:''}<table class="sum">${totals}</table><table class="acct">${m.account.map(a=>row(a.label,a.value)).join('')}</table>${m.note?`<p class="adj">Note: ${e(m.note)}</p>`:''}${adjustmentsHtml}${m.footer?`<p class="foot">${e(m.footer)}</p>`:''}</div>`;
}

/** Narrow receipt layout for roll paper up to 90mm wide. */
export const receiptLayout=paperWidth=>Number(paperWidth)>0&&Number(paperWidth)<=90?'narrow':'wide';

export function correctedReceipt(record,ledger){
 const jobs=record.jobs.map(j=>({...j,...(ledger.jobs.find(x=>x.id===j.id)??{})}));
 const payment=ledger.payments.find(p=>p.id===record.id||p.checkoutId===record.id);
 const jobBalances=record.jobBalances.map(balance=>{const job=ledger.jobs.find(j=>j.id===balance.id);if(!job)return balance;const paid=ledger.payments.flatMap(p=>p.allocations).filter(a=>a.jobId===job.id).reduce((n,a)=>n+a.amount,0);const paidThisCheckout=payment?.allocations.find(a=>a.jobId===job.id)?.amount??0;return {...balance,description:job.description,service:job.service,amount:job.amount,paidBefore:Math.max(0,paid-paidThisCheckout),paidThisCheckout,outstandingAfter:Math.max(0,job.amount-paid)};});
 return {...record,corrected:true,jobs,jobBalances,total:jobs.reduce((n,j)=>n+j.amount,0),cashReceived:payment?.amount??record.cashReceived,method:payment?.method??record.method,methodLabel:payment?.methodLabel??record.methodLabel,walletUsed:payment?.walletUsed??record.walletUsed,walletAdded:payment?.walletAdded??record.walletAdded,reference:payment?.reference??record.reference,walletAfter:ledger.payments.filter(p=>p.customerId===record.customerId).reduce((n,p)=>n+(p.walletAdded??0)-(p.walletUsed??0),0),outstandingAfter:ledger.jobs.filter(j=>j.customerId===record.customerId).reduce((n,j)=>n+Math.max(0,j.amount-ledger.payments.flatMap(p=>p.allocations).filter(a=>a.jobId===j.id).reduce((n,a)=>n+a.amount,0)),0)};
}
