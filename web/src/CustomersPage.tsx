import ResponsiveTable from './ResponsiveTable';
import Icon from './Icon';
import { useState } from 'react';
import Modal from './Modal';
import CustomerEditor from './CustomerEditor';
import { customerBalance } from './domain.mjs';
import { customerCode, customerMatches } from './customers.mjs';
import { servicePrice } from './services.mjs';
import { SortHeader, useTableSort } from './TableSort';
import type { Customer,CustomerEvent,Ledger } from './types';
type Props={ledger:Ledger;ready:boolean;busy:boolean;actor:{id:string;label:string};onSave:(event:CustomerEvent)=>Promise<void>;onRecordPayment:(id:string)=>void};
const date=(value:string)=>new Date(value).toLocaleString('en-NG',{timeZone:'Africa/Lagos'});
export default function CustomersPage({ledger,ready,busy,actor,onSave,onRecordPayment}:Props) {
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('active');
  const [audit,setAudit]=useState(false);
  const [editor,setEditor]=useState<Customer|'new'|null>(null);
  const [confirmation,setConfirmation]=useState<Customer|null>(null);
  const [error,setError]=useState('');
  const sorting=useTableSort<Customer>('name');
  const jobs=(id:string)=>ledger.jobs.filter(item=>item.customerId===id).length;
  const visible=sorting.sortRows(ledger.customers.filter(customer=>(filter==='all'||customer.archived===(filter==='archived')) &&
    customerMatches(customer,query,ledger.customers,[jobs(customer.id),(customerBalance(ledger,customer.id)/100).toFixed(2),servicePrice(customerBalance(ledger,customer.id))])),
    {id:item=>customerCode(item.id,ledger.customers),name:item=>item.name,phone:item=>item.phone,address:item=>item.address,creditLimit:item=>item.creditLimit,
      jobs:item=>jobs(item.id),outstanding:item=>customerBalance(ledger,item.id),status:item=>item.archived?'Archived':'Active',createdBy:item=>item.createdByLabel,createdAt:item=>Date.parse(item.createdAt),modifiedBy:item=>item.modifiedByLabel,modifiedAt:item=>Date.parse(item.modifiedAt)});
  const heading=(column:string,label:string)=><SortHeader column={column} label={label} sort={sorting}/>;
  async function changeStatus() {
    if(!confirmation||busy) return; setError('');
    try {
      await onSave({id:crypto.randomUUID(),kind:confirmation.archived?'customer.restored':'customer.archived',data:{id:confirmation.id,baseVersion:confirmation.version,modifiedBy:actor.id,modifiedByLabel:actor.label,modifiedAt:new Date().toISOString()}});
      setConfirmation(null);
    } catch(cause){setError(cause instanceof Error?cause.message:'Could not save customer.');}
  }
  return <>
    <section className="panel"><div className="toolbar customer-toolbar"><input aria-label="Search customers" placeholder="Search any customer field" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Customer status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All customers</option></select>
      <button className="secondary" aria-pressed={audit} onClick={()=>setAudit(!audit)}><Icon name={audit?'table':'audit'}/> {audit?'Normal view':'Audit view'}</button>
      <button disabled={!ready||busy} onClick={()=>{setEditor('new');setError('');}}><Icon name="add"/> Add customer</button></div>
      {!ready?<div className="empty">Loading customers.</div>:!visible.length?<div className="empty"><h2>{query?'No matching customers':filter==='archived'?'No archived customers':'No customers yet'}</h2><p>Add a customer with their full name and phone number.</p></div>:
      <div className="table-wrap"><ResponsiveTable columns={[{index:1,label:"Customer",details:[0,2,3,7]},{index:6,label:"Outstanding",details:[4,5]},{index:-1,label:"Actions",actions:true}]} labels={{0:"ID"}}><table><thead><tr>{heading('id','Customer ID')}{heading('name','Full name')}{heading('phone','Phone')}{heading('address','Address')}{heading('creditLimit','Credit limit')}{heading('jobs','Jobs')}{heading('outstanding','Outstanding')}{heading('status','Status')}
        {audit&&<>{heading('createdBy','Created by')}{heading('createdAt','Created at')}{heading('modifiedBy','Modified by')}{heading('modifiedAt','Modified at')}</>}<th>Actions</th></tr></thead><tbody>
        {visible.map(customer=><tr key={customer.id}><td className="material-id">{customerCode(customer.id,ledger.customers)}</td><td><strong>{customer.name}</strong></td><td>{customer.phone||'-'}</td><td>{customer.address||'-'}</td><td>{servicePrice(customer.creditLimit)}</td><td>{jobs(customer.id)}</td><td>{servicePrice(customerBalance(ledger,customer.id))}</td><td><span className={`badge ${customer.archived?'unpaid':'paid'}`}>{customer.archived?'Archived':'Active'}</span></td>
          {audit&&<><td>{customer.createdByLabel}</td><td>{date(customer.createdAt)}</td><td>{customer.modifiedByLabel}</td><td>{date(customer.modifiedAt)}</td></>}
          <td><div className="material-actions">{!customer.archived&&<button className="text-button" disabled={busy} onClick={()=>setEditor(customer)}><Icon name="edit"/> Edit</button>}
            <button className={`text-button ${customer.archived?'':'danger-text'}`} disabled={busy} onClick={()=>{setConfirmation(customer);setError('');}}><Icon name={customer.archived?'restore':'archive'}/> {customer.archived ? 'Restore' : 'Archive'}</button>
            <button className="text-button" disabled={busy||customerBalance(ledger,customer.id)<=0} onClick={()=>onRecordPayment(customer.id)}>Record payment</button></div></td></tr>)}
      </tbody></table></ResponsiveTable></div>}
    </section>
    {editor&&<CustomerEditor key={editor==='new'?'new':editor.id+':'+editor.version} customer={editor==='new'?undefined:editor} customers={ledger.customers} actor={actor} busy={busy} onSave={onSave} onClose={()=>setEditor(null)}/>}
    {confirmation&&<Modal title={`${confirmation.archived?'Restore':'Archive'} ${confirmation.name}?`} busy={busy} onClose={()=>setConfirmation(null)}>
      {error&&<div className="notice" role="alert">{error}</div>}<p>{confirmation.archived?'The customer will be active again.':'Their details and existing jobs and payments will be retained. You can restore them later.'}</p>
      <div className="material-actions"><button className={confirmation.archived?'':'danger-button'} disabled={busy} onClick={()=>void changeStatus()}>{busy?'Saving...':confirmation.archived?'Restore customer':'Archive customer'}</button><button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>Cancel</button></div>
    </Modal>}
  </>;
}

