import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import Icon from './Icon';
import { money } from './domain.mjs';
import { expenseCategories, expenseSources, expenseCode, expensePaid, expenseDay, makeExpenseEvent } from './expenses.mjs';
import { materialCode } from './material-display.mjs';
import type { Expense, ExpenseEvent, ExpenseMaterial, Material } from './types';
const currency = (value:number) => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(value/100);
type Props={expense?:Expense;materials:Material[];expenses:Expense[];actor:{id:string;label:string};busy:boolean;mode?:'edit'|'payment';onSave:(event:ExpenseEvent)=>Promise<void>;onClose:()=>void};
export default function ExpenseEditor({expense,materials,expenses,actor,busy,mode='edit',onSave,onClose}:Props){
 const paymentOnly=mode==='payment';
 const [error,setError]=useState('');
 const [stock,setStock]=useState(!!expense?.materials.length);
 const [lines,setLines]=useState<ExpenseMaterial[]>(expense?.materials??[]);
 const [recordPayment,setRecordPayment]=useState(!expense);
 const [total,setTotal]=useState(expense?(expense.amount/100).toFixed(2):'');
 const [paid,setPaid]=useState(paymentOnly&&expense?((expense.amount-expensePaid(expense))/100).toFixed(2):'');
 const update=(index:number,patch:Partial<ExpenseMaterial>)=>setLines(items=>items.map((item,i)=>i===index?{...item,...patch}:item));
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;setError('');const f=new FormData(e.currentTarget);
  try{
   if(!paymentOnly&&stock&&!lines.length)throw Error('Add at least one purchased material, or turn off Add purchased materials to stock.');
   const payment=paymentOnly||!expense&&recordPayment&&money(paid||'0')>0?{id:crypto.randomUUID(),amount:money(paid),paidOn:String(f.get('paidOn')),method:String(f.get('method')),source:String(f.get('source')),reference:String(f.get('reference')).trim()}:undefined;
   if(paymentOnly&&money(paid||'0')===0)throw Error('Enter an amount greater than zero.');
   const data=paymentOnly?{payment}:{description:String(f.get('description')),category:String(f.get('category')),incurredOn:String(f.get('incurredOn')),amount:money(total),payee:String(f.get('payee')),note:String(f.get('note')),receiptReference:String(f.get('receiptReference')),materials:stock?lines:[],...(payment?{payment}:{})};
   await onSave(makeExpenseEvent(paymentOnly?'expense.payment_recorded':expense?'expense.updated':'expense.created',data,expense,actor) as ExpenseEvent);onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not save expense.');}
 }
 return <Modal title={paymentOnly?'Record expense payment':expense?'Edit expense':'Add expense'} wide busy={busy} onClose={onClose}>
  {error&&<div className="notice" role="alert">{error}</div>}
  {expense&&<p><strong>{expenseCode(expense.id,expenses)}</strong> · {expense.description}<br/>Paid: {currency(expensePaid(expense))} · Outstanding: {currency(expense.amount-expensePaid(expense))}</p>}
  <form onSubmit={submit}><fieldset disabled={busy}>
   {!paymentOnly&&<>
    <div className="form-grid">
     <label>Description<input name="description" maxLength={500} defaultValue={expense?.description??''} required placeholder="e.g. Paper purchase or generator fuel"/></label>
     <label>Category<input name="category" list="expense-category-options" maxLength={80} defaultValue={expense?.category??'Other'} required/><datalist id="expense-category-options">{[...new Set([...expenseCategories,...expenses.map(item=>item.category)])].map(value=><option key={value} value={value}/>)}</datalist></label>
     <label>Date incurred<input name="incurredOn" type="date" defaultValue={expense?.incurredOn??expenseDay(new Date().toISOString())} required/></label>
     <label>Total cost (₦)<CurrencyInput name="amount" value={total} onValueChange={setTotal} required/></label>
     <label>Supplier / paid to<input name="payee" maxLength={160} defaultValue={expense?.payee??''} list="expense-payee-options"/><datalist id="expense-payee-options">{[...new Set(expenses.map(item=>item.payee).filter(Boolean))].map(value=><option key={value} value={value}/>)}</datalist></label>
     <label>Receipt / invoice reference<input name="receiptReference" maxLength={160} defaultValue={expense?.receiptReference??''}/></label>
    </div>
    <label>Notes<textarea name="note" maxLength={1000} defaultValue={expense?.note??''}/></label>
    <section className="expense-stock"><label className="check-label"><input type="checkbox" checked={stock} onChange={e=>setStock(e.target.checked)}/>Add purchased materials to stock</label>
     {stock&&<><p className="muted">Enter quantities received in the displayed units. Save here once; stock and history update together. Do not add this purchase again through Materials.</p>
      {lines.map((line,index)=><div className="expense-stock-line" key={index}>
       <label>Material<select aria-label={`Material ${index+1}`} value={line.materialId} required onChange={e=>{const m=materials.find(item=>item.id===e.target.value);update(index,{materialId:e.target.value,name:m?.name??'',measurementUnit:m?.measurementUnit??''});}}><option value="">Choose material</option>{materials.filter(m=>!m.archived||m.id===line.materialId).map(m=><option key={m.id} value={m.id} disabled={lines.some((l,i)=>i!==index&&l.materialId===m.id)}>{m.name} ({materialCode(m.id,materials)}){m.archived?' · Archived':''}</option>)}</select></label>
       <label>Quantity received{line.measurementUnit&&` (${line.measurementUnit})`}<input aria-label={`Quantity received ${index+1}`} type="number" inputMode="decimal" step="0.001" min="0.001" max="1000000000000" value={line.quantity||''} onChange={e=>update(index,{quantity:Number(e.target.value)})} required/></label>
       <button type="button" className="text-button danger-text" aria-label={`Remove material ${index+1}`} onClick={()=>setLines(items=>items.filter((_,i)=>i!==index))}><Icon name="close"/></button>
      </div>)}
      <button type="button" className="secondary" disabled={!materials.some(m=>!m.archived)||lines.length>=50} onClick={()=>setLines(items=>[...items,{materialId:'',name:'',measurementUnit:'',quantity:0}])}><Icon name="add"/> Add material</button>
      {!materials.some(m=>!m.archived)&&<p className="notice">Create a material on the Materials page first.</p>}
      {expense&&<p className="muted">Changing or removing a quantity adjusts stock by the difference. Existing job deductions remain in place.</p>}
     </>}
    </section>
   </>}
   {!expense&&<label className="check-label"><input type="checkbox" checked={recordPayment} onChange={e=>setRecordPayment(e.target.checked)}/>Record money paid now</label>}
   {(paymentOnly||!expense&&recordPayment)&&<section className="expense-payment"><h3>Payment details</h3><div className="form-grid">
    <label>Amount paid (₦)<CurrencyInput value={paid} onValueChange={setPaid} required={paymentOnly} placeholder="0.00"/></label>
    <label>Payment date<input name="paidOn" type="date" defaultValue={expenseDay(new Date().toISOString())} required/></label>
    <label>Payment method<select name="method" defaultValue="Cash"><option>Cash</option><option>POS</option><option>Transfer</option></select></label>
    <label>Paid from<select name="source" defaultValue="Business cash">{expenseSources.map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Payment reference<input name="reference" maxLength={160}/></label>
   </div><p className="muted">Leave the amount at zero for an unpaid expense. Record later payments from the expense list.</p></section>}
   {expense&&!paymentOnly&&<p className="muted">Recorded payments are retained. Use Record payment to add a payment.</p>}
   <button type="submit"><Icon name="save"/> {busy?'Saving…':paymentOnly?'Save payment':'Save expense'}</button>
  </fieldset></form>
 </Modal>;
}
