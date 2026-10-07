import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,applyEvent,jobBalance} from '../src/domain.mjs';
import {prepareCheckout,quoteLine} from '../src/checkout.mjs';
import {receiptHtml,receiptIntegrityError} from '../src/receipts.mjs';
const actor={id:'staff',label:'Staff'},date='2026-10-07T12:00:00Z';
const customer={id:'customer',name:'Customer',phone:'080111',address:'',creditLimit:0,archived:false,version:1};
const svc={id:'pressing',description:'Cap pressing',price:50000,materialId:null,archived:false,version:1};
const fixture=()=>({...emptyLedger(),customers:[customer],services:[svc]});
const line={id:'press-job',serviceId:'pressing',description:'Customer caps',quantity:5,source:'In shop / USB'};
const checkout=(ledger,lines,patch={})=>prepareCheckout(ledger,{customerId:'customer',lines,cashReceived:50000,useWallet:false,method:'Cash',paidOn:'2026-10-07',reference:'',...patch},actor,crypto.randomUUID(),date);
test('pressing requires no stock catalogue or size and retains individual job payment and receipt',()=>{
 const base=fixture(),event=checkout(base,[{...line,width:999,height:999}]);
 assert.equal(event.data.total,250000);assert.equal(event.data.jobs[0].materialNeeded,0);assert.equal(event.data.jobs[0].materialId,null);assert.equal(event.data.jobs[0].width,null);assert.equal(event.data.jobs[0].height,null);assert.equal(event.data.jobs[0].requireSize,false);
 const next=applyEvent(base,event);assert.deepEqual(next.materials,[]);assert.deepEqual(next.materialHistory,[]);assert.equal(jobBalance(next,next.jobs[0]).outstanding,200000);assert.equal(receiptIntegrityError(next.checkouts[0]),'');assert.match(receiptHtml(next.checkouts[0],'Shop'),/Cap pressing/);assert.deepEqual(applyEvent(next,event),next);
});
test('mixed checkout deducts only linked material and keeps both job prices and allocations',()=>{
 const base=fixture();base.materials=[{id:'paper',name:'Paper',measurementUnit:'sheet',available:10,requireSize:false,archived:false,version:1}];base.services.push({...svc,id:'printing',description:'Printing',materialId:'paper',price:10000});
 const next=applyEvent(base,checkout(base,[line,{...line,id:'print-job',serviceId:'printing',quantity:2}],{cashReceived:270000}));
 assert.equal(next.materials[0].available,8);assert.equal(next.materials[0].version,2);assert.equal(next.materialHistory.length,1);assert.equal(next.materialHistory[0].jobId,'print-job');assert.equal(next.jobs.length,2);assert.equal(next.payments[0].allocations.length,2);assert.equal(next.checkouts[0].total,270000);
});
test('a changed stock link or spoofed material usage requires checkout review',()=>{
 const base=fixture(),event=checkout(base,[line]);
 const changed={...base,materials:[{id:'paper',archived:false,requireSize:false,measurementUnit:'sheet'}],services:[{...svc,materialId:'paper',version:2}]};
 assert.throws(()=>applyEvent(changed,event),/material changed/);
 for(const patch of [{materialId:'paper'},{materialNeeded:1},{requireSize:true}])assert.throws(()=>applyEvent(base,{...event,data:{...event.data,jobs:[{...event.data.jobs[0],...patch}]}}),/material changed/);
 assert.throws(()=>quoteLine({...base,services:[{...svc,materialId:'missing'}]},line),/active base material/);
 assert.throws(()=>quoteLine(base,{...line,quantity:0}),/greater than zero/);
});
