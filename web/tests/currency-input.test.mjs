import assert from 'node:assert/strict';
import test from 'node:test';
import {formatAmount, amountError} from '../src/currency-input.mjs';
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
