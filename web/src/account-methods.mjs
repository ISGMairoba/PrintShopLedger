import {usableInBranch} from './operations.mjs';
export const methodTypes=[{kind:'Cash',name:'Cash'},{kind:'POS',name:'Card'},{kind:'Transfer',name:'Transfer'},{kind:'Other',name:'Other'}];
export const typeName=kind=>methodTypes.find(m=>m.kind===kind)?.name??'Other';
export function accountMethodDetails(a,legacy=[]){
 if(Array.isArray(a.paymentMethods))return a.paymentMethods;
 return (a.methods??[]).map(label=>{const kind=legacy.find(m=>m.label===label)?.kind??(a.accountType==='cash'?'Cash':a.accountType==='pos'?'POS':a.accountType==='bank'?'Transfer':'Other');return{id:crypto.randomUUID(),name:typeName(kind),label,kind,enabled:true,aliases:[]};});
}
export function prepareAccountMethods(accountName,drafts,old){
 if(!Array.isArray(drafts)||drafts.length<1||drafts.length>30)throw Error('Each account needs 1–30 payment methods.');
 const ids=new Set(),names=new Set(),prior=old?.paymentMethods??[];
 const result=drafts.map(m=>{
  const id=String(m.id??'').trim(),name=String(m.name??'').trim();
  if(!id||ids.has(id)||!name||name.length>40||names.has(name.toLowerCase())||!methodTypes.some(t=>t.kind===m.kind)||typeof m.enabled!=='boolean')throw Error('Give each method a unique name and choose Cash, Card, Transfer or Other.');
  ids.add(id);names.add(name.toLowerCase());const before=prior.find(p=>p.id===id);
  let label=before&&prior.length===drafts.length&&old.name===accountName&&before.name===name?before.label:(drafts.length===1?accountName:accountName+' — '+name);
  if(Array.from(label).length>80)label=Array.from(label).slice(0,69).join('')+' #'+id.slice(0,8);
  const aliases=[...new Set([...(before?.aliases??[]),...(before&&before.label!==label?[before.label]:[])])];
  if(aliases.length>80)throw Error('Too many saved aliases for this method.');
  return{id,name,label,kind:m.kind,enabled:m.enabled,aliases};
 });
 if(prior.some(m=>!ids.has(m.id)))throw Error('Disable a saved method instead of deleting it. Its history is retained.');
 return result;
}
export const routingLabels=methods=>[...new Set(methods.filter(m=>m.enabled).flatMap(m=>[m.label,...(m.aliases??[])]))];
export function accountPaymentOptions(ledger,legacy=[],allowLegacy=false){
 const accounts=ledger.moneyAccounts??[];
 if(!accounts.length)return allowLegacy?legacy:[];
 return accounts.filter(a=>!a.archived&&usableInBranch(a)).flatMap(a=>{
  const methods=accountMethodDetails(a,legacy).filter(m=>m.enabled);
  return methods.map(m=>({label:m.label,kind:m.kind,enabled:true,accountId:a.id,methodId:m.id,displayLabel:methods.length===1?a.name:a.name+' — '+m.name}));
 });
}
export function resolveAccountPayment(ledger,label,kind,accountId,personal=false){
 if(personal)return '';
 const matches=(ledger.moneyAccounts??[]).filter(a=>!a.archived&&usableInBranch(a)&&accountMethodDetails(a).some(m=>m.enabled&&m.kind===kind&&(m.label===label||m.aliases?.includes(label))));
 const chosen=accountId?matches.find(a=>a.id===accountId):matches.length===1?matches[0]:null;
 if(!chosen)throw Error('Choose an active account and one of its enabled payment methods. Account and method must match.');
 return chosen.id;
}
export function routeMoneyEvent(ledger,event){
 if(!(ledger.moneyAccounts??[]).some(a=>a.paymentMethods))return event;
 const d=event.data;
 if(event.kind==='checkout.completed'&&d.cashReceived>0)return{...event,data:{...d,accountId:resolveAccountPayment(ledger,d.methodLabel||d.method,d.method,d.accountId)}};
 if(event.kind.startsWith('expense.')&&d.payment?.amount>0)return{...event,data:{...d,payment:{...d.payment,accountId:resolveAccountPayment(ledger,d.payment.methodLabel||d.payment.method,d.payment.method,d.payment.accountId,d.payment.source==='Personal funds')}}};
 if(event.kind==='sale.refunded'&&d.refundAmount>0)return{...event,data:{...d,accountId:resolveAccountPayment(ledger,d.methodLabel||d.method,d.method,d.accountId)}};
 if(event.kind==='payment.corrected'&&d.paymentAmount>0)return{...event,data:{...d,accountId:resolveAccountPayment(ledger,d.methodLabel||d.method,d.method,d.accountId)}};
 return event;
}
export function routeMoneyResult(before,next,event){
 if(!(before.moneyAccounts??[]).some(a=>a.paymentMethods))return next;
 if(event.kind==='payment.corrected')next={...next,payments:next.payments.map(p=>p.id===event.data.paymentId?{...p,accountId:event.data.accountId??p.accountId}:p)};
 if(event.kind==='sale.refunded')next={...next,saleAdjustments:next.saleAdjustments.map(a=>a.id===event.id?{...a,accountId:event.data.accountId}:a)};
 return next;
}
