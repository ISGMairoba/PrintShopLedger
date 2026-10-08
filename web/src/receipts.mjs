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
export function receiptHtml(record,business,pending=false){
 const e=escapeHtml,c=record.customerSnapshot,b=receiptBusiness(business);
 const logo=b.receipt.showLogo&&b.logo&&validLogo(b.logo)?`<img src="${e(b.logo)}" alt="Business logo" style="max-width:180px;max-height:90px;object-fit:contain"/>`:'';
 const details=[...(b.receipt.showAddress&&b.address?[b.address]:[]),...(b.receipt.showContacts?[b.phones,b.email,b.website,b.socials].filter(Boolean):[])];
 return `${logo}<h1>${e(b.businessName)}</h1>${details.length?`<p>${details.map(e).join("<br>")}</p>`:""}<h2>Receipt ${e(record.id.slice(0,8).toUpperCase())}</h2>${pending?'<p><strong>Pending confirmation — saved on this device</strong></p>':''}<p>${e(new Date(record.createdAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'}))}<br>Customer: ${e(c?.name??record.customerId)}<br>Phone: ${e(c?.phone??'')}<br>Cashier: ${e(record.createdByLabel)}</p><table><thead><tr><th>Job</th><th>Amount</th><th>Paid now</th><th>Outstanding</th></tr></thead><tbody>${(record.jobBalances??[]).map(j=>`<tr><td>${e(j.description)}<br>${e(j.service)} · ${e(j.id.slice(0,8).toUpperCase())}${(()=>{const item=(record.jobs??[]).find(n=>n.id===j.id);return item?`<br>Quantity: ${e(item.quantity)}${item.requireSize?` · Size: ${e(item.width)} × ${e(item.height)}`:''}<br>Received: ${e(item.source)}${item.sourceNote?' — '+e(item.sourceNote):''}`:'';})()}</td><td>${balancedReceiptJob(j)?e(currency(j.amount)):'Needs verification'}</td><td>${e(currency(j.paidThisCheckout))}</td><td>${e(currency(j.outstandingAfter))}</td></tr>`).join('')}</tbody></table><p>New jobs: ${balancedReceiptTotal(record)?e(currency(record.total)):'Needs verification'}<br>Money received (${e(paymentName(record))}): ${e(currency(record.cashReceived))}<br>Wallet used: ${e(currency(record.walletUsed))}<br>Added to wallet: ${e(currency(record.walletAdded))}<br>Wallet balance: ${e(currency(record.walletAfter))}<br>Customer outstanding: ${e(currency(record.outstandingAfter))}<br>Payment date: ${e(record.paidOn)}${record.reference?'<br>Note: '+e(record.reference):''}</p>${b.receipt.footer?`<p>${e(b.receipt.footer)}</p>`:""}`;
}
