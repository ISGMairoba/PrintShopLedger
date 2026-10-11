import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,customerBalance} from '../src/domain.mjs';
import {customerStatement,statementSections,sectionsToCsv,reportFileName} from '../src/reports.mjs';
import {canAccessPage,validatePageAccess,defaultPageAccess} from '../src/page-access.mjs';

function sample(){
 const l=emptyLedger();
 l.customers=[{id:'ada',name:'Ada Okafor',phone:'0801',address:'Wuse',creditLimit:50000,archived:false,createdAt:'2026-01-01'},{id:'bola',name:'Bola',phone:'0802',address:'',creditLimit:0,createdAt:'2026-01-01'}];
 l.jobs=[
  {id:'old-owing',customerId:'ada',service:'Printing',description:'Old flyers',amount:5000,createdAt:'2026-09-20T10:00:00Z',productionStatus:'Collected'},
  {id:'old-paid',customerId:'ada',service:'Binding',description:'Old binding',amount:2000,createdAt:'2026-09-21T10:00:00Z'},
  {id:'oct-1',customerId:'ada',service:'Banner',description:'Shop banner',amount:12000,createdAt:'2026-10-02T09:00:00Z',productionStatus:'Printing'},
  // 23:30 UTC on Oct 31 is Nov 1 in Lagos, so this job falls after an October period.
  {id:'nov-1',customerId:'ada',service:'Cards',description:'Business cards',amount:3000,createdAt:'2026-10-31T23:30:00Z'},
  {id:'other',customerId:'bola',service:'Printing',description:'Not Ada',amount:999,createdAt:'2026-10-03'}
 ];
 l.payments=[
  {id:'p-sep',customerId:'ada',amount:2000,method:'Cash',paidOn:'2026-09-21',createdAt:'2026-09-21T10:00:00Z',reference:'',allocations:[{jobId:'old-paid',amount:2000}]},
  {id:'p-oct',customerId:'ada',amount:10000,walletUsed:0,walletAdded:1000,method:'Transfer',methodLabel:'GTBank transfer',paidOn:'2026-10-05',createdAt:'2026-10-05T10:00:00Z',reference:'=SUM(A1)',allocations:[{jobId:'oct-1',amount:9000}]},
  {id:'r-oct',customerId:'ada',refundId:'adj-refund',amount:0,walletUsed:400,walletAdded:0,method:'Cash',paidOn:'2026-10-06',createdAt:'2026-10-06T10:00:00Z',reference:'Refund ADJ',allocations:[]},
  {id:'p-bola',customerId:'bola',amount:999,method:'Cash',paidOn:'2026-10-03',createdAt:'2026-10-03',allocations:[{jobId:'other',amount:999}]}
 ];
 l.saleAdjustments=[
  {id:'adj-refund',customerId:'ada',jobId:'oct-1',action:'sale.refunded',changedAt:'2026-10-06T10:00:00Z',before:{amount:12000},after:{amount:12000},refundAmount:400,creditReleased:0,reason:'Overpaid',changedByLabel:'Manager'},
  {id:'child',groupId:'adj-refund',customerId:'ada',jobId:'oct-1',action:'payment.corrected',changedAt:'2026-10-06T10:00:00Z',before:{amount:1},after:{amount:1},refundAmount:0,creditReleased:0,reason:'child',changedByLabel:'Manager'}
 ];
 return l;
}

test('Statement lists only this customer and only period activity, by Lagos day',()=>{
 const s=customerStatement(sample(),'ada','2026-10-01','2026-10-31',{now:'2026-11-02T00:00:00Z'});
 assert.deepEqual(s.jobs.map(j=>j.id),['oct-1']);
 assert.deepEqual(s.earlierOwing.map(j=>j.id),['old-owing']);
 assert.deepEqual(s.laterOwing.map(j=>j.id),['nov-1']);
 assert.deepEqual(s.payments.map(p=>p.id),['p-oct','r-oct']);
 assert.deepEqual(s.adjustments.map(a=>a.id),['adj-refund'],'grouped child corrections are folded into their parent');
 assert.equal(s.payments[0].method,'GTBank transfer');
 assert.equal(s.payments[1].refund,true);
 assert.equal(s.customer.name,'Ada Okafor');
});

test('Statement totals reconcile with the balances the app already shows',()=>{
 const l=sample();
 const s=customerStatement(l,'ada','2026-10-01','2026-10-31');
 assert.equal(s.totals.charged,12000);
 assert.equal(s.totals.received,10000,'refund rows are not money received');
 assert.equal(s.totals.refunded,400);
 assert.equal(s.totals.owedNow,customerBalance(l,'ada'));
 assert.equal(s.totals.owedNow,5000+3000+3000);
 assert.equal(s.totals.creditNow,600);
 // Every job still owing is shown somewhere, so the listed outstanding adds up to the total owed.
 const listed=[...s.jobs,...s.earlierOwing,...s.laterOwing].reduce((n,j)=>n+j.outstanding,0);
 assert.equal(listed,s.totals.owedNow);
});

test('Hiding fully paid jobs keeps period totals unchanged',()=>{
 const l=sample();l.payments[1].allocations=[{jobId:'oct-1',amount:12000}];l.payments[1].amount=13000;
 const all=customerStatement(l,'ada','2026-10-01','2026-10-31');
 const unpaid=customerStatement(l,'ada','2026-10-01','2026-10-31',{includePaid:false});
 assert.equal(all.jobs.length,1);assert.equal(unpaid.jobs.length,0);
 assert.equal(unpaid.totals.charged,all.totals.charged);
});

test('Statement rejects bad input',()=>{
 assert.throws(()=>customerStatement(sample(),'nobody','2026-10-01','2026-10-31'),/customer/i);
 assert.throws(()=>customerStatement(sample(),'ada','2026-10-31','2026-10-01'),/date range/i);
});

test('CSV quotes text safely and blocks spreadsheet formulas',()=>{
 const s=customerStatement(sample(),'ada','2026-10-01','2026-10-31');
 const csv=sectionsToCsv(['Shop, Ltd','Customer statement'],statementSections(s));
 assert.match(csv,/^"Shop, Ltd"\r\n/);
 assert.match(csv,/'=SUM\(A1\)/,'formula-looking text is neutralised');
 assert.match(csv,/120\.00/,'amounts are naira with two decimals');
 assert.ok(!csv.includes('Not Ada'));
 assert.match(csv,/Payments in this period\r\n/);
 const empty=sectionsToCsv([],[{title:'Nothing',columns:['A'],rows:[]}]);
 assert.match(empty,/None/);
 assert.equal(sectionsToCsv([],[{title:'Neg',columns:['A'],rows:[['-50.00']]}]).includes("'-50.00"),false,'negative numbers stay numbers');
});

test('File names drop characters that break downloads',()=>{
 assert.equal(reportFileName('Statement','Ada/Okafor: "VIP"','2026-10-01 to 2026-10-31'),'Statement - AdaOkafor VIP - 2026-10-01 to 2026-10-31');
});

test('Reports follow Dashboard access: Admin+ by default, off when Dashboard is off, never for Cashier',()=>{
 assert.equal(canAccessPage('Reports',1),false);
 for(const rank of [2,3,4])assert.equal(canAccessPage('Reports',rank),true);
 const custom=defaultPageAccess();custom['2']=custom['2'].filter(p=>p!=='Dashboard');
 assert.equal(canAccessPage('Reports',2,custom),false);
 assert.equal(canAccessPage('Reports',3,custom),true);
 // Reports is never stored in saved settings, so older saved settings keep working.
 const saved=defaultPageAccess();saved['1'].push('Reports');assert.throws(()=>validatePageAccess(saved));
 assert.equal(canAccessPage('toString',4),false);
});
