import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyLedger,applyEvent} from '../src/domain.mjs';
import {makeExpenseEvent,expensePaid,expenseStatus,expenseSummary} from '../src/expenses.mjs';
import {resolveExpenseState} from '../src/expense-conflicts.mjs';
const actor={id:'staff',label:'Staff'};
const stock=(l,id,available=0)=>applyEvent(l,{id:randomUUID(),kind:'material.created',data:{id,name:id,available,measurementUnit:'sheet',requireSize:false,modifiedBy:'staff',modifiedByLabel:'Staff',modifiedAt:'2026-10-07T12:00:00Z'}});
const data=(materials=[],patch={})=>({description:'Paper purchase',category:'Materials',incurredOn:'2026-10-07',amount:2500000,payee:'Supplier',note:'',receiptReference:'INV-1',materials,...patch});
const line=(id,quantity)=>({materialId:id,name:id,measurementUnit:'sheet',quantity});
const pay=(amount,paidOn='2026-10-07')=>({id:randomUUID(),amount,paidOn,method:'Cash',source:'Business cash',reference:''});
const event=(kind,d,existing)=>makeExpenseEvent(kind,d,existing,actor,randomUUID);
test('purchase, job consumption, edit and void adjust only their stock contributions',()=>{
 let l=stock(emptyLedger(),'paper',-50);
 const e=event('expense.created',data([line('paper',100)],{payment:pay(500000)}));l=applyEvent(l,e);
 assert.equal(l.materials[0].available,50);assert.equal(expenseStatus(l.expenses[0]),'Partly paid');assert.equal(l.materialHistory.at(-1).expenseId,l.expenses[0].id);
 assert.deepEqual(applyEvent(l,e),l,'Retry does not duplicate stock or payment');
 l=applyEvent(l,{id:randomUUID(),kind:'material.stock_set',data:{id:'paper',baseVersion:l.materials[0].version,quantity:49,reason:'Job used one',modifiedBy:'staff',modifiedByLabel:'Staff',modifiedAt:'2026-10-07T13:00:00Z'}});
 l=applyEvent(l,event('expense.updated',data([line('paper',120)],{amount:3000000}),l.expenses[0]));
 assert.equal(l.materials[0].available,69);assert.equal(expensePaid(l.expenses[0]),500000);
 l=applyEvent(l,event('expense.voided',{reason:'Purchase returned'},l.expenses[0]));assert.equal(l.materials[0].available,-51);assert.equal(expenseStatus(l.expenses[0]),'Voided');assert.equal(l.expenses[0].materials[0].quantity,120);assert.equal(expenseSummary(l).incurred,0);assert.equal(expenseSummary(l).paid,500000,'Voiding does not invent a cash refund');
});
test('mixed material purchases support replacing and removing stock lines',()=>{
 let l=stock(stock(emptyLedger(),'paper',10),'vinyl',20);
 l=applyEvent(l,event('expense.created',data([line('paper',5.125),line('vinyl',2.5)])));
 assert.deepEqual(l.materials.map(m=>m.available),[15.125,22.5]);
 l=applyEvent(l,event('expense.updated',data([line('vinyl',3)]),l.expenses[0]));assert.deepEqual(l.materials.map(m=>m.available),[10,23]);
 l=applyEvent(l,event('expense.updated',data([]),l.expenses[0]));assert.deepEqual(l.materials.map(m=>m.available),[10,20]);
});
test('payments remain independent of stock and cannot overpay or reduce cost below paid',()=>{
 let l=stock(emptyLedger(),'paper');l=applyEvent(l,event('expense.created',data([line('paper',10)])));
 const originalStock=l.materials[0],p=event('expense.payment_recorded',{payment:pay(2500000)},l.expenses[0]);l=applyEvent(l,p);
 assert.deepEqual(l.materials[0],originalStock);assert.equal(expenseStatus(l.expenses[0]),'Paid');assert.deepEqual(applyEvent(l,p),l);
 assert.throws(()=>applyEvent(l,event('expense.payment_recorded',{payment:pay(1)},l.expenses[0])),/exceeds/);
 assert.throws(()=>applyEvent(l,event('expense.updated',data([line('paper',10)],{amount:100}),l.expenses[0])),/less than/);
});
test('invalid material, quantity, event reuse and dates reject the complete local operation',()=>{
 let l=stock(emptyLedger(),'paper',10);const initial=structuredClone(l);
 for(const lines of [[line('paper',2),line('missing',1)],[line('paper',2),line('paper',1)],[line('paper',-2)],[line('paper',0.0001)]])assert.throws(()=>applyEvent(l,event('expense.created',data(lines))));
 assert.deepEqual(l,initial);
 for(const patch of [{amount:0},{amount:1.5},{incurredOn:'2026-02-30'},{category:''}])assert.throws(()=>applyEvent(l,event('expense.created',data([],patch))));
 const e=event('expense.created',data([line('paper',1)]));l=applyEvent(l,e);assert.throws(()=>applyEvent(l,{...e,data:{...e.data,amount:1}}),/Operation ID/);
 const stale=event('expense.updated',data([line('paper',5)]),l.expenses[0]);l=applyEvent(l,event('expense.payment_recorded',{payment:pay(100)},l.expenses[0]));assert.throws(()=>applyEvent(l,stale),/changed elsewhere/);
});
test('concurrent expense review retains remote payments and applies only stock difference',()=>{
 let cloud=stock(emptyLedger(),'paper',10);cloud=applyEvent(cloud,event('expense.created',data([line('paper',100)])));
 const local=event('expense.updated',data([line('paper',120)]),cloud.expenses[0]);const state={ledger:applyEvent(cloud,local),pending:[local]};
 cloud=applyEvent(cloud,event('expense.payment_recorded',{payment:pay(1000000)},cloud.expenses[0]));
 const resolved=resolveExpenseState(state,cloud,state.ledger.expenses[0].id,'local',randomUUID);
 assert.equal(resolved.ledger.materials[0].available,130);assert.equal(expensePaid(resolved.ledger.expenses[0]),1000000);assert.equal(resolved.pending[0].data.baseVersion,2);
 const adopted=resolveExpenseState(state,cloud,state.ledger.expenses[0].id,'cloud',randomUUID);assert.equal(adopted.ledger.materials[0].available,110);assert.equal(adopted.pending.length,0);
});
test('period summary uses incurred dates for cost and payment dates for cash',()=>{
 let l=emptyLedger();l=applyEvent(l,event('expense.created',data([],{incurredOn:'2026-09-01',payment:pay(1000000,'2026-10-07')})));
 l={...l,jobs:[{id:'job',amount:4500000,createdAt:'2026-10-07T12:00:00Z'}]};
 const s=expenseSummary(l,'2026-10-01','2026-10-31');assert.deepEqual(s,{incurred:0,paid:1000000,unpaid:0,sales:4500000,result:4500000});
});
test('unit changes block stock corrections and preserve the original ledger',()=>{
 let l=stock(emptyLedger(),'paper',10);l=applyEvent(l,event('expense.created',data([line('paper',100)])));
 l={...l,materials:l.materials.map(m=>({...m,measurementUnit:'roll'}))};const original=structuredClone(l);
 assert.throws(()=>applyEvent(l,event('expense.voided',{reason:'Returned'},l.expenses[0])),/unit changed/);assert.deepEqual(l,original);
});
