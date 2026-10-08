import {applyEvent} from './domain.mjs';
import {normalizeLedger} from './materials.mjs';
// Keep catalogue edits ahead of the sales that depend on them. Reapplying a
// sale before its reviewed customer/service edit can incorrectly reject it.
export function resolveCatalogueState(state,input,id,kind,choice,values,makeId,now) {
 let ledger=normalizeLedger(input);const pending=[];let reapplied=false;
 const collection=kind==='customer'?'customers':'services';
 const desired=state.ledger[collection].find(item=>item.id===id);
 function append(action,data){
  const current=ledger[collection].find(item=>item.id===id);
  const event={id:makeId(),kind:kind+'.'+action,data:{...values(data),id,baseVersion:current?.version,modifiedAt:now}};
  ledger=applyEvent(ledger,event);pending.push(event);reapplied=true;
 }
 for(const original of state.pending){
  if(!original.kind.startsWith(kind+'.')||original.data.id!==id){
   let event=original;
   if(kind==='service'&&choice==='local'&&reapplied&&original.kind==='checkout.completed'){
    // Only refresh the reviewed service's version. applyEvent still rejects
    // any changed price, stock link, allocations or customer account.
    const version=ledger.services.find(item=>item.id===id)?.version;
    event={...original,data:{...original.data,jobs:original.data.jobs.map(job=>job.serviceId===id?{...job,serviceVersion:version}:job)}};
   }
   ledger=applyEvent(ledger,event);pending.push(event);continue;
  }
  if(choice==='cloud')continue;
  let current=ledger[collection].find(item=>item.id===id);
  const action=original.kind.slice(kind.length+1);
  if(!current){
   if(!desired)throw Error('The local record is no longer available.');
   append('created',action==='created'?original.data:{...desired,...original.data});
   if(action==='archived')append('archived',original.data);
   continue;
  }
  if((action==='updated'||action==='created')&&current.archived){append('restored',original.data);current=ledger[collection].find(item=>item.id===id);}
  if((action==='archived'&&current.archived)||(action==='restored'&&!current.archived))continue;
  append(action==='created'?'updated':action,original.data);
 }
 return {...state,ledger,pending};
}
