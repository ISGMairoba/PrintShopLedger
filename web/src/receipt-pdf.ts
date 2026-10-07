import { jsPDF } from 'jspdf';
import { receiptIntegrityError } from './receipts.mjs';
import type { CheckoutRecord } from './types';
const money=(amount:number)=>`NGN ${(amount/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export function createReceiptPdf(record:CheckoutRecord,business:string,pending=false){
 const warning=receiptIntegrityError(record);if(warning)throw Error(warning);
 const doc=new jsPDF({unit:'mm',format:'a4'});let y=18;
 const line=(text:string,bold=false)=>{
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(bold?12:10);
  // Built-in PDF fonts use Latin-1. Keep unsupported characters legible without corrupting money.
  const rows=doc.splitTextToSize(text.replace(/[^\x20-\x7e\xa0-\xff\n]/g,'?'),174) as string[];
  for(const row of rows){if(y>275){doc.addPage();y=18;}doc.text(row,18,y);y+=6;}y+=2;
 };
 line(business,true);line(`Receipt ${record.id.slice(0,8).toUpperCase()}`,true);
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
 line(`Money received (${record.method}): ${money(record.cashReceived)}\nWallet used: ${money(record.walletUsed)}\nAdded to wallet: ${money(record.walletAdded)}\nWallet balance: ${money(record.walletAfter)}\nCustomer outstanding: ${money(record.outstandingAfter)}\nPayment date: ${record.paidOn}`);
 if(record.reference)line(`Note: ${record.reference}`);
 return doc;
}
export function downloadReceiptPdf(record:CheckoutRecord,business:string,pending=false){createReceiptPdf(record,business,pending).save(`Receipt-${record.id.slice(0,8).toUpperCase()}.pdf`);}
