import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultOptions,validateOptions,validateWorkflow} from '../src/business-options.mjs';
import {defaultBranding,validateBranding} from '../src/business-branding.mjs';
import {emptyLedger} from '../src/domain.mjs';
import {prepareCheckout,applyCheckout,applyJobStatus} from '../src/checkout.mjs';
import {progressEvents} from '../src/job-progress.mjs';
import {salesSummary} from '../src/my-sales.mjs';
import {receiptHtml} from '../src/receipts.mjs';
const actor={id:'10000000-0000-4000-8000-000000000001',label:'Manager'};
const customerId='20000000-0000-4000-8000-000000000001',serviceId='40000000-0000-4000-8000-000000000001';
const workflow=['Added','Design','Approval','Finishing','Completed','Collected'];
const fixture=()=>({...emptyLedger(),customers:[{id:customerId,name:'Customer',phone:'080111',address:'Road',creditLimit:0,archived:false,version:1}],services:[{id:serviceId,description:'Design',materialId:null,price:10000,version:1,archived:false}]});
const event=base=>prepareCheckout(base,{customerId,lines:[{id:'30000000-0000-4000-8000-000000000001',serviceId,description:'Artwork',quantity:1,source:'Instagram DM',sourceNote:'',workflow}],cashReceived:10000,useWallet:true,method:'Transfer',methodLabel:'Opay <Bank>',paidOn:'2026-10-08',reference:''},actor,'50000000-0000-4000-8000-000000000001','2026-10-08T12:00:00Z');
test('older saved profiles acquire defaults without losing business details',()=>{
 const profile=defaultBranding();delete profile.options;profile.businessName='Mairoba';
 const saved=validateBranding(profile);assert.deepEqual(saved.options,defaultOptions());assert.equal(saved.businessName,'Mairoba');assert.equal(profile.options,undefined);
});
test('dropdown names are bounded, unique and payment accounting stays explicit',()=>{
 const options=defaultOptions();options.paymentMethods.push({label:' Opay ',kind:'Transfer',enabled:true});assert.equal(validateOptions(options).paymentMethods.at(-1).label,'Opay');
 for(const patch of [{expenseCategories:['Fuel',' fuel ']},{materialUnits:[]},{jobSources:['a\nunsafe']},{paymentMethods:[{label:'Opay',kind:'Other',enabled:true}]},{paymentMethods:[{label:'Cash',kind:'Cash',enabled:false}]}])assert.throws(()=>validateOptions({...defaultOptions(),...patch}));
});
test('custom workflows retain completion boundaries and disallow duplicate stages',()=>{
 assert.deepEqual(validateWorkflow(workflow),workflow);
 for(const invalid of [['Design','Completed','Collected'],['Added','Collected','Completed'],['Added','design','Design','Completed','Collected'],['Added','Collected']])assert.throws(()=>validateWorkflow(invalid));
});
test('custom payment labels survive replay and receipts without changing financial buckets',()=>{
 const base=fixture(),operation=event(base),ledger=applyCheckout(base,operation);
 assert.equal(ledger.checkouts[0].methodLabel,'Opay <Bank>');assert.equal(ledger.payments[0].methodLabel,'Opay <Bank>');assert.equal(salesSummary(ledger.checkouts).transfer,10000);assert.equal(salesSummary(ledger.checkouts).cash,0);
 assert.ok(receiptHtml(ledger.checkouts[0],'Mairoba').includes('Opay &lt;Bank&gt;'));assert.deepEqual(applyCheckout(ledger,operation),ledger);
});
test('saved workflow advances in order and is independent of later business defaults',()=>{
 let ledger=applyCheckout(fixture(),event(fixture()));const job=ledger.jobs[0];
 const options=defaultOptions();options.jobStages=['Added','Printing','Completed','Collected'];assert.deepEqual(job.workflow,workflow);
 const steps=progressEvents(job,'Completed',actor);assert.deepEqual(steps.map(item=>item.data.status),['Design','Approval','Finishing','Completed']);
 assert.throws(()=>applyJobStatus(ledger,steps.at(-1)));for(const step of steps)ledger=applyJobStatus(ledger,step);
 assert.equal(ledger.jobs[0].productionStatus,'Completed');ledger=applyJobStatus(ledger,progressEvents(ledger.jobs[0],'Collected',actor)[0]);assert.equal(ledger.jobs[0].productionStatus,'Collected');
});
