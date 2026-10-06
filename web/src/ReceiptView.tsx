import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { receiptHtml } from './receipts.mjs';
import { loadPrintSettings } from './print-settings.mjs';
import { printHtml } from './printing';
import type {CheckoutRecord} from './types';
export default function ReceiptView({record,business,scope,pending,onClose}:{record:CheckoutRecord;business:string;scope:string;pending:boolean;onClose:()=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <Modal title={`Receipt ${record.id.slice(0,8).toUpperCase()}`} wide busy={busy} onClose={onClose}><div className="receipt-sheet" dangerouslySetInnerHTML={{__html:receiptHtml(record,business,pending)}}/>{message&&<p role="status" className="notice">{message}</p>}<button disabled={busy} onClick={async()=>{setBusy(true);try{await printHtml(loadPrintSettings(scope),`Receipt ${record.id.slice(0,8)}`,receiptHtml(record,business,pending));setMessage('Receipt submitted to the printer.');}catch(cause){setMessage(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}}}><Icon name="services"/> {busy?'Printing…':'Print receipt'}</button></Modal>;
}
