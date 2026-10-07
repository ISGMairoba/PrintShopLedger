import assert from 'node:assert/strict';
import test from 'node:test';
import {formatAmount, amountError, normalizeAmount, pastedAmount} from '../src/currency-input.mjs';
test('Currency grouping preserves exact digits, decimals and in-progress edits',()=>{
 for(const [raw,display] of [['1000','1,000'],['70000.50','70,000.50'],['1000000000.01','1,000,000,000.01'],['0.05','0.05'],['12.','12.'],['','']])assert.equal(formatAmount(raw),display);
 assert.equal(formatAmount('70000',true),'70,000.00');assert.equal(formatAmount('12.5',true),'12.50');
 assert.equal(formatAmount('1.001',true),'1.001','Never round an invalid precision');
});
test('Currency validation rejects negative, fractional kobo, exponent and excessive amounts',()=>{
 for(const value of ['-10','1.001','1e6','abc','1000000000.01'])assert.notEqual(amountError(value),'');
 for(const value of ['','0','0.01','1000000000','1000.50'])assert.equal(amountError(value),'');
 assert.notEqual(amountError('301',300),'');
});

test('Blur normalization removes only redundant leading zeros and preserves exact cents',()=>{
 for(const [raw,next,display] of [['0443342.00','443342.00','443,342.00'],['0000','0','0.00'],['000.05','0.05','0.05'],['00012.','12','12.00'],['.50','0.50','0.50'],[' 0012.5 ','12.5','12.50']]){assert.equal(normalizeAmount(raw),next);assert.equal(formatAmount(next,true),display);}
 for(const invalid of ['-001','1e3','0001.001','bad','1,2','.'])assert.equal(normalizeAmount(invalid),invalid);
 assert.equal(formatAmount('0443342.00',true),'443,342.00');
});
test('Pasted currency accepts valid thousands groups and keeps malformed data invalid',()=>{
 assert.equal(pastedAmount(' 443,342.00 '),'443342.00');assert.equal(pastedAmount('0,443,342.00'),'0443342.00');
 for(const invalid of ['1,2','1,00','1,234,56','-1,000','₦500','NaN','Infinity'])assert.notEqual(amountError(pastedAmount(invalid)),'');
});
