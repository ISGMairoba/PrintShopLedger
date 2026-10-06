import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUser, userCode } from '../src/users.mjs';
test('staff fields normalize and rank stays separate from access level',()=>{
 assert.deepEqual(validateUser({name:' Amina ',username:' AMINA.Print ',rank:' Operator ',role:'cashier'}),{name:'Amina',username:'amina.print',rank:'Operator',role:'cashier'});
 assert.equal(userCode('12345678-1234-1234-1234-123456789012'),'USR-12345678');
});
test('invalid usernames, ranks and access levels cannot become staff permissions',()=>{
 for(const patch of [{name:''},{username:'a'},{username:'bad name'},{rank:''},{role:'owner'},{role:'toString'}]){
  assert.throws(()=>validateUser({name:'Staff',username:'staff.name',rank:'Operator',role:'cashier',...patch}));
 }
});
