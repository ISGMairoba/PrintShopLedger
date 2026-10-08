import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,applyEvent} from '../src/domain.mjs';
import {prepareCheckout} from '../src/checkout.mjs';
import {resolveCustomerState} from '../src/customer-conflicts.mjs';
import {resolveServiceState} from '../src/service-conflicts.mjs';
const audit={modifiedBy:'u',modifiedByLabel:'Owner',modifiedAt:'2026-10-08T10:00:00Z'};
function fixture(){
 let ledger=applyEvent(emptyLedger(),{id:'customer-create',kind:'customer.created',data:{id:'customer',name:'Customer',phone:'08012345678',address:'',creditLimit:0,...audit}});
 return applyEvent(ledger,{id:'service-create',kind:'service.created',data:{id:'service',description:'Printing',materialId:null,price:10000,...audit}});
}
function sale(ledger,cash){return prepareCheckout(ledger,{customerId:'customer',lines:[{id:'job',serviceId:'service',description:'Print job',quantity:1,source:'In shop / USB'}],cashReceived:cash,useWallet:false,method:'Cash',paidOn:'2026-10-08'},{id:'u',label:'Owner'},'checkout',audit.modifiedAt);}
test('customer conflict restores and reapplies the customer before its pending sale',()=>{
 const base=fixture();const edit={id:'edit',kind:'customer.updated',data:{id:'customer',baseVersion:1,name:'Updated customer',phone:'08012345678',address:'',creditLimit:0,...audit}};
 const local=applyEvent(base,edit),checkout=sale(local,10000);
 const cloud=applyEvent(base,{id:'archive',kind:'customer.archived',data:{id:'customer',baseVersion:1,...audit}});
 let id=0;const next=resolveCustomerState({ledger:applyEvent(local,checkout),pending:[edit,checkout]},cloud,'customer','local',()=> 'review-'+ ++id,audit.modifiedAt);
 assert.deepEqual(next.pending.map(e=>e.kind),['customer.restored','customer.updated','checkout.completed']);
 assert.equal(next.ledger.customers[0].name,'Updated customer');assert.equal(next.ledger.checkouts[0].total,10000);assert.equal(next.ledger.payments[0].amount,10000);
 assert.deepEqual(next.ledger,next.pending.reduce(applyEvent,cloud));
});

test('service conflict review cannot silently change a pending sale amount',()=>{
 const base=fixture();const edit={id:'edit',kind:'service.updated',data:{id:'service',baseVersion:1,description:'Printing',price:20000,materialId:null,...audit}};
 const local=applyEvent(base,edit),checkout=sale(local,20000);
 checkout.data.jobs[0].amount=19999;
 const cloud=applyEvent(base,{id:'remote',kind:'service.updated',data:{...edit.data,price:30000}});
 const state={ledger:local,pending:[edit,checkout]},before=structuredClone(state);
 assert.throws(()=>resolveServiceState(state,cloud,'service','local',null,()=>crypto.randomUUID(),audit.modifiedAt),/Job price or material changed/);
 assert.deepEqual(state,before);
});
test('service conflict reapplies the reviewed price before a sale using that price',()=>{
 const base=fixture();const edit={id:'edit',kind:'service.updated',data:{id:'service',baseVersion:1,description:'Printing',price:20000,materialId:null,...audit}};
 const local=applyEvent(base,edit),checkout=sale(local,20000);
 const cloud=applyEvent(base,{id:'remote',kind:'service.updated',data:{...edit.data,price:30000}});
 let id=0;const next=resolveServiceState({ledger:applyEvent(local,checkout),pending:[edit,checkout]},cloud,'service','local',null,()=> 'review-'+ ++id,audit.modifiedAt);
 assert.deepEqual(next.pending.map(e=>e.kind),['service.updated','checkout.completed']);
 assert.equal(next.ledger.services[0].price,20000);assert.equal(next.ledger.checkouts[0].total,20000);assert.equal(next.ledger.payments[0].amount,20000);
 assert.deepEqual(next.ledger,next.pending.reduce(applyEvent,cloud));
});
