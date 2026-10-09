import {normalizeLedger,validateMaterial} from './materials.mjs';
import {materialSnapshot} from './material-display.mjs';
import {quoteLine,accountToken,walletBalance} from './checkout.mjs';
import {jobBalance} from './domain.mjs';
import {sameEvent} from './sale-adjustments.mjs';
export const correctionKinds=['sale.combined_corrected','sale.details_corrected','payment.corrected'];
export const paymentCorrectionToken=p=>({amount:p.amount,method:p.method,methodLabel:p.methodLabel??p.method,paidOn:p.paidOn,reference:p.reference,walletUsed:p.walletUsed??0,walletAdded:p.walletAdded??0,allocations:[...p.allocations].sort((a,b)=>a.jobId.localeCompare(b.jobId))});
export function quoteCorrectedJob(ledger,job,d){
 const service=ledger.services.find(s=>s.id===d.serviceId&&!s.archived);if(!service||service.version!==d.serviceVersion)throw Error('Service changed. Sync and reopen the correction.');
 const material=d.materialId?ledger.materials.find(m=>m.id===d.materialId&&!m.archived):null;if(d.materialId&&!material)throw Error('Choose an active material.');
 if(!Number.isSafeInteger(d.unitPrice)||d.unitPrice<0||d.unitPrice>100000000000)throw Error('Enter a valid unit price.');
 return {...job,...quoteLine({...ledger,services:[{...service,materialId:material?.id??null,price:d.unitPrice}]},{serviceId:service.id,description:d.description,quantity:d.quantity,width:d.width,height:d.height,source:job.source??'Other',sourceNote:job.sourceNote??''}),stockCountEventId:job.stockCountEventId??null};
}
export function stockCorrectionPlan(ledger,job,after,mode){
 if(!['reconcile','keep'].includes(mode))throw Error('Choose whether to correct the stock deduction or keep actual usage.');
 if(mode==='keep')return [];
 const ids=[...new Set([job.materialId,after.materialId].filter(Boolean))];
 const actual=id=>Math.max(0,Math.round(ledger.materialHistory.filter(h=>h.jobId===job.id&&h.materialId===id&&['material.job_used','material.sale_returned','material.job_corrected'].includes(h.action)).reduce((n,h)=>n+(h.beforeAvailable??h.afterAvailable)-h.afterAvailable,0)*1000)/1000);
 return ids.map(id=>{const used=actual(id);let target=0;if(id===after.materialId){target=id===job.materialId?used+after.materialNeeded-(job.materialNeeded??0):after.materialNeeded;if(target<-.0001)throw Error('This stock was already covered by a stock count or was returned. Keep actual usage; do not restore unrecorded deductions.');}const delta=Math.round((used-Math.max(0,target))*1000)/1000;if(delta){const firstUsage=ledger.materialHistory.filter(h=>h.jobId===job.id&&h.materialId===id&&['material.job_used','material.job_corrected'].includes(h.action)).map(h=>Date.parse(h.changedAt));if(firstUsage.length&&ledger.materialHistory.some(h=>h.materialId===id&&h.action==='material.stock_set'&&h.id!==job.stockCountEventId&&Date.parse(h.changedAt)>=Math.min(...firstUsage)))throw Error('A later stock count already reconciled this usage. Keep actual usage and current stock.');}return {materialId:id,delta};}).filter(x=>x.delta!==0);
}
export function applyCombinedCorrection(input,event){
 const ledger=normalizeLedger(input),d=event.data;
 const existing=ledger.saleAdjustments.find(r=>r.id===event.id);if(existing){if(!sameEvent(existing.event,event))throw Error('Adjustment ID already used for different details.');return ledger;}
 if(!event.id||!d.modifiedBy||!d.modifiedAt||Number.isNaN(Date.parse(d.modifiedAt))||!d.reason?.trim()||d.reason.trim().length>500)throw Error('An approver, date and reason are required.');
 const job=ledger.jobs.find(j=>j.id===d.jobId);if(!job||d.baseVersion!==(job.version??1)||d.expectedAccount!==accountToken(ledger,job?.customerId))throw Error('The job or customer account changed. Sync and reopen the correction.');
 if(job.productionStatus==='Cancelled')throw Error('This sale is already cancelled.');
 if(!Array.isArray(d.paymentEdits)||d.paymentEdits.length>100)throw Error('Invalid payment corrections.');
 const ids=[event.id,d.detailsId,...d.paymentEdits.map(p=>p.eventId)];if(ids.some(id=>!id)||new Set(ids).size!==ids.length||new Set(d.paymentEdits.map(p=>p.paymentId)).size!==d.paymentEdits.length||ids.slice(1).some(id=>ledger.saleAdjustments.some(r=>r.id===id)))throw Error('Invalid or reused correction IDs.');
 for(const edit of d.paymentEdits){const payment=ledger.payments.find(p=>p.id===edit.paymentId&&p.customerId===job.customerId&&!p.refundId);if(!payment||!sameEvent(edit.expectedPayment,paymentCorrectionToken(payment)))throw Error('Payment changed. Sync and reopen the correction.');}
 const quoted=quoteCorrectedJob(ledger,job,d),jobChanged=['description','quantity','width','height','serviceId','materialId','unitPrice','amount'].some(k=>(quoted[k]??null)!==(job[k]??null));
 let next=ledger;const children=[];
 if(jobChanged){next=applyFullCorrection(next,{id:d.detailsId,kind:'sale.details_corrected',data:{...d,groupId:event.id}});children.push(d.detailsId);}
 const edits=[...d.paymentEdits].sort((a,b)=>(b.paymentAmount-ledger.payments.find(p=>p.id===b.paymentId).amount)-(a.paymentAmount-ledger.payments.find(p=>p.id===a.paymentId).amount));
 for(const edit of edits){const original=ledger.payments.find(p=>p.id===edit.paymentId);if(original.amount===edit.paymentAmount&&original.method===edit.method&&(original.methodLabel??original.method)===edit.methodLabel&&original.reference===edit.reference.trim())continue;const payment=next.payments.find(p=>p.id===edit.paymentId),current=next.jobs.find(j=>j.id===job.id);next=applyFullCorrection(next,{id:edit.eventId,kind:'payment.corrected',data:{...d,...edit,groupId:event.id,baseVersion:current.version??1,expectedAccount:accountToken(next,job.customerId),expectedPayment:paymentCorrectionToken(payment)}});children.push(edit.eventId);}
 if(!children.length)throw Error('Nothing changed.');
 const records=next.saleAdjustments.filter(r=>children.includes(r.id)),after=next.jobs.find(j=>j.id===job.id);
 const record={id:event.id,action:event.kind,jobId:job.id,customerId:job.customerId,reason:d.reason.trim(),changedBy:d.modifiedBy,changedByLabel:d.modifiedByLabel||d.modifiedBy,changedAt:d.modifiedAt,before:job,after,creditReleased:records.reduce((n,r)=>n+r.creditReleased,0),refundAmount:0,returnQuantity:0,stockMode:d.stockMode,stockChanges:records.flatMap(r=>r.stockChanges??[]),paymentChanges:ledger.payments.flatMap(before=>{const after=next.payments.find(p=>p.id===before.id);return sameEvent(before,after)?[]:[{before,after}];}),childIds:children,event};
 return {...next,saleAdjustments:[...next.saleAdjustments.map(r=>children.includes(r.id)?{...r,groupId:event.id}:r),record]};
}
export function applyFullCorrection(input,event){
 if(event.kind==='sale.combined_corrected')return applyCombinedCorrection(input,event);
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
 const record={groupId:d.groupId,id:event.id,jobId:job.id,customerId:job.customerId,action:event.kind,...audit,before:job,after,creditReleased:released,refundAmount:0,returnQuantity:0,paymentChanges,stockChanges,stockMode:d.stockMode,cashDelta,methodDeltas,drawerActor,historicalClosingId,paymentId,affectedJobIds:[...new Set([job.id,...paymentChanges.flatMap(p=>[...p.before.allocations,...p.after.allocations].map(a=>a.jobId))])],event};
 return {...ledger,jobs:ledger.jobs.map(j=>j.id===job.id?after:j),payments,materials,materialHistory:history,saleAdjustments:[...ledger.saleAdjustments,record]};
}
