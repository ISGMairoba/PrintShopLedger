export const saleDay=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'});
export function myTransactions(ledger,userId){return (ledger.checkouts??[]).filter(r=>r.createdBy===userId);}
export function saleDescription(record){return record.jobs.length?record.jobs.map(j=>j.description).join(' · '):record.walletUsed>0&&record.cashReceived===0?'Wallet payment':'Payment received';}
export function salesSummary(records){return records.reduce((s,r)=>({...s,cash:s.cash+(r.method==='Cash'?r.cashReceived:0),pos:s.pos+(r.method==='POS'?r.cashReceived:0),transfer:s.transfer+(r.method==='Transfer'?r.cashReceived:0),collected:s.collected+r.cashReceived,sales:s.sales+r.total,walletUsed:s.walletUsed+r.walletUsed,customers:[...new Set([...s.customers,r.customerId])]}),{cash:0,pos:0,transfer:0,collected:0,sales:0,walletUsed:0,customers:[]});}
export function drawerSnapshot(ledger,userId){
 const closings=[...(ledger.drawerClosings??[])].sort((a,b)=>Date.parse(b.closedAt)-Date.parse(a.closedAt)||b.id.localeCompare(a.id));
 const lastClosed=closings.find(d=>d.fromUserId===userId);
 const opening=closings.find(d=>d.toUserId===userId&&(!lastClosed||Date.parse(d.closedAt)>Date.parse(lastClosed.closedAt)));
 const closedIds=new Set(closings.flatMap(d=>d.checkoutIds));
 const records=myTransactions(ledger,userId).filter(r=>!r.drawerClosingId&&!closedIds.has(r.id));
 const summary=salesSummary(records),openingCash=opening?.countedCash??0;
 return {...summary,records,checkoutIds:records.map(r=>r.id).sort(),openingId:opening?.id??null,openingCash,expectedCash:openingCash+summary.cash};
}
