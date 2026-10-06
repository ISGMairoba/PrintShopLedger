import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUser, userCode, canManage, rankValues } from '../src/users.mjs';
test('staff fields normalize and role determines the numeric rank',()=>{
 assert.deepEqual(validateUser({name:' Amina ',username:' AMINA.Print ',role:'cashier'}),{name:'Amina',username:'amina.print',rank:1,role:'cashier'});
 assert.equal(userCode('12345678-1234-1234-1234-123456789012'),'USR-12345678');
});
test('invalid usernames and roles cannot become staff permissions',()=>{
 for(const patch of [{name:''},{username:'a'},{username:'bad name'},{role:'owner'},{role:'toString'}]){
  assert.throws(()=>validateUser({name:'Staff',username:'staff.name',rank:'Operator',role:'cashier',...patch}));
 }
});
test('rank hierarchy permits self and lower ranks, but no manager peers or developer edits',()=>{
 for(const [role,rank] of Object.entries(rankValues)){
  const actor={rank,accessLevel:rank,userId:'actor'};
  for(const targetRank of [1,2,3,4]){
   assert.equal(canManage(actor,{rank:targetRank,userId:'other'}),rank>=2&&(rank===4||rank>targetRank),role+':'+targetRank);
  }
  assert.equal(canManage(actor,{rank,userId:'actor'}),rank>=2);
  assert.equal(canManage({...actor,accessLevel:0},{rank:1,userId:'other'}),false);
 }
});
