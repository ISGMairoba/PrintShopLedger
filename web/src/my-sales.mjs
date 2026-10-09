export const saleDay=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'});
export function myTransactions(ledger,userId,corrected=false){return (ledger.checkouts??[]).filter(r=>r.createdBy===userId).map(r=>{if(!corrected)return r;const payment=(ledger.payments??[]).find(p=>p.id===r.id||p.checkoutId===r.id);const jobs=(r.jobs??[]).map(j=>({...j,...((ledger.jobs??[]).find(x=>x.id===j.id)??{})}));return {...r,jobs,total:jobs.reduce((n,j)=>n+j.amount,0),cashReceived:payment?.amount??r.cashReceived,method:payment?.method??r.method,methodLabel:payment?.methodLabel??r.methodLabel,walletUsed:payment?.walletUsed??r.walletUsed,reference:payment?.reference??r.reference};});}
export function saleDescription(record){return record.jobs.length?record.jobs.map(j=>j.description).join(' · '):record.walletUsed>0&&record.cashReceived===0?'Wallet payment':'Payment received';}
export function salesSummary(records){return records.reduce((s,r)=>({...s,cash:s.cash+(r.method==='Cash'?r.cashReceived:0),pos:s.pos+(r.method==='POS'?r.cashReceived:0),transfer:s.transfer+(r.method==='Transfer'?r.cashReceived:0),collected:s.collected+r.cashReceived,sales:s.sales+r.total,walletUsed:s.walletUsed+r.walletUsed,customers:[...new Set([...s.customers,r.customerId])]}),{cash:0,pos:0,transfer:0,collected:0,sales:0,walletUsed:0,customers:[]});}
export function drawerSnapshot(ledger,userId){
 const closings=[...(ledger.drawerClosings??[])].sort((a,b)=>Date.parse(b.closedAt)-Date.parse(a.closedAt)||b.id.localeCompare(a.id));
 const lastClosed=closings.find(d=>d.fromUserId===userId);
 const opening=closings.find(d=>d.toUserId===userId&&(!lastClosed||Date.parse(d.closedAt)>Date.parse(lastClosed.closedAt)));
 const closedIds=new Set(closings.flatMap(d=>d.checkoutIds));
 const records=myTransactions(ledger,userId).filter(r=>!r.drawerClosingId&&!closedIds.has(r.id));
 const refunds=(ledger.saleAdjustments??[]).filter(r=>r.action==='sale.refunded'&&r.changedBy===userId&&!r.drawerClosingId&&!closings.some(c=>(c.refundIds??[]).includes(r.id)));
 const corrections=(ledger.saleAdjustments??[]).filter(r=>r.action==='payment.corrected'&&r.drawerActor===userId&&!r.drawerClosingId&&!closings.some(c=>(c.refundIds??[]).includes(r.id)));
 const correctionTotals=corrections.reduce((n,r)=>({cash:n.cash+(r.methodDeltas?.Cash??0),pos:n.pos+(r.methodDeltas?.POS??0),transfer:n.transfer+(r.methodDeltas?.Transfer??0)}),{cash:0,pos:0,transfer:0});
 const cashCorrection=correctionTotals.cash;
 const cashRefunded=refunds.filter(r=>r.method==='Cash').reduce((sum,r)=>sum+r.refundAmount,0),totalRefunded=refunds.reduce((sum,r)=>sum+r.refundAmount,0);
 const summary=salesSummary(records),openingCash=opening?.countedCash??0;
 return {...summary,pos:summary.pos+correctionTotals.pos,transfer:summary.transfer+correctionTotals.transfer,collected:summary.collected+correctionTotals.cash+correctionTotals.pos+correctionTotals.transfer,records,refunds,corrections,cashCorrection,refundIds:[...refunds,...corrections].map(r=>r.id).sort(),cashRefunded,totalRefunded,checkoutIds:records.map(r=>r.id).sort(),openingId:opening?.id??null,openingCash,expectedCash:openingCash+summary.cash+cashCorrection-cashRefunded};
}
