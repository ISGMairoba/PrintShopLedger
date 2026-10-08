import { applyEvent } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
import { prepareCheckout } from './checkout.mjs';
export function checkoutReviewBase(state,cloud,eventId){let ledger=normalizeLedger(cloud);for(const event of state.pending){if(event.id===eventId)return ledger;ledger=applyEvent(ledger,event);}throw Error('This pending checkout is no longer available.');}
export function replacePendingCheckout(state,cloud,eventId,replacement){
 let ledger=normalizeLedger(cloud),found=false;const pending=[];
 for(const original of state.pending){let event=original;
  if(original.id===eventId){event=replacement;found=true;}
  else if(found&&original.kind==='checkout.completed'){
   const d=original.data;event=prepareCheckout(ledger,{customerId:d.customerId,newCustomer:d.newCustomer,lines:d.jobs,countedMaterialJobs:d.countedMaterialJobs,cashReceived:d.cashReceived,useWallet:d.useWallet,override:d.override,method:d.method,...(d.methodLabel?{methodLabel:d.methodLabel}:{}),paidOn:d.paidOn,reference:d.reference},{id:d.createdBy,label:d.createdByLabel},original.id,d.createdAt);
  }
  ledger=applyEvent(ledger,event);
  // Financial rebasing must not acknowledge a physical count on behalf of later sales.
  if(found&&original.id!==eventId&&original.kind==='checkout.completed')event={...event,data:{...event.data,jobs:event.data.jobs.map((job,index)=>({...job,stockCountEventId:original.data.jobs[index].stockCountEventId??null}))}};
  pending.push(event);
 }
 if(!found)throw Error('This pending checkout is no longer available.');
 return {...state,ledger,pending};
}
export function adoptJobStatus(state,cloud,jobId){const pending=state.pending.filter(e=>!(e.kind==='job.status_changed'&&e.data.id===jobId));let ledger=normalizeLedger(cloud);for(const event of pending)ledger=applyEvent(ledger,event);return {...state,ledger,pending};}
