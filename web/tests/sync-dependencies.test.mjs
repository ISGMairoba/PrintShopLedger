import test from 'node:test';
import assert from 'node:assert/strict';
import {eventResources,blockedWork,assertIndependent,projectPending} from '../src/sync-dependencies.mjs';
import {emptyLedger,applyEvent} from '../src/domain.mjs';
import {prepareCheckout,applyCheckout} from '../src/checkout.mjs';
const actor={id:'cashier',label:'Cashier'};
const base=()=>({...emptyLedger(),customers:['a','b','c'].map(id=>({id,name:id,phone:id,address:'',creditLimit:0,archived:false,version:1})),materials:[{id:'paper',name:'Paper',available:100,measurementUnit:'sheet',requireSize:false,archived:false,version:1},{id:'film',name:'Film',available:100,measurementUnit:'sheet',requireSize:false,archived:false,version:1}],services:[{id:'print',description:'Print',materialId:'paper',price:10000,archived:false,version:1},{id:'laminate',description:'Laminate',materialId:'film',price:10000,archived:false,version:1},{id:'design',description:'Design',materialId:null,price:10000,archived:false,version:1}]});
const sale=(ledger,id,customer,service='print')=>prepareCheckout(ledger,{customerId:customer,lines:[{id:'job-'+id,serviceId:service,description:id,quantity:10,source:'WhatsApp'}],cashReceived:100000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},actor,id,'2026-10-08T13:00:00Z');
test('a held sale blocks shared stock and customer balances but allows unrelated sales',()=>{
 const ledger=base(),first=sale(ledger,'one','a'),state={ledger:applyCheckout(ledger,first),pending:[first],syncConflicts:{one:'Stock count changed'}};
 assert.throws(()=>assertIndependent(state,sale(state.ledger,'two','b')),/awaiting Admin/);
 assert.throws(()=>assertIndependent(state,sale(state.ledger,'two','a','laminate')),/awaiting Admin/);
 assert.doesNotThrow(()=>assertIndependent(state,sale(state.ledger,'two','b','laminate')));
 assert.doesNotThrow(()=>assertIndependent(state,sale(state.ledger,'two','b','design')));
});
test('later jobs propagate the hold to their own customer balances, without blocking independent queued work',()=>{
 let ledger=base();const first=sale(ledger,'one','a');ledger=applyCheckout(ledger,first);const next=sale(ledger,'two','b');ledger=applyCheckout(ledger,next);const independent=sale(ledger,'three','c','laminate');ledger=applyCheckout(ledger,independent);
 const state={ledger,pending:[first,next,independent],syncConflicts:{one:'Stock count changed'}};assert.deepEqual([...blockedWork(state).eventIds],['one','two']);assert.throws(()=>assertIndependent(state,sale(ledger,'four','b','design')),/awaiting Admin/);assert.doesNotThrow(()=>assertIndependent(state,sale(ledger,'four','c','design')));
});
test('cloud refresh preserves held offline receipts while updating unaffected records',()=>{
 const before=base(),first=sale(before,'one','a'),local=applyCheckout(before,first),cloud=applyEvent(before,{id:'count',kind:'material.stock_set',data:{id:'paper',baseVersion:1,quantity:90,reason:'Count',modifiedBy:'admin',modifiedByLabel:'Admin',modifiedAt:'2026-10-08T16:00:00Z'}});cloud.materials[1].available=125;
 const result=projectPending(cloud,{ledger:local,pending:[first],syncConflicts:{one:'Stock count changed'}});assert.equal(result.checkouts[0].id,'one');assert.equal(result.payments[0].amount,100000);assert.equal(result.materials.find(m=>m.id==='film').available,125);assert.equal(result.materials.find(m=>m.id==='paper').available,90);
 assert.deepEqual(projectPending(cloud,{ledger:local,pending:[],syncConflicts:{}}),cloud);
});
test('expense stock changes and job progress use the same dependency holds',()=>{
 const ledger=base();ledger.expenses=[{id:'expense',materials:[{materialId:'paper'}]}];const event={id:'expense-event',kind:'expense.updated',data:{id:'expense',materials:[{materialId:'film'}]}};assert.deepEqual([...eventResources(event,ledger)].sort(),['expense:expense','material:film','material:paper']);
});

import {acknowledgeReviews} from '../src/sync-dependencies.mjs';
test('a remotely replaced receipt is acknowledged without duplicating money beside later held sales',()=>{
 const before=base(),first=sale(before,'one','a');let local=applyCheckout(before,first);const second=sale(local,'two','a');local=applyCheckout(local,second);
 const reviewed=prepareCheckout(before,{customerId:'a',lines:first.data.jobs,cashReceived:50000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},actor,'reviewed','2026-10-08T13:00:00Z');const cloud=applyCheckout(before,reviewed);
 const state=acknowledgeReviews({ledger:local,pending:[first,second],syncConflicts:{one:'Balances changed'}},cloud,[{event_id:'one',source:first,replacements:[reviewed]}]);
 state.syncConflicts.two='Balances changed';const projected=projectPending(cloud,state);
 assert.deepEqual(projected.checkouts.map(r=>r.id).sort(),['reviewed','two']);assert.equal(projected.payments.some(p=>p.id==='one'),false);assert.equal(projected.payments.find(p=>p.id==='reviewed').amount,50000);assert.equal(state.pending.length,1);
});
