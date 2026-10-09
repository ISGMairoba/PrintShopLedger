import {paymentName} from './business-options.mjs';
import { jsPDF } from 'jspdf';
import {receiptBusiness,validLogo} from './business-branding.mjs';
import { receiptIntegrityError } from './receipts.mjs';
import type { CheckoutRecord, SaleAdjustment } from './types';
const money=(amount:number)=>`NGN ${(amount/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function createReceiptPdf(record:CheckoutRecord,business:string|import('./useBusinessBranding').Branding,pending=false,adjustments:SaleAdjustment[]=[]){
 adjustments=adjustments.filter(item=>!item.groupId||!adjustments.some(parent=>parent.id===item.groupId));
 const warning=receiptIntegrityError(record);if(warning)throw Error(warning);
 const doc=new jsPDF({unit:'mm',format:'a4'});let y=18;
 const line=(text:string,bold=false)=>{
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(bold?12:10);
  // Built-in PDF fonts use Latin-1. Keep unsupported characters legible without corrupting money.
  const rows=doc.splitTextToSize(text.replace(/[^\x20-\x7e\xa0-\xff\n]/g,'?'),174) as string[];
  for(const row of rows){if(y>275){doc.addPage();y=18;}doc.text(row,18,y);y+=6;}y+=2;
 };
 const b=receiptBusiness(business);
 if(b.receipt.showLogo&&b.logo&&validLogo(b.logo)){const image=doc.getImageProperties(b.logo);const scale=Math.min(60/image.width,25/image.height);doc.addImage(b.logo,image.fileType,18,y,image.width*scale,image.height*scale);y+=image.height*scale+6;}
 line(b.businessName,true);if(b.receipt.showAddress&&b.address)line(b.address);if(b.receipt.showContacts){const contacts=[b.phones,b.email,b.website,b.socials].filter(Boolean);if(contacts.length)line(contacts.join('\n'));}
 line(`Receipt ${record.id.slice(0,8).toUpperCase()}`,true);
 if(record.corrected)line('Corrected receipt - current job and payment balances',true);else if(adjustments.length)line('Original receipt - later adjustments listed below',true);
 if(pending)line('Pending confirmation - saved on this device',true);
 line(new Date(record.createdAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'}));
 line(`Customer: ${record.customerSnapshot?.name??record.customerId}\nPhone: ${record.customerSnapshot?.phone??''}\nCashier: ${record.createdByLabel}`);
 for(const balance of record.jobBalances??[]){
  const job=record.jobs.find(job=>job.id===balance.id);
  line(`${balance.service} - ${balance.id.slice(0,8).toUpperCase()}`,true);line(balance.description);
  if(job)line(`Quantity: ${job.quantity}${job.requireSize?` | Size: ${job.width} x ${job.height}`:''}\nReceived: ${job.source}${job.sourceNote?` - ${job.sourceNote}`:''}`);
  line(`Amount: ${money(balance.amount)}\nPaid before: ${money(balance.paidBefore)}\nPaid now: ${money(balance.paidThisCheckout)}\nOutstanding: ${money(balance.outstandingAfter)}`);
 }
 line(`New jobs: ${money(record.total)}`,true);
 line(`Money received (${paymentName(record)}): ${money(record.cashReceived)}\nWallet used: ${money(record.walletUsed)}\nAdded to wallet: ${money(record.walletAdded)}\nWallet balance: ${money(record.walletAfter)}\nCustomer outstanding: ${money(record.outstandingAfter)}\nPayment date: ${record.paidOn}`);
 if(record.reference)line(`Note: ${record.reference}`);
 if(adjustments.length){line('Later adjustments',true);for(const a of adjustments){line(`${a.action.replace('sale.','')} - ${a.id.slice(0,8).toUpperCase()}`,true);line(`Job: ${a.jobId.slice(0,8).toUpperCase()}\nCharge: ${money(a.before.amount)} -> ${money(a.after.amount)}\nQuantity: ${a.before.quantity??'-'} -> ${a.after.quantity??'-'}\nSize: ${a.before.width??'-'} x ${a.before.height??'-'} -> ${a.after.width??'-'} x ${a.after.height??'-'}\nService: ${a.before.service} -> ${a.after.service}\n${a.paymentChanges.map(p=>`Payment: ${p.before.methodLabel??p.before.method} ${money(p.before.amount)} -> ${p.after.methodLabel??p.after.method} ${money(p.after.amount)}`).join('\n')}\nCredit released: ${money(a.creditReleased)}\nMoney refunded: ${money(a.refundAmount)}${a.refundAmount?` (${a.methodLabel??a.method})`:''}\nMaterial returned: ${a.returnQuantity}\nReason: ${a.reason}\nApproved by: ${a.changedByLabel} - ${new Date(a.changedAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})}`);}}
 if(b.receipt.footer)line(b.receipt.footer);
 return doc;
}
export function downloadReceiptPdf(record:CheckoutRecord,business:string|import('./useBusinessBranding').Branding,pending=false,adjustments:SaleAdjustment[]=[]){createReceiptPdf(record,business,pending,adjustments).save(`Receipt-${record.id.slice(0,8).toUpperCase()}${record.corrected?'-corrected':''}.pdf`);}
