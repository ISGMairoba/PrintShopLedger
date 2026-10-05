import Icon from './Icon';
import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { money } from './domain.mjs';
import { createCustomerEvent, customerCode } from './customers.mjs';
import type { Customer, CustomerEvent } from './types';
type Props={ customer?:Customer; customers?:Customer[]; actor:{id:string;label:string}; busy:boolean; onSave:(event:CustomerEvent)=>Promise<void>; onClose:()=>void; onSaved?:(customerId:string)=>void };
export default function CustomerEditor({customer,customers=[],actor,busy,onSave,onClose,onSaved}:Props) {
  const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(busy) return; setError('');
    const form=new FormData(e.currentTarget);
    try {
      const fields={name:String(form.get('name')??'').trim(),phone:String(form.get('phone')??'').trim(),address:String(form.get('address')??'').trim(),creditLimit:money(String(form.get('creditLimit')??'0'))};
      const operation:CustomerEvent=customer ? {id:crypto.randomUUID(),kind:'customer.updated',data:{id:customer.id,baseVersion:customer.version,...fields,modifiedBy:actor.id,modifiedByLabel:actor.label,modifiedAt:new Date().toISOString()}} : createCustomerEvent(fields,actor) as CustomerEvent;
      await onSave(operation); onSaved?.(operation.data.id); onClose();
    } catch(cause){setError(cause instanceof Error?cause.message:'Could not save customer.');}
  }
  return <Modal title={customer?'Edit customer':'Add customer'} busy={busy} onClose={onClose}>
    {error && <div className="notice" role="alert">{error}</div>}
    {customer && <p className="material-id">Customer ID: {customerCode(customer.id,customers)}</p>}
    <form onSubmit={submit}><fieldset disabled={busy}><div className="form-grid">
      <label>Full name<input name="name" maxLength={160} defaultValue={customer?.name??''} autoComplete="name" required /></label>
      <label>Phone number<input name="phone" type="tel" maxLength={40} defaultValue={customer?.phone??''} autoComplete="tel" required /></label>
      <label>Address<input name="address" maxLength={500} defaultValue={customer?.address??''} autoComplete="street-address" placeholder="Optional" /></label>
      <label>Credit limit (₦)<input name="creditLimit" type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" defaultValue={customer ? (customer.creditLimit/100).toFixed(2):'0.00'} required /></label>
    </div><p className="muted">The credit limit is saved for later use during checkout.</p><button type="submit"><Icon name="save"/> {busy?'Saving...':'Save customer'}</button></fieldset></form>
  </Modal>;
}
