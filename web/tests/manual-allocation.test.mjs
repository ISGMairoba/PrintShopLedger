import test from 'node:test';
import assert from 'node:assert/strict';
import {rebalanceManualAllocations as balance} from '../src/manual-allocation.mjs';
const edit=(state,limits,budget,id,value)=>balance({...state.amounts,[id]:value},limits,budget,state.editedOrder,id);
test('The latest edit wins: 400/100 becomes 200/300 within a 500 budget',()=>{
 const limits={first:40000,second:30000};let state={amounts:{first:40000,second:10000},editedOrder:[]};
 state=edit(state,limits,50000,'second',30000);assert.deepEqual(state.amounts,{first:20000,second:30000});
 state=edit(state,limits,50000,'first',40000);assert.deepEqual(state.amounts,{first:40000,second:10000});assert.deepEqual(state.editedOrder,['second','first']);
});
test('Three jobs reduce in editing order rather than oldest-job order',()=>{
 const limits={oldestJob:50000,middleJob:50000,newestJob:50000};
 let state={amounts:{oldestJob:20000,middleJob:20000,newestJob:10000},editedOrder:['middleJob','oldestJob','newestJob']};
 state=edit(state,limits,50000,'newestJob',45000);assert.deepEqual(state.amounts,{oldestJob:5000,middleJob:0,newestJob:45000});
 assert.deepEqual(state.editedOrder,['middleJob','oldestJob','newestJob'],'Automatic reductions do not change editing order');
});
test('An edited amount cannot exceed its job balance or all available funds',()=>{
 const limits={first:40000,second:30000};let state={amounts:{first:40000,second:10000},editedOrder:[]};
 state=edit(state,limits,50000,'second',90000);assert.deepEqual(state.amounts,{first:20000,second:30000});
 state=edit(state,limits,10000,'second',30000);assert.deepEqual(state.amounts,{first:0,second:10000});
});
test('Lowering money received or disabling wallet credit reduces older edits first',()=>{
 const limits={first:40000,second:30000};const state=balance({first:20000,second:30000},limits,35000,['first','second']);assert.deepEqual(state.amounts,{first:5000,second:30000});
 assert.deepEqual(balance(state.amounts,limits,0,state.editedOrder).amounts,{first:0,second:0});
});
test('Reducing one allocation or increasing the budget leaves the rest untouched',()=>{
 const limits={first:40000,second:30000};const state=edit({amounts:{first:20000,second:30000},editedOrder:['first','second']},limits,50000,'second',10000);
 assert.deepEqual(state.amounts,{first:20000,second:10000});assert.deepEqual(balance(state.amounts,limits,70000,state.editedOrder).amounts,state.amounts);
});
test('Rebalancing keeps kobo exact and removes cancelled jobs and their edit history',()=>{
 const state=balance({first:40001,second:10001,removed:1000},{first:40001,second:30001},50002,['removed','first'],'second');
 assert.deepEqual(state.amounts,{first:40001,second:10001});assert.deepEqual(state.editedOrder,['first','second']);
 const next=edit(state,{first:40001,second:30001},50002,'second',30001);assert.deepEqual(next.amounts,{first:20001,second:30001});
 assert.throws(()=>balance({first:1.5},{first:40000},50000),/Invalid/);
});
