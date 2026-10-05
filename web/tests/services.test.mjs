import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger, money } from '../src/domain.mjs';
import { normalizeLedger } from '../src/materials.mjs';
import { serviceCode, serviceMatches } from '../src/services.mjs';
import { resolveServiceState } from '../src/service-conflicts.mjs';
const audit={ modifiedBy:'owner',modifiedByLabel:'Owner',modifiedAt:'2026-10-05T12:00:00Z' };
const material=(id='paper')=>({id:'material-event-'+id,kind:'material.created',data:{id,name:'A4 Paper',measurementUnit:'sheet',available:10,requireSize:false,...audit}});
const command=(kind='service.created',values={},id='service-event')=>({id,kind,data:{id:'service',description:' Colour printing ',materialId:'paper',price:money('1500.50'),...audit,...values}});
const fixture=()=>applyEvent(emptyLedger(),material());
test('legacy caches normalize to an empty service catalogue',()=>assert.deepEqual(normalizeLedger({customers:[],jobs:[],payments:[]}).services,[]));
test('different services can share one base material with independent prices',()=>{
  let ledger=applyEvent(fixture(),command());
  ledger=applyEvent(ledger,command('service.created',{id:'black',description:'Black printing',price:money('100')},'black-event'));
  assert.equal(ledger.services.length,2);
  assert.equal(ledger.services[0].description,'Colour printing');
  assert.equal(ledger.services[0].materialId,ledger.services[1].materialId);
  assert.equal(ledger.services[1].price,10000);
  assert.equal(ledger.materials[0].available,10);
  assert.equal(ledger.materialHistory.length,1);
});
test('editing description, price and material preserves creation audit',()=>{
  let ledger=applyEvent(fixture(),material('card'));
  ledger=applyEvent(ledger,command());
  const before=ledger.services[0];
  ledger=applyEvent(ledger,command('service.updated',{baseVersion:1,description:'Card printing',materialId:'card',price:0,modifiedBy:'cashier',modifiedAt:'2026-10-05T13:00:00Z'},'edit'));
  const actual=ledger.services[0];
  assert.equal(actual.createdBy,before.createdBy);
  assert.equal(actual.createdAt,before.createdAt);
  assert.equal(actual.modifiedBy,'cashier');
  assert.equal(actual.price,0);
  assert.equal(actual.materialId,'card');
  assert.equal(actual.version,2);
});
test('archive retains price and material; restore allows edits again',()=>{
  let ledger=applyEvent(fixture(),command());
  ledger=applyEvent(ledger,command('service.archived',{baseVersion:1},'archive'));
  assert.equal(ledger.services[0].archived,true);
  assert.equal(ledger.services[0].price,150050);
  assert.equal(ledger.services[0].materialId,'paper');
  assert.throws(()=>applyEvent(ledger,command('service.updated',{baseVersion:2},'edit')),/Restore/);
  ledger=applyEvent(ledger,command('service.restored',{baseVersion:2},'restore'));
  assert.equal(ledger.services[0].archived,false);
  assert.equal(ledger.services[0].version,3);
  assert.equal(ledger.materials[0].available,10);
});
test('invalid descriptions, prices and missing materials are rejected',()=>{
  for(const values of [{description:' '},{description:'x'.repeat(501)},{price:-1},{price:0.5},{price:NaN},{price:Infinity},{price:100000000001},{materialId:'missing'}]) assert.throws(()=>applyEvent(fixture(),command('service.created',values)));
});
test('new archived-material links are blocked but existing links remain editable',()=>{
  let ledger=applyEvent(fixture(),command());
  ledger=applyEvent(ledger,{id:'mat-archive',kind:'material.archived',data:{id:'paper',baseVersion:1,...audit}});
  assert.throws(()=>applyEvent(ledger,command('service.created',{id:'new'},'new')),/active base material/);
  ledger=applyEvent(ledger,command('service.updated',{baseVersion:1,price:money('200')},'edit'));
  assert.equal(ledger.services[0].materialId,'paper');
  assert.equal(ledger.services[0].price,20000);
});
test('retries are idempotent and stale updates do not overwrite changes',()=>{
  const create=command();
  let ledger=applyEvent(fixture(),create);
  assert.deepEqual(applyEvent(ledger,create),ledger);
  const edit=command('service.updated',{baseVersion:1,price:money('100')},'edit');
  ledger=applyEvent(ledger,edit);
  assert.deepEqual(applyEvent(ledger,edit),ledger);
  assert.throws(()=>applyEvent(ledger,command('service.updated',{baseVersion:1},'stale')),/changed elsewhere/);
});
test('search finds description, compact ID, material and decimal or formatted price',()=>{
  const ledger=applyEvent(fixture(),command('service.created',{id:'12345678-abcd-4000-8000-000000000001'}));
  const service=ledger.services[0];
  for(const query of ['colour','svc-12345678','a4 paper','1500.50','1,500.50']) assert.equal(serviceMatches(service,ledger.materials,ledger.services,query),true,query);
  assert.equal(serviceMatches(service,ledger.materials,ledger.services,'99999'),false);
  assert.equal(serviceCode(service.id,ledger.services),'SVC-12345678');
});
test('keeping local rebases service values and retains unrelated pending records',()=>{
  const base=applyEvent(fixture(),command());
  const edit=command('service.updated',{baseVersion:1,price:money('200')},'local-edit');
  const other={id:'customer-event',kind:'customer.created',data:{id:'customer',name:'Customer',phone:'',createdAt:audit.modifiedAt}};
  const state={ledger:applyEvent(applyEvent(base,edit),other),pending:[edit,other]};
  const cloud=applyEvent(base,command('service.updated',{baseVersion:1,price:money('300')},'cloud-edit'));
  let id=0;
  const next=resolveServiceState(state,cloud,'service','local','paper',()=> 'resolve-'+ ++id,audit.modifiedAt);
  assert.equal(next.ledger.services[0].price,20000);
  assert.equal(next.pending.length,2);
  assert.equal(next.ledger.customers.length,1);
  const discard=resolveServiceState(state,cloud,'service','cloud','',()=> 'unused',audit.modifiedAt);
  assert.equal(discard.ledger.services[0].price,30000);
  assert.equal(discard.pending.length,1);
});
test('queued service creation can switch to an active material after its original material is archived',()=>{
  const local=applyEvent(fixture(),material('card'));
  const create=command();
  const state={ledger:applyEvent(local,create),pending:[create]};
  const cloud=applyEvent(local,{id:'mat-archive',kind:'material.archived',data:{id:'paper',baseVersion:1,...audit}});
  const next=resolveServiceState(state,cloud,'service','local','card',()=> 'resolved-create',audit.modifiedAt);
  assert.equal(next.ledger.services[0].materialId,'card');
  assert.equal(next.pending[0].kind,'service.created');
});
