import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,jobBalance,customerBalance} from '../src/domain.mjs';
import {prepareCheckout,applyCheckout,quoteLine,walletBalance,accountToken,applyJobStatus} from '../src/checkout.mjs';
import {applyMaterialEvent} from '../src/materials.mjs';
import {receiptHtml} from '../src/receipts.mjs';
export const actor={id:'10000000-0000-4000-8000-000000000001',label:'Cashier'};
export const customerId='20000000-0000-4000-8000-000000000001',materialId='30000000-0000-4000-8000-000000000001',serviceId='40000000-0000-4000-8000-000000000001';
export const fixture=()=>({...emptyLedger(),customers:[{id:customerId,name:'Customer',phone:'080111',address:'Road',creditLimit:0,archived:false,version:1}],materials:[{id:materialId,name:'Paper',available:10,measurementUnit:'sheet',requireSize:false,archived:false,version:1,createdBy:actor.id,modifiedBy:actor.id}],services:[{id:serviceId,description:'Printing',materialId,price:10000,version:1,archived:false}]});
export const job=(quantity=1)=>({id:crypto.randomUUID(),serviceId,description:'Print job',quantity,source:'WhatsApp',sourceNote:'customer file'});
export const checkout=(ledger,lines,cash=0,extra={})=>prepareCheckout(ledger,{customerId,lines,cashReceived:cash,useWallet:true,method:'Cash',paidOn:'2026-10-06',reference:'',...extra},actor);
test('Negative stock, overpayment wallet, retry and restocking preserve the exact ledger',()=>{
 const base=fixture(),event=checkout(base,[job(60)],700000),next=applyCheckout(base,event);
 assert.equal(next.materials[0].available,-50);assert.equal(walletBalance(next,customerId),100000);assert.equal(customerBalance(next,customerId),0);
 assert.equal(next.materialHistory[0].jobId,event.data.jobs[0].id);assert.equal(next.materialHistory[0].checkoutId,event.id);assert.equal(next.materialHistory[0].action,'material.job_used');
 assert.deepEqual(applyCheckout(next,event),next);assert.equal(base.materials[0].available,10);
 const restock={id:crypto.randomUUID(),kind:'material.stock_added',data:{id:materialId,baseVersion:2,quantity:100,reason:'Restocking',modifiedBy:actor.id,modifiedByLabel:actor.label,modifiedAt:'2026-10-06T13:00:00Z'}};
 const stocked=applyMaterialEvent(next,restock);assert.equal(stocked.materials[0].available,50);
 const walletEvent=checkout(stocked,[job(5)]),paid=applyCheckout(stocked,walletEvent);assert.equal(walletEvent.data.walletUsed,50000);assert.equal(walletEvent.data.cashReceived,0);assert.equal(walletBalance(paid,customerId),50000);assert.equal(jobBalance(paid,paid.jobs[1]).outstanding,0);
});
test('One payment covers several old jobs and override changes individual allocations',()=>{
 let ledger=fixture();const a=checkout(ledger,[job(3)]);ledger=applyCheckout(ledger,a);const b=checkout(ledger,[job(4)]);ledger=applyCheckout(ledger,b);
 const payment=checkout(ledger,[],50000);assert.deepEqual(payment.data.allocations,[{jobId:a.data.jobs[0].id,amount:30000},{jobId:b.data.jobs[0].id,amount:20000}]);
 const updated=applyCheckout(ledger,payment);assert.equal(customerBalance(updated,customerId),20000);
 const override=checkout(ledger,[],20000,{override:[{jobId:b.data.jobs[0].id,amount:20000}]});assert.equal(override.data.allocations[0].jobId,b.data.jobs[0].id);
 assert.throws(()=>checkout(ledger,[],10000,{override:[{jobId:b.data.jobs[0].id,amount:20000}]}),/exceed/);
});
test('A stale customer balance cannot spend the same wallet credit twice',()=>{
 const base=applyCheckout(fixture(),checkout(fixture(),[],50000));const one=checkout(base,[job(4)]),two=checkout(base,[job(4)]);
 const used=applyCheckout(base,one);assert.throws(()=>applyCheckout(used,two),/account changed/);assert.equal(walletBalance(used,customerId),10000);
 assert.notEqual(accountToken(base,customerId),accountToken(used,customerId));
});
test('Sizes use exact decimal arithmetic and only round currency once',()=>{
 const ledger=fixture();ledger.materials[0].requireSize=true;ledger.services[0].price=101;
 const quoted=quoteLine(ledger,{...job('1.5'),width:'2.125',height:'0.5'});assert.equal(quoted.materialNeeded,1.594);assert.equal(quoted.amount,161);
 assert.throws(()=>quoteLine(ledger,{...job('1.0001'),width:1,height:1}),/three decimal/);
});
test('A later invalid cart item leaves jobs, stock, money and audit untouched',()=>{
 const base=fixture(),before=JSON.stringify(base);assert.throws(()=>checkout(base,[job(1),{...job(2),serviceId:'missing'}]),/active service/);assert.equal(JSON.stringify(base),before);
 const event=checkout(base,[job(1)]);event.data.total++;assert.throws(()=>applyCheckout(base,event),/amounts changed/);assert.equal(JSON.stringify(base),before);
});
test('Credit limit warns in the UI and does not prevent creation; status transitions are versioned',()=>{
 const base=fixture(),created=applyCheckout(base,checkout(base,[job(2)]));assert.equal(customerBalance(created,customerId),20000);
 const progress={id:crypto.randomUUID(),kind:'job.status_changed',data:{id:created.jobs[0].id,status:'In Queue',baseVersion:1,modifiedBy:actor.id,modifiedByLabel:actor.label,modifiedAt:new Date().toISOString()}};
 const queued=applyJobStatus(created,progress);assert.equal(queued.jobs[0].productionStatus,'In Queue');assert.deepEqual(applyJobStatus(queued,progress),queued);
 assert.throws(()=>applyJobStatus(queued,{...progress,id:crypto.randomUUID()}),/latest job status/);
});
test('Receipts preserve each job allocation and escape customer-entered HTML',()=>{
 const event=checkout(fixture(),[{...job(2),description:'<script>alert(1)</script>'}],10000),html=receiptHtml(event.data,'Shop <script>');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Paid now'));assert.ok(html.includes('Wallet balance'));
});

test('Reviewed checkout rebases later pending wallet payments on the latest account',async()=>{
 const {replacePendingCheckout}=await import('../src/checkout-conflicts.mjs');let local=fixture();const first=checkout(local,[job(2)]);local=applyCheckout(local,first);const second=checkout(local,[job(3)],10000);local=applyCheckout(local,second);
 const remote=applyCheckout(fixture(),checkout(fixture(),[],10000));const replacement=prepareCheckout(remote,{customerId,lines:first.data.jobs,cashReceived:0,useWallet:true,method:'Cash',paidOn:'2026-10-06',reference:''},actor);
 const resolved=replacePendingCheckout({ledger:local,pending:[first,second]},remote,first.id,replacement);assert.equal(resolved.pending.length,2);assert.equal(resolved.pending[0].id,replacement.id);assert.equal(resolved.ledger.jobs.length,2);assert.equal(customerBalance(resolved.ledger,customerId),30000);assert.equal(resolved.ledger.checkouts.some(r=>r.id===first.id),false);
});
