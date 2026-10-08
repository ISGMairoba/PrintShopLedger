import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { resolveMaterialState } from '../src/material-conflicts.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
const event = (id, kind, values) => ({ id, kind, data: { id: 'm', name: 'Paper', available: 10, measurementUnit: 'sheet', requireSize: false, modifiedBy: 'u', modifiedByLabel: 'Owner', modifiedAt: '2026-10-05T10:00:00Z', ...values } });
function fixture() {
  const created = applyEvent(emptyLedger(), event('c', 'material.created'));
  const localEvent = event('l', 'material.stock_set', { baseVersion: 1, quantity: 20 });
  const local = applyEvent(created, localEvent);
  const unrelated = { id: 'customer-event', kind: 'customer.created', data: { id: 'customer', name: 'Customer', phone: '', createdAt: '2026-10-05T10:00:00Z' } };
  return { state: { ledger: applyEvent(local, unrelated), pending: [localEvent, unrelated] },
    cloud: applyEvent(created, event('r', 'material.stock_set', { baseVersion: 1, quantity: 15, modifiedBy: 'other' })) };
}
test('keeping cloud removes only conflicting material changes and preserves unrelated records', () => {
  const { state, cloud } = fixture();
  const next = resolveMaterialState(state, cloud, 'm', 'cloud', () => 'unused', '2026-10-05T11:00:00Z');
  assert.equal(next.ledger.materials[0].available, 15);
  assert.equal(next.pending.length, 1);
  assert.equal(next.ledger.customers[0].id, 'customer');
  assert.equal(state.pending.length, 2);
});
test('keeping local rebases reviewed values on current version with new event ID', () => {
  const { state, cloud } = fixture();
  let id = 0;
  const next = resolveMaterialState(state, cloud, 'm', 'local', () => 'resolved-' + ++id, '2026-10-05T11:00:00Z');
  assert.equal(next.ledger.materials[0].available, 20);
  assert.equal(next.ledger.materials[0].version, 3);
  assert.equal(next.ledger.materials[0].createdBy, 'u');
  assert.equal(next.pending[0].data.baseVersion, 2);
  assert.equal(next.pending[0].id, 'resolved-1');
});
test('keeping a local archived material works when cloud also archived it', () => {
  const { state, cloud } = fixture();
  const localArchive = event('la', 'material.archived', { baseVersion: 2 });
  state.ledger = applyEvent(state.ledger, localArchive); state.pending.push(localArchive);
  const archivedCloud = applyEvent(cloud, event('ra', 'material.archived', { baseVersion: 2 }));
  let n = 0;
  const next = resolveMaterialState(state, archivedCloud, 'm', 'local', () => 'resolution-' + ++n, '2026-10-05T11:00:00Z');
  assert.equal(next.ledger.materials[0].archived, true);
  assert.equal(next.ledger.materials[0].available, 20);
  let replay = archivedCloud;
  for (const pending of next.pending) replay = applyEvent(replay, pending);
  assert.deepEqual(replay, next.ledger);
});

test('reapplying a name edit preserves concurrent business stock movements',()=>{
 const created=applyEvent(emptyLedger(),event('c','material.created'));
 const edit=event('edit','material.updated',{baseVersion:1,name:'Renamed paper'});
 const state={ledger:applyEvent(created,edit),pending:[edit]};
 const cloud=applyEvent(created,event('sale','material.stock_set',{baseVersion:1,quantity:7}));
 const next=resolveMaterialState(state,cloud,'m','local',()=> 'resolved','2026-10-08T12:00:00Z');
 assert.equal(next.ledger.materials[0].name,'Renamed paper');
 assert.equal(next.ledger.materials[0].available,7);
 assert.deepEqual(next.pending.map(e=>e.kind),['material.updated']);
});

test('reapplying deliveries adds only pending quantities to current business stock',()=>{
 const created=applyEvent(emptyLedger(),event('c','material.created'));
 const delivery=event('delivery','material.stock_added',{baseVersion:1,quantity:5,reason:'Delivery'});
 const state={ledger:applyEvent(created,delivery),pending:[delivery]};
 const cloud=applyEvent(created,event('sale','material.stock_set',{baseVersion:1,quantity:7}));
 const next=resolveMaterialState(state,cloud,'m','local',()=> 'resolved','2026-10-08T12:00:00Z');
 assert.equal(next.ledger.materials[0].available,12);
 assert.equal(next.pending[0].data.quantity,5);
 assert.equal(next.pending[0].data.reason,'Delivery');
});

test('review preserves delivery, stock correction and later checkout order without changing money',()=>{
 let created=applyEvent(emptyLedger(),event('c','material.created'));
 created=applyEvent(created,{id:'customer',kind:'customer.created',data:{id:'customer',name:'Customer',phone:'08012345678',address:'',creditLimit:0,modifiedBy:'u',modifiedByLabel:'Owner',modifiedAt:'2026-10-08T10:00:00Z'}});
 created=applyEvent(created,{id:'service',kind:'service.created',data:{id:'service',description:'Printing',materialId:'m',price:10000,modifiedBy:'u',modifiedByLabel:'Owner',modifiedAt:'2026-10-08T10:00:00Z'}});
 const delivery=event('delivery','material.stock_added',{baseVersion:1,quantity:5});
 const correction=event('count','material.stock_set',{baseVersion:2,quantity:20});
 let local=applyEvent(applyEvent(created,delivery),correction);
 const checkout=prepareCheckout(local,{customerId:'customer',lines:[{id:'job',serviceId:'service',description:'Print job',quantity:2,width:1,height:1,source:'In shop / USB',sourceNote:''}],cashReceived:20000,useWallet:false,method:'Cash',paidOn:'2026-10-08'},{id:'u',label:'Owner'},'checkout','2026-10-08T10:00:00Z');
 local=applyEvent(local,checkout);
 const cloud=applyEvent(created,event('other','material.stock_added',{baseVersion:1,quantity:7}));
 let counter=0;const next=resolveMaterialState({ledger:local,pending:[delivery,correction,checkout]},cloud,'m','local',()=> 'resolved-'+ ++counter,'2026-10-08T12:00:00Z');
 assert.deepEqual(next.pending.map(e=>e.kind),['material.stock_added','material.stock_set','checkout.completed']);
 assert.equal(next.ledger.materials[0].available,18);
 assert.equal(next.ledger.payments[0].amount,20000);
 assert.equal(next.ledger.checkouts[0].total,20000);
 assert.deepEqual(next.ledger,next.pending.reduce(applyEvent,cloud));
});
