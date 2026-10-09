import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger} from '../src/domain.mjs';
import {businessDay,dashboardRange,dashboardSummary,validRange} from '../src/dashboard.mjs';
import {canAccessPage,validatePageAccess,defaultPageAccess} from '../src/page-access.mjs';
test('Dashboard dates are Lagos business days and inclusive presets',()=>{
 assert.equal(businessDay('2026-10-08T23:30:00Z'),'2026-10-09');assert.equal(businessDay('2026-10-08'),'2026-10-08');assert.equal(businessDay('invalid'),'');
 assert.deepEqual(dashboardRange('week','2026-10-09'),{from:'2026-10-03',to:'2026-10-09'});assert.deepEqual(dashboardRange('month','2026-10-09'),{from:'2026-10-01',to:'2026-10-09'});
 for(const r of [['',''],['2026-10-10','2026-10-09'],['2026-02-30','2026-03-01'],['2000-01-01','2026-10-09']])assert.equal(validRange(...r),false);
});
test('Collections count new money only, refunds once, and expense payments by paid date',()=>{
 const l=emptyLedger();l.jobs=[{id:'old',createdAt:'2026-09-01',service:'Printing',amount:1000},{id:'new',createdAt:'2026-10-08T23:30:00Z',service:'Printing',amount:2000},{id:'cancelled',createdAt:'2026-10-09',service:'Binding',productionStatus:'Cancelled',amount:0}];
 l.payments=[{id:'payment',amount:1500,walletUsed:500,paidOn:'2026-10-09',method:'Cash',allocations:[{jobId:'old',amount:1000},{jobId:'new',amount:1000}]},{id:'refund',amount:0,walletUsed:300,refundId:'refund',paidOn:'2026-10-09',method:'Cash',allocations:[]}];
 l.saleAdjustments=[{id:'refund',action:'sale.refunded',refundAmount:300,paidOn:'2026-10-09',method:'Cash'}];
 l.expenses=[{amount:700,incurredOn:'2026-09-01',payments:[{amount:400,paidOn:'2026-10-09'}]},{amount:900,incurredOn:'2026-10-09',payments:[{amount:200,paidOn:'2026-10-10'}]},{amount:8000,incurredOn:'2026-10-09',voided:true,payments:[]}];
 const s=dashboardSummary(l,'2026-10-09','2026-10-09');assert.equal(s.sales,2000);assert.equal(s.collected,1500);assert.equal(s.refunded,300);assert.equal(s.netCollected,1200);assert.equal(s.expenseIncurred,900);assert.equal(s.expensePaid,400);assert.equal(s.netCashFlow,800);assert.equal(s.outstanding,1000);assert.equal(s.expenseOutstanding,1000);assert.equal(s.jobs,1);assert.equal(s.cancelled,1);assert.deepEqual(s.methods,[{name:'Cash',amount:1200}]);assert.deepEqual(s.trend,[{date:'2026-10-09',sales:2000,collected:1200,expenses:400}]);
});
test('Current stock alerts exclude archived materials; trends include zero days and negative refunds',()=>{
 const l=emptyLedger();l.materials=[{id:'low',name:'Flex',available:-2},{id:'zero',name:'DTF',available:0},{id:'ok',name:'UV',available:2},{id:'archived',available:-99,archived:true}];l.saleAdjustments=[{action:'sale.refunded',refundAmount:500,paidOn:'2026-10-09',method:'Transfer'}];const s=dashboardSummary(l,'2026-10-08','2026-10-09');assert.equal(s.trend.length,2);assert.equal(s.trend[0].collected,0);assert.equal(s.trend[1].collected,-500);assert.equal(s.netCashFlow,-500);assert.deepEqual(s.stockAlerts.map(m=>m.id),['low','zero']);assert.equal(dashboardSummary(l,'2026-01-01','2026-10-09').monthly,true);
});
test('Voiding an expense does not erase money already paid',()=>{
 const l=emptyLedger();l.expenses=[{amount:8000,incurredOn:'2026-10-09',voided:true,payments:[{amount:8000,paidOn:'2026-10-09',source:'Personal funds'}]}];const s=dashboardSummary(l,'2026-10-09','2026-10-09');assert.equal(s.expenseIncurred,0);assert.equal(s.expenseOutstanding,0);assert.equal(s.expensePaid,8000);assert.equal(s.netCashFlow,-8000);
});
test('Equal-length previous period excludes current days and corrected figures are current',()=>{
 const l=emptyLedger();l.jobs=[{id:'1',createdAt:'2026-10-07',amount:100,service:'Binding'},{id:'2',createdAt:'2026-10-09',amount:200,service:'Printing'}];const s=dashboardSummary(l,'2026-10-09','2026-10-09');assert.deepEqual(s.previous,{from:'2026-10-08',to:'2026-10-08',sales:0,netCollected:0});assert.equal(s.services[0].sales,200);l.jobs[1].amount=250;assert.equal(dashboardSummary(l,'2026-10-09','2026-10-09').sales,250);
});
test('Dashboard requires Admin+, can be disabled, and cannot be granted to Cashier',()=>{
 assert.equal(canAccessPage('Dashboard',1),false);assert.equal(canAccessPage('Dashboard',2),true);assert.equal(canAccessPage('Dashboard',3),true);assert.equal(canAccessPage('Dashboard',4),true);
 const custom=defaultPageAccess();custom['2']=custom['2'].filter(p=>p!=='Dashboard');assert.equal(canAccessPage('Dashboard',2,custom),false);custom['1'].push('Dashboard');assert.throws(()=>validatePageAccess(custom));
});
