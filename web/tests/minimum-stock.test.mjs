import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,applyEvent} from '../src/domain.mjs';
import {stockLevel} from '../src/material-display.mjs';
import {dashboardSummary} from '../src/dashboard.mjs';
const event=(kind,overrides={},id='create')=>({id,kind,data:{id:'m',name:'Paper',measurementUnit:'sheet',available:20,requireSize:false,minimumStock:10,modifiedBy:'user',modifiedByLabel:'User',modifiedAt:'2026-10-09T10:00:00Z',...overrides}});
test('minimum persists through edits, legacy commands and stock updates, with audited values',()=>{
 let l=applyEvent(emptyLedger(),event('material.created'));
 l=applyEvent(l,event('material.updated',{baseVersion:1,minimumStock:15},'edit'));
 assert.equal(l.materials[0].available,20);assert.equal(l.materialHistory[1].before.minimumStock,10);assert.equal(l.materialHistory[1].after.minimumStock,15);
 l=applyEvent(l,event('material.updated',{baseVersion:2,minimumStock:undefined},'legacy'));
 l=applyEvent(l,event('material.stock_added',{baseVersion:3,quantity:2},'stock'));
 assert.equal(l.materials[0].minimumStock,15);assert.equal(l.materials[0].available,22);
 for(const minimumStock of [-1,NaN,Infinity,1.0001,'10',1000000000001]) assert.throws(()=>applyEvent(emptyLedger(),event('material.created',{minimumStock})));
});
test('critical and near minimum boundaries use each material and ignore archives',()=>{
 for(const [available,expected] of [[-1,'Critical'],[0,'Critical'],[10,'Critical'],[11,'Near minimum'],[12,'Near minimum'],[12.001,null]])assert.equal(stockLevel({available,minimumStock:10}),expected);
 assert.equal(stockLevel({available:1}),null);assert.equal(stockLevel({available:0,archived:true}),null);
 const l=emptyLedger();l.materials=[{id:'critical',name:'Paper',available:10,minimumStock:10},{id:'near',name:'Vinyl',available:12,minimumStock:10},{id:'ok',name:'DTF',available:13,minimumStock:10},{id:'archived',name:'Old',available:-1,archived:true}];
 assert.deepEqual(dashboardSummary(l,'2026-10-09','2026-10-09').stockAlerts.map(m=>m.id),['critical','near']);
});
