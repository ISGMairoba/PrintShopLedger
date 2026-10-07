import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessPage,pages} from '../src/page-access.mjs';
test('cashier sees only operational pages and own credentials',()=>assert.deepEqual(pages.filter(page=>canAccessPage(page,1)),['Point of Service','My Sales','Print Settings','My Account']));
test('admin sees existing pages and account, business settings require manager',()=>{for(const page of pages)assert.equal(canAccessPage(page,2),page!=='Business Settings');});
test('manager and developer can access all pages; revoked and unknown denied',()=>{for(const page of pages){assert.ok(canAccessPage(page,3));assert.ok(canAccessPage(page,4));assert.equal(canAccessPage(page,0),false);}assert.equal(canAccessPage('Unknown',4),false);});
