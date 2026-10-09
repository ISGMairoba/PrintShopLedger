import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessPage,pages} from '../src/page-access.mjs';
test('cashier sees only operational pages and own credentials',()=>assert.deepEqual(pages.filter(page=>canAccessPage(page,1)),['Point of Service','My Sales','Print Settings','My Account']));
test('admin sees existing pages and account, business settings require manager',()=>{for(const page of pages)assert.equal(canAccessPage(page,2),page!=='Business Settings');});
test('manager and developer can access all pages; revoked and unknown denied',()=>{for(const page of pages){assert.ok(canAccessPage(page,3));assert.ok(canAccessPage(page,4));assert.equal(canAccessPage(page,0),false);}assert.equal(canAccessPage('Unknown',4),false);});

test('Configured pages restrict Admin and grant Cashier read pages without elevating rank',()=>{const access={'1':['My Account','Jobs'],'2':['My Account','Sale Adjustments']};assert.equal(canAccessPage('Jobs',1,access),true);assert.equal(canAccessPage('Payments',1,access),false);assert.equal(canAccessPage('Jobs',2,access),false);assert.equal(canAccessPage('Sale Adjustments',2,access),true);assert.equal(canAccessPage('Sale Adjustments',1,{'1':['My Account','Sale Adjustments']}),false);for(const page of pages)assert.equal(canAccessPage(page,3,access),true);});
