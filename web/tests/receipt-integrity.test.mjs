import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger} from '../src/domain.mjs';
import {applyCheckout,prepareCheckout} from '../src/checkout.mjs';
import {receiptHtml,receiptIntegrityError} from '../src/receipts.mjs';
const job={id:'job',customerId:'customer',service:'Banner',description:'Shop banner',amount:4500000,createdAt:'2026-10-06T10:00:00Z'};
const initial={...emptyLedger(),customers:[{id:'customer',name:'Customer',phone:'080111',address:'',archived:false}],jobs:[job]};
const input={customerId:'customer',lines:[],cashReceived:500000,useWallet:false,method:'Cash',paidOn:'2026-10-06',reference:''};
const event=()=>prepareCheckout(initial,input,{id:'cashier',label:'Cashier'},'receipt','2026-10-06T12:00:00Z');
test('45000 job with 5000 received prints 45000 amount and 40000 outstanding',()=>{
 const e=event(),saved=applyCheckout(initial,e),r=saved.checkouts[0];
 assert.equal(r.jobBalances[0].amount,4500000);assert.equal(r.jobBalances[0].paidThisCheckout,500000);assert.equal(r.jobBalances[0].outstandingAfter,4000000);assert.equal(receiptIntegrityError(r),'');
 const html=receiptHtml(r,'Shop');for(const amount of ['₦45,000.00','₦5,000.00','₦40,000.00'])assert.ok(html.includes(amount));assert.ok(!html.includes('₦80,000.00'));
 const later=prepareCheckout(saved,{...input,cashReceived:1000000},{id:'cashier',label:'Cashier'},'later','2026-10-07T12:00:00Z');
 const next=applyCheckout(saved,later);assert.equal(receiptHtml(next.checkouts[0],'Shop'),html,'Later payments do not change an earlier receipt');
});
test('inconsistent 80000 receipt amount is flagged and never rendered as a confirmed amount',()=>{
 const r=event().data;r.jobBalances[0].amount=8000000;
 assert.match(receiptIntegrityError(r),/payment breakdown/);const html=receiptHtml(r,'Shop');assert.ok(html.includes('Needs verification'));assert.ok(!html.includes('₦80,000.00'));
});

test('a conflicting new-job total is also hidden and blocked from printing',()=>{
 const r=event().data;r.total=8000000;assert.match(receiptIntegrityError(r),/job total/);assert.ok(!receiptHtml(r,'Shop').includes('₦80,000.00'));
});
