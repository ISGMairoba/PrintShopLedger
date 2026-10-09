import {normalizeLedger,validateMaterial} from './materials.mjs';
import {materialSnapshot} from './material-display.mjs';
import {quoteLine,accountToken,walletBalance} from './checkout.mjs';
import {jobBalance} from './domain.mjs';
import {sameEvent} from './sale-adjustments.mjs';
export const correctionKinds=['sale.details_corrected','payment.corrected'];
export const paymentCorrectionToken=p=>({amount:p.amount,method:p.method,methodLabel:p.methodLabel??p.method,paidOn:p.paidOn,reference:p.reference,walletUsed:p.walletUsed??0,walletAdded:p.walletAdded??0,allocations:[...p.allocations].sort((a,b)=>a.jobId.localeCompare(b.jobId))});
export function quoteCorrectedJob(ledger,job,d){
 const service=ledger.services.find(s=>s.id===d.serviceId&&!s.archived);if(!service||service.version!==d.serviceVersion)throw Error('Service changed. Sync and reopen the correction.');
 const material=d.materialId?ledger.materials.find(m=>m.id===d.materialId&&!m.archived):null;if(d.materialId&&!material)throw Error('Choose an active material.');
 if(!Number.isSafeInteger(d.unitPrice)||d.unitPrice<0||d.unitPrice>100000000000)throw Error('Enter a valid unit price.');
 return {...job,...quoteLine({...ledger,services:[{...service,materialId:material?.id??null,price:d.unitPrice}]},{serviceId:service.id,description:d.description,quantity:d.quantity,width:d.width,height:d.height,source:job.source??'Other',sourceNote:job.sourceNote??''})};
}
export function stockCorrectionPlan(ledger,job,after,mode){
 if(!['reconcile','keep'].includes(mode))throw Error('Choose whether to correct the stock deduction or keep actual usage.');
 if(mode==='keep')return [];
 const ids=[...new Set([job.materialId,after.materialId].filter(Boolean))];
 const actual=id=>Math.max(0,Math.round(ledger.materialHistory.filter(h=>h.jobId===job.id&&h.materialId===id&&['material.job_used','material.sale_returned','material.job_corrected'].includes(h.action)).reduce((n,h)=>n+(h.beforeAvailable??h.afterAvailable)-h.afterAvailable,0)*1000)/1000);
 return ids.map(id=>{const used=actual(id);let target=0;if(id===after.materialId){target=id===job.materialId?used+after.materialNeeded-(job.materialNeeded??0):after.materialNeeded;if(target<-.0001)throw Error('This stock was already covered by a stock count or was returned. Keep actual usage; do not restore unrecorded deductions.');}const delta=Math.round((used-Math.max(0,target))*1000)/1000;return {materialId:id,delta};}).filter(x=>x.delta!==0);
}
export function applyFullCorrection(input,event){
 const ledger=normalizeLedger(input),d=event.data;
 if(!event.id||!d.modifiedBy||!d.modifiedAt||Number.isNaN(Date.parse(d.modifiedAt))||!d.reason?.trim()||d.reason.trim().length>500)throw Error('An approver, date and reason are required.');
 const previous=ledger.saleAdjustments.find(r=>r.id===event.id);if(previous){if(!sameEvent(previous.event,event))throw Error('Adjustment ID already used for different details.');return ledger;}
 const job=ledger.jobs.find(j=>j.id===d.jobId);if(!job)throw Error('Job not found.');
 if(d.baseVersion!==(job.version??1)||d.expectedAccount!==accountToken(ledger,job.customerId))throw Error('The job or customer account changed. Sync and reopen the correction.');
 const audit={reason:d.reason.trim(),changedBy:d.modifiedBy,changedByLabel:d.modifiedByLabel||d.modifiedBy,changedAt:d.modifiedAt};
 let after={...job},payments=structuredClone(ledger.payments),materials=ledger.materials,history=ledger.materialHistory,stockChanges=[],released=0,cashDelta=0,methodDeltas={},drawerActor=null,historicalClosingId=null,paymentId=null;
 if(event.kind==='sale.details_corrected'){
  if(job.productionStatus==='Cancelled')throw Error('This sale is already cancelled.');
  after=quoteCorrectedJob(ledger,job,d);stockChanges=stockCorrectionPlan(ledger,job,after,d.stockMode);
  if(['description','quantity','width','height','serviceId','materialId','unitPrice','amount'].every(k=>(after[k]??null)===(job[k]??null))&&!stockChanges.length)throw Error('Nothing changed.');
  for(const change of stockChanges){const m=materials.find(m=>m.id===change.materialId),id=d.stockIds?.[change.materialId];if(!m||m.archived||d.materialVersions?.[m.id]!==m.version||!id||id===event.id||history.some(h=>h.id===id))throw Error('Material changed. Sync and reopen the correction.');const next={...m,available:Math.round((m.available+change.delta)*1000)/1000,version:m.version+1,modifiedBy:audit.changedBy,modifiedByLabel:audit.changedByLabel,modifiedAt:audit.changedAt,lastEventId:id};validateMaterial(next);materials=materials.map(x=>x.id===m.id?next:x);history=[...history,{id,materialId:m.id,materialName:m.name,measurementUnit:m.measurementUnit,action:'material.job_corrected',jobId:job.id,checkoutId:job.checkoutId,beforeAvailable:m.available,afterAvailable:next.available,...audit,before:materialSnapshot(m),after:materialSnapshot(next),detailsComplete:true}];}
  let excess=Math.max(0,payments.reduce((n,p)=>n+p.allocations.filter(a=>a.jobId===job.id).reduce((n,a)=>n+a.amount,0),0)-after.amount);released=excess;
  for(const p of [...payments].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id))){const allocation=p.allocations.find(a=>a.jobId===job.id);if(!allocation||!excess)continue;const move=Math.min(excess,allocation.amount);allocation.amount-=move;p.allocations=p.allocations.filter(a=>a.amount>0);p.walletAdded=(p.walletAdded??0)+move;excess-=move;}
 }else if(event.kind==='payment.corrected'){
  const p=payments.find(p=>p.id===d.paymentId&&p.customerId===job.customerId&&!p.refundId);if(!p)throw Error('Choose a payment for this customer.');
  if(!sameEvent(d.expectedPayment,paymentCorrectionToken(p)))throw Error('Payment changed. Sync and reopen the correction.');
  if(!Number.isSafeInteger(d.paymentAmount)||d.paymentAmount<0||d.paymentAmount>100000000000||!['Cash','POS','Transfer'].includes(d.method)||!d.methodLabel?.trim()||d.methodLabel.length>80||typeof d.reference!=='string'||d.reference.length>500)throw Error('Enter valid payment details.');
  if(p.amount===d.paymentAmount&&p.method===d.method&&(p.methodLabel??p.method)===d.methodLabel&&p.reference===d.reference)throw Error('Nothing changed.');
  const before=ledger.payments.find(x=>x.id===p.id),difference=d.paymentAmount-p.amount;paymentId=p.id;
  if(difference>0){let remaining=difference;for(const j of ledger.jobs.filter(j=>j.customerId===job.customerId&&j.productionStatus!=='Cancelled').sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id))){const move=Math.min(remaining,jobBalance({...ledger,payments},j).outstanding);if(move>0){const allocation=p.allocations.find(a=>a.jobId===j.id);if(allocation)allocation.amount+=move;else p.allocations.push({jobId:j.id,amount:move});remaining-=move;}if(!remaining)break;}p.walletAdded=(p.walletAdded??0)+remaining;}
  if(difference<0){let remaining=-difference;const move=Math.min(remaining,p.walletAdded??0,Math.max(0,walletBalance(ledger,job.customerId)));p.walletAdded=(p.walletAdded??0)-move;remaining-=move;for(const allocation of [...p.allocations].sort((a,b)=>b.jobId.localeCompare(a.jobId))){const move=Math.min(remaining,allocation.amount);allocation.amount-=move;remaining-=move;if(!remaining)break;}p.allocations=p.allocations.filter(a=>a.amount>0);if(remaining)throw Error('This payment credit has already been spent. Correct the dependent payments first.');}
  p.amount=d.paymentAmount;p.method=d.method;p.methodLabel=d.methodLabel;p.reference=d.reference.trim();
  const checkout=ledger.checkouts.find(r=>r.id===(p.checkoutId??p.id));historicalClosingId=checkout?.drawerClosingId??ledger.drawerClosings.find(c=>c.checkoutIds.includes(checkout?.id))?.id??null;drawerActor=checkout&&!historicalClosingId?checkout.createdBy:null;
  for(const method of ['Cash','POS','Transfer'])methodDeltas[method]=(p.method===method?p.amount:0)-(before.method===method?before.amount:0);cashDelta=methodDeltas.Cash;
 }else throw Error('Choose a correction type.');
 after={...after,version:(job.version??1)+1,modifiedBy:audit.changedBy,modifiedByLabel:audit.changedByLabel,modifiedAt:audit.changedAt,lastEventId:event.id};
 const paymentChanges=ledger.payments.flatMap(before=>{const after=payments.find(p=>p.id===before.id);return sameEvent(before,after)?[]:[{before,after}];});
 const record={id:event.id,jobId:job.id,customerId:job.customerId,action:event.kind,...audit,before:job,after,creditReleased:released,refundAmount:0,returnQuantity:0,paymentChanges,stockChanges,stockMode:d.stockMode,cashDelta,methodDeltas,drawerActor,historicalClosingId,paymentId,affectedJobIds:[...new Set([job.id,...paymentChanges.flatMap(p=>[...p.before.allocations,...p.after.allocations].map(a=>a.jobId))])],event};
 return {...ledger,jobs:ledger.jobs.map(j=>j.id===job.id?after:j),payments,materials,materialHistory:history,saleAdjustments:[...ledger.saleAdjustments,record]};
}
