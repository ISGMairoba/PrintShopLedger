import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultBranding,validateBranding,validLogo,contrastText,suggestedPalette} from '../src/business-branding.mjs';
import {receiptHtml} from '../src/receipts.mjs';
test('profile validates contact details, safe logos, colors and receipt options',()=>{
 const input={...defaultBranding(),businessName:'  Mairoba Studio  ',email:'studio@example.com',website:'https://example.com'};
 assert.equal(validateBranding(input).businessName,'Mairoba Studio');assert.equal(input.businessName,'  Mairoba Studio  ');
 for(const patch of [{businessName:''},{email:'invalid'},{website:'javascript:alert(1)'},{logo:'data:image/svg+xml;base64,QQ=='},{logo:'https://example.com/logo.png'},{primary:'red'},{theme:'night'},{receipt:{showLogo:'true'}}])assert.throws(()=>validateBranding({...input,...patch}));
 assert.ok(validLogo('data:image/png;base64,QQ=='));assert.ok(!validLogo('data:image/png;base64,QQ==" onerror="bad'));
});
test('brand buttons select contrasting text, logo palette ignores transparent and plain white pixels',()=>{
 assert.equal(contrastText('#000000'),'#ffffff');assert.equal(contrastText('#ffffff'),'#000000');
 assert.deepEqual(suggestedPalette(new Uint8ClampedArray([255,255,255,255,30,140,50,0,200,20,20,255,200,20,20,255])),['#c01818']);
});
test('receipt branding is escaped, optional, and does not change money',()=>{
 const record={id:'receipt',customerSnapshot:{name:'Customer',phone:'080111'},createdAt:'2026-10-08T00:00:00Z',createdByLabel:'Cashier',jobs:[],jobBalances:[{id:'job',description:'Banner',service:'Printing',amount:4500000,paidBefore:0,paidThisCheckout:500000,outstandingAfter:4000000}],total:0,cashReceived:500000,walletUsed:0,walletAdded:0,walletAfter:0,outstandingAfter:4000000,method:'Cash',paidOn:'2026-10-08'};
 const b={...defaultBranding(),businessName:'Mairoba <Studio>',address:'Kano <address>',phones:'080111',logo:'data:image/png;base64,QQ=='};
 let html=receiptHtml(record,b);for(const value of ['Mairoba &lt;Studio&gt;','Kano &lt;address&gt;','Business logo','₦45,000.00','₦5,000.00','₦40,000.00'])assert.ok(html.includes(value));
 b.receipt={showLogo:false,showAddress:false,showContacts:false,footer:'<script>footer</script>'};html=receiptHtml(record,b);assert.ok(!html.includes('Business logo'));assert.ok(!html.includes('Kano'));assert.ok(html.includes('&lt;script&gt;footer&lt;/script&gt;'));
 assert.ok(receiptHtml(record,'Old shop').includes('Old shop'));
});
test('Old business settings gain recent-job and access defaults without losing saved branding',()=>{const old={...defaultBranding(),businessName:'Mairoba Studio'};delete old.corrections;delete old.pageAccess;const upgraded=validateBranding(old);assert.equal(upgraded.corrections.recentDays,7);assert.equal(upgraded.pageAccess['1'].includes('Sale Adjustments'),false);assert.equal(upgraded.businessName,'Mairoba Studio');});
test('Correction window and role page settings reject invalid or elevated access',()=>{const current={...defaultBranding(),businessName:'Mairoba Studio'};for(const days of [0,366,1.5,'7'])assert.throws(()=>validateBranding({...current,corrections:{recentDays:days}}));assert.throws(()=>validateBranding({...current,pageAccess:{'1':['My Account','Conflict Inbox'],'2':current.pageAccess['2']}}));assert.throws(()=>validateBranding({...current,pageAccess:{'1':[],'2':current.pageAccess['2']}}));});
