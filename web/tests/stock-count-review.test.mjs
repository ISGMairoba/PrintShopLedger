import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,applyEvent} from '../src/domain.mjs';
import {prepareCheckout,applyCheckout} from '../src/checkout.mjs';
import {replacePendingCheckout} from '../src/checkout-conflicts.mjs';
const actor={id:'u',label:'Cashier'};
const base=()=>({...emptyLedger(),customers:[{id:'customer',name:'Customer',phone:'080111',address:'',creditLimit:0,archived:false,version:1}],materials:[{id:'material',name:'Paper',available:100,measurementUnit:'sheet',requireSize:false,archived:false,version:1}],services:[{id:'service',description:'Printing',materialId:'material',price:10000,archived:false,version:1}]});
const sale=ledger=>prepareCheckout(ledger,{customerId:'customer',lines:[{id:'job',serviceId:'service',description:'Print job',quantity:10,source:'WhatsApp'}],cashReceived:100000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},actor,'sale','2026-10-08T13:00:00Z');
const stock=(kind,id,quantity)=>({id,kind,data:{id:'material',baseVersion:1,quantity,reason:'Test',modifiedBy:'admin',modifiedByLabel:'Admin',modifiedAt:'2026-10-08T16:00:00Z'}});
test('an unseen later physical count blocks an offline sale without changing stock or money',()=>{
 const ledger=base(),offline=sale(ledger),counted=applyEvent(ledger,stock('material.stock_set','count',90));
 assert.throws(()=>applyCheckout(counted,offline),/Stock count changed/);assert.equal(counted.materials[0].available,90);assert.equal(counted.payments.length,0);assert.equal(counted.jobs.length,0);
 const reviewed=sale(counted);assert.equal(reviewed.data.jobs[0].stockCountEventId,'count');assert.equal(applyCheckout(counted,reviewed).materials[0].available,80);
});
test('ordinary restocking can merge with late sales, and acknowledged count retries remain idempotent',()=>{
 const ledger=base(),offline=sale(ledger),restocked=applyEvent(ledger,stock('material.stock_added','delivery',20));assert.equal(applyCheckout(restocked,offline).materials[0].available,110);
 const counted=applyEvent(ledger,stock('material.stock_set','count',90)),operation=sale(counted),saved=applyCheckout(counted,operation);assert.deepEqual(applyCheckout(saved,operation),saved);
});

test('reviewed usage already included in the count preserves stock and still records the sale',()=>{
 const counted=applyEvent(base(),stock('material.stock_set','count',90));
 const normal=sale(counted),reviewed=prepareCheckout(counted,{customerId:'customer',lines:normal.data.jobs,countedMaterialJobs:['job'],cashReceived:100000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},actor,'sale','2026-10-08T13:00:00Z');
 const saved=applyCheckout(counted,reviewed);assert.equal(saved.materials[0].available,90);assert.equal(saved.payments[0].amount,100000);assert.equal(saved.jobs[0].materialNeeded,10);assert.match(saved.materialHistory.at(-1).reason,/Already included/);assert.deepEqual(applyCheckout(saved,reviewed),saved);
});

test('reviewing one sale keeps later unseen stock counts pending for separate review',()=>{
 const ledger=base(),first=sale(ledger),afterFirst=applyCheckout(ledger,first);
 const second=prepareCheckout(afterFirst,{customerId:'customer',lines:[{id:'job2',serviceId:'service',description:'Later job',quantity:5,source:'WhatsApp'}],cashReceived:50000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},actor,'sale2','2026-10-08T14:00:00Z');
 const cloud=applyEvent(ledger,stock('material.stock_set','count',85));
 const reviewed=prepareCheckout(cloud,{customerId:'customer',lines:first.data.jobs,countedMaterialJobs:['job'],cashReceived:100000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},actor,'reviewed','2026-10-08T13:00:00Z');
 const state=replacePendingCheckout({ledger:applyCheckout(afterFirst,second),pending:[first,second]},cloud,first.id,reviewed);
 assert.equal(state.pending[1].data.jobs[0].stockCountEventId,null);
 assert.throws(()=>applyCheckout(applyCheckout(cloud,reviewed),state.pending[1]),/Stock count changed/);
});
