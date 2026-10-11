import {jobBalance,customerBalance} from './domain.mjs';
import {walletBalance} from './checkout.mjs';
import {businessDay,validRange} from './dashboard.mjs';
import {paymentName} from './business-options.mjs';
import {adjustmentLabels} from './sale-adjustments.mjs';
import {customerCode} from './customers.mjs';

// Reports read the synced ledger only; they never create events.
// Money stays integer kobo. Days use the Africa/Lagos business day.

const inRange=(value,from,to)=>{const day=businessDay(value);return !!day&&day>=from&&day<=to;};
const shortId=id=>String(id??'').slice(0,8).toUpperCase();
const byDate=(a,b)=>a.date.localeCompare(b.date)||String(a.sortKey??'').localeCompare(String(b.sortKey??''));

/**
 * Customer statement for one customer.
 * Activity (jobs, payments, adjustments) is filtered to the period by its own date.
 * Balances (paid, outstanding, owed, credit) are current: they reflect every
 * payment and correction recorded so far, so the closing balance always equals
 * the customer's outstanding amount shown elsewhere in the app.
 */
export function customerStatement(ledger,customerId,from,to,{includePaid=true,now=new Date().toISOString()}={}){
 if(!validRange(from,to))throw Error('Choose a valid date range of up to ten years.');
 const customer=ledger.customers.find(c=>c.id===customerId);
 if(!customer)throw Error('Choose a customer.');
 const jobRow=job=>{const b=jobBalance(ledger,job);return {id:job.id,ref:shortId(job.id),date:businessDay(job.createdAt),sortKey:job.createdAt,service:job.service,description:job.description,amount:job.amount,paid:b.paid,outstanding:b.outstanding,status:b.status,stage:job.productionStatus??'Added'};};
 const allJobs=ledger.jobs.filter(j=>j.customerId===customerId);
 const periodJobs=allJobs.filter(j=>inRange(j.createdAt,from,to)).map(jobRow).sort(byDate);
 const jobs=includePaid?periodJobs:periodJobs.filter(j=>j.outstanding!==0);
 // Jobs created before the period that still have money owed, so the statement
 // explains the whole balance and not only this period's work.
 const earlierOwing=allJobs.filter(j=>businessDay(j.createdAt)<from).map(jobRow).filter(j=>j.outstanding!==0).sort(byDate);
 const laterOwing=allJobs.filter(j=>businessDay(j.createdAt)>to).map(jobRow).filter(j=>j.outstanding!==0).sort(byDate);
 const jobLabel=id=>{const job=ledger.jobs.find(j=>j.id===id);return job?`${job.description} (${shortId(id)})`:shortId(id);};
 const payments=ledger.payments.filter(p=>p.customerId===customerId&&inRange(p.paidOn||p.createdAt,from,to)).map(p=>({
  id:p.id,ref:shortId(p.id),date:businessDay(p.paidOn||p.createdAt),sortKey:p.createdAt,method:paymentName(p),reference:p.reference??'',
  refund:!!p.refundId,received:p.amount,creditUsed:p.walletUsed??0,creditAdded:p.walletAdded??0,
  jobsPaid:p.allocations.map(a=>({job:jobLabel(a.jobId),amount:a.amount}))
 })).sort(byDate);
 const adjustments=ledger.saleAdjustments.filter(a=>a.customerId===customerId&&!a.groupId&&inRange(a.changedAt,from,to)).map(a=>({
  id:a.id,ref:shortId(a.id),date:businessDay(a.changedAt),sortKey:a.changedAt,action:adjustmentLabels[a.action]??a.action,job:jobLabel(a.jobId),
  chargeBefore:a.before?.amount??0,chargeAfter:a.after?.amount??0,refund:a.refundAmount??0,creditReleased:a.creditReleased??0,reason:a.reason,approvedBy:a.changedByLabel
 })).sort(byDate);
 const sum=(rows,key)=>rows.reduce((n,r)=>n+r[key],0);
 const totals={
  charged:sum(periodJobs,'amount'),
  received:sum(payments.filter(p=>!p.refund),'received'),
  refunded:sum(payments.filter(p=>p.refund),'creditUsed'),
  creditUsed:sum(payments.filter(p=>!p.refund),'creditUsed'),
  owedNow:customerBalance(ledger,customerId),
  creditNow:walletBalance(ledger,customerId)
 };
 return {
  customer:{id:customer.id,code:customerCode(customer.id,ledger.customers),name:customer.name,phone:customer.phone,address:customer.address,creditLimit:customer.creditLimit,archived:customer.archived},
  from,to,generatedAt:now,includePaid,jobs,earlierOwing,laterOwing,payments,adjustments,totals
 };
}

const naira=kobo=>(kobo/100).toFixed(2);

/** Statement as spreadsheet sections: [{title, columns, rows}] with plain values. */
export function statementSections(statement){
 const jobColumns=['Date','Job ID','Service','Description','Stage','Amount (NGN)','Paid (NGN)','Outstanding (NGN)','Payment status'];
 const jobCells=j=>[j.date,j.ref,j.service,j.description,j.stage,naira(j.amount),naira(j.paid),naira(j.outstanding),j.status];
 const t=statement.totals;
 const sections=[
  {title:'Account summary',columns:['Item','Value'],rows:[
   ['Customer',statement.customer.name],['Customer ID',statement.customer.code],['Phone',statement.customer.phone],['Address',statement.customer.address],
   ['Period',`${statement.from} to ${statement.to}`],['Credit limit (NGN)',naira(statement.customer.creditLimit)],
   ['Jobs charged in period (NGN)',naira(t.charged)],['Money received in period (NGN)',naira(t.received)],['Credit used in period (NGN)',naira(t.creditUsed)],['Refunds paid in period (NGN)',naira(t.refunded)],
   ['Total owed now (NGN)',naira(t.owedNow)],['Credit balance now (NGN)',naira(t.creditNow)]
  ]},
  {title:'Jobs in this period',columns:jobColumns,rows:statement.jobs.map(jobCells)}
 ];
 if(statement.earlierOwing.length)sections.push({title:'Earlier jobs still owing',columns:jobColumns,rows:statement.earlierOwing.map(jobCells)});
 if(statement.laterOwing.length)sections.push({title:'Later jobs still owing',columns:jobColumns,rows:statement.laterOwing.map(jobCells)});
 sections.push({title:'Payments in this period',columns:['Date','Payment ID','Method','Reference','Money received (NGN)','Credit used (NGN)','Credit added (NGN)','Jobs paid'],
  rows:statement.payments.map(p=>[p.date,p.ref,p.refund?`${p.method} (refund to customer)`:p.method,p.reference,naira(p.received),naira(p.creditUsed),naira(p.creditAdded),p.jobsPaid.map(a=>`${a.job}: ${naira(a.amount)}`).join('; ')])});
 if(statement.adjustments.length)sections.push({title:'Corrections and refunds in this period',columns:['Date','Adjustment ID','Type','Job','Charge before (NGN)','Charge after (NGN)','Refunded (NGN)','Reason','Approved by'],
  rows:statement.adjustments.map(a=>[a.date,a.ref,a.action,a.job,naira(a.chargeBefore),naira(a.chargeAfter),naira(a.refund),a.reason,a.approvedBy])});
 return sections;
}

/** CSV text (RFC 4180) for report sections, with a title block. Excel-friendly with a BOM added at download. */
export function sectionsToCsv(titleLines,sections){
 const cell=value=>{let text=value==null?'':String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ is treated as a formula by Excel.
  if(/^[=+\-@\t\r]/.test(text)&&!/^-?\d+(\.\d+)?$/.test(text))text="'"+text;
  return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
 const line=cells=>cells.map(cell).join(',');
 const out=titleLines.map(t=>line([t]));
 for(const s of sections){out.push('',line([s.title]),line(s.columns));for(const r of s.rows)out.push(line(r));if(!s.rows.length)out.push(line(['None']));}
 return out.join('\r\n')+'\r\n';
}

export const reportFileName=(...parts)=>parts.filter(Boolean).join(' - ').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/\s+/g,' ').trim().slice(0,150);
