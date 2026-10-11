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

import {filterStatement,statementSections as sections2,transactionRegister,filterTransactions,transactionSections} from '../src/reports.mjs';
import {currency} from '../src/receipts.mjs';
import {validateBranding,defaultBranding,receiptBusiness} from '../src/business-branding.mjs';

test('Statement search and filters narrow records but keep account totals',()=>{
 const s=customerStatement(sample(),'ada','2026-09-01','2026-11-30');
 const banner=filterStatement(s,{query:'banner'});
 assert.deepEqual(banner.jobs.map(j=>j.id),['oct-1']);
 assert.deepEqual(banner.payments.map(p=>p.id),['p-oct'],'payments that paid the matching job are found by job name');
 assert.equal(banner.totals.owedNow,s.totals.owedNow);
 assert.equal(filterStatement(s,{paymentStatus:'Fully paid'}).jobs.map(j=>j.id).join(),'old-paid');
 assert.equal(filterStatement(s,{stage:'Printing'}).jobs.length,1);
 assert.deepEqual(filterStatement(s,{method:'Cash'}).payments.map(p=>p.id),['p-sep','r-oct']);
 const onlyPayments=filterStatement(s,{show:'payments'});
 assert.equal(onlyPayments.jobs.length+onlyPayments.adjustments.length,0);
 assert.equal(sections2(onlyPayments).some(x=>x.title==='Jobs in this period'),false);
 assert.match(filterStatement(s,{query:' cards  business '}).filters[0],/cards  business|cards business/);
 assert.equal(filterStatement(s,{query:'cards business'}).jobs[0]?.id,'nov-1','every search word must match, in any order');
 assert.equal(filterStatement(s,{query:'₦120'},currency).jobs[0]?.id,'oct-1','search understands formatted amounts');
});

test('PDF sections use the app currency format; spreadsheets keep plain numbers',()=>{
 const s=customerStatement(sample(),'ada','2026-10-01','2026-10-31');
 const pdf=sections2(s,{money:currency,unit:''});
 const jobs=pdf.find(x=>x.title==='Jobs in this period');
 assert.equal(jobs.rows[0][5],currency(12000));
 assert.match(jobs.rows[0][5],/₦120\.00/);
 assert.equal(jobs.columns[5],'Amount');
 assert.equal(sections2(s).find(x=>x.title==='Jobs in this period').rows[0][5],'120.00');
});

function activity(){
 const l=sample();
 l.checkouts=[{id:'co-1',createdByLabel:'Cashier Joy',drawerClosingId:'drawer-aaaa1111'}];
 l.jobs[2].checkoutId='co-1';l.payments[1].checkoutId='co-1';
 l.expenses=[{id:'exp-1',description:'Ink',category:'Materials',payee:'Ink Ltd',voided:false,payments:[{id:'ep1',amount:2500,paidOn:'2026-10-04',createdAt:'2026-10-04T08:00:00Z',methodLabel:'Cash',createdByLabel:'Manager'}]}];
 l.materialHistory=[
  {id:'h1',materialId:'m',materialName:'Flex',measurementUnit:'sqm',action:'material.stock_added',beforeAvailable:10,afterAvailable:25,reason:'Restocking',changedBy:'u',changedByLabel:'Manager',changedAt:'2026-10-03T09:00:00Z'},
  {id:'h2',materialId:'m',materialName:'Flex',measurementUnit:'sqm',action:'material.job_used',beforeAvailable:25,afterAvailable:22.5,reason:'',changedByLabel:'Cashier Joy',changedAt:'2026-10-03T10:00:00Z'},
  {id:'h3',materialId:'m',materialName:'Flex',measurementUnit:'sqm',action:'material.updated',beforeAvailable:22.5,afterAvailable:22.5,reason:'Renamed',changedByLabel:'Manager',changedAt:'2026-10-03T11:00:00Z'}
 ];
 l.saleAdjustments.push({id:'adj-fix',customerId:'ada',jobId:'oct-1',action:'sale.corrected',changedAt:'2026-10-07T10:00:00Z',before:{amount:13000},after:{amount:12000},refundAmount:0,creditReleased:0,reason:'Price error',changedByLabel:'Manager'});
 return l;
}

test('Transactions list jobs, money, corrections and stock changes without double counting',()=>{
 const r=transactionRegister(activity(),'2026-10-01','2026-10-31');
 const types=r.rows.map(x=>x.type);
 assert.deepEqual([...new Set(types)].sort(),['Expense payment','Job created','Payment received','Refund paid','Sale correction','Stock change']);
 assert.equal(types.filter(t=>t==='Stock change').length,2,'edits that do not change quantity are left out');
 assert.equal(r.rows.filter(x=>x.type==='Sale correction').length,1,'refund adjustments appear once, as the refund paid; grouped children are folded');
 assert.ok(r.rows.every((x,i)=>i===0||r.rows[i-1].at>=x.at),'newest first');
 const all=filterTransactions(r);
 assert.equal(all.totals.moneyIn,10999,'payments in the period, any customer');
 assert.equal(all.totals.moneyOut,400+2500,'refunds and expense payments');
 assert.equal(all.totals.net,10999-2900);
 assert.equal(all.totals.charge,12000+999);
 const pay=r.rows.find(x=>x.id==='pay-p-oct');
 assert.equal(pay.staff,'Cashier Joy');assert.equal(pay.drawer,'DRAWER-A');assert.equal(pay.method,'GTBank transfer');
 assert.equal(r.rows.find(x=>x.id==='stock-h2').stock,'-2.5 sqm (now 22.5)');
});

test('Transactions filters, search and access limits',()=>{
 const l=activity();
 const r=transactionRegister(l,'2026-10-01','2026-10-31');
 assert.equal(filterTransactions(r,{type:'Stock change'}).rows.length,2);
 assert.equal(filterTransactions(r,{staff:'Cashier Joy'}).rows.length,3);
 assert.equal(filterTransactions(r,{method:'Cash'}).totals.moneyOut,2900);
 assert.deepEqual(filterTransactions(r,{query:'ink ltd'}).rows.map(x=>x.type),['Expense payment']);
 const cashier=transactionRegister(l,'2026-10-01','2026-10-31',{jobs:true,payments:true,expenses:false,stock:false,customers:false});
 assert.ok(cashier.rows.every(x=>!['Expense payment','Stock change'].includes(x.type)));
 assert.ok(!cashier.types.includes('Stock change'));
 assert.ok(cashier.rows.every(x=>x.party!=='Ada Okafor'),'customer names hidden without customer access');
 const csv=sectionsToCsv(['x'],transactionSections(filterTransactions(r)));
 assert.match(csv,/Net \(in minus out\) \(NGN\),80\.99/);
});

test('Watermark setting defaults off, validates, and older saved settings still load',()=>{
 assert.equal(defaultBranding().documents.watermark,false);
 const old=defaultBranding();old.businessName='Shop';delete old.documents;
 assert.deepEqual(validateBranding(old).documents,{watermark:false});
 assert.throws(()=>validateBranding({...old,documents:{watermark:'yes'}}),/document options/);
 assert.equal(receiptBusiness({businessName:'x'}).documents.watermark,false);
 assert.equal(validateBranding({...old,documents:{watermark:true}}).documents.watermark,true);
});

import {summaryReport,summarySections} from '../src/reports.mjs';
import {dashboardSummary} from '../src/dashboard.mjs';

test('Summary figures match the Dashboard for the same period',()=>{
 const l=activity();
 const s=summaryReport(l,'2026-10-01','2026-10-31',undefined,{today:'2026-11-15'});
 const d=dashboardSummary(l,'2026-10-01','2026-10-31');
 const fig=k=>s.figures.find(f=>f.key===k).value;
 for(const k of ['sales','collected','refunded','netCollected','expenseIncurred','expensePaid','netIncome','netCashFlow'])assert.equal(fig(k),d[k],k);
 assert.equal(s.previous,null);
});

test('Amounts owed are aged by job date and add up to the total owed',()=>{
 const l=activity();
 const s=summaryReport(l,'2026-10-01','2026-10-31',undefined,{today:'2026-11-15'});
 const owed=l.customers.reduce((n,c)=>n+customerBalance(l,c.id),0);
 assert.equal(s.owedTotal,owed);
 // old-owing (Sep 20) is 56 days old; oct-1 (Oct 2) 44 days; nov-1 (Nov 1 Lagos) 14 days.
 assert.deepEqual(s.aging.map(b=>b.amount),[3000,5000+3000,0,0]);
 assert.equal(s.debtors[0].name,'Ada Okafor');assert.equal(s.debtors[0].oldest,56);
});

test('Summary compares with the previous period and respects access',()=>{
 const l=activity();
 const s=summaryReport(l,'2026-10-01','2026-10-31',undefined,{compare:true,today:'2026-11-15'});
 assert.deepEqual(s.previous,{from:'2026-08-31',to:'2026-09-30'});
 assert.equal(s.figures.find(f=>f.key==='sales').previous,5000+2000);
 const limited=summaryReport(l,'2026-10-01','2026-10-31',{jobs:true,payments:false,expenses:false,stock:false,customers:false});
 assert.deepEqual(limited.figures.map(f=>f.key),['sales']);
 assert.equal(limited.aging,undefined);assert.equal(limited.customers,undefined);assert.equal(limited.materials,undefined);assert.equal(limited.expenseCategories,undefined);
});

test('Materials used, wasted and added come from stock history in the period',()=>{
 const l=activity();l.materials=[{id:'m',name:'Flex',measurementUnit:'sqm',available:22.5,minimumStock:20,archived:false}];
 l.materialHistory.push({id:'h4',materialId:'m',materialName:'Flex',measurementUnit:'sqm',action:'material.wasted',beforeAvailable:22.5,afterAvailable:22,changedAt:'2026-10-05T10:00:00Z'});
 const m=summaryReport(l,'2026-10-01','2026-10-31').materials[0];
 assert.deepEqual([m.used,m.wasted,m.added,m.level],[2.5,0.5,15,'Near minimum']);
 const csv=sectionsToCsv(['x'],summarySections(summaryReport(l,'2026-10-01','2026-10-31',undefined,{compare:true})));
 assert.match(csv,/Financial summary\r\nFigure,This period \(NGN\),Previous period \(NGN\),Change,Notes/);
 assert.match(csv,/Materials used and stock/);
});
