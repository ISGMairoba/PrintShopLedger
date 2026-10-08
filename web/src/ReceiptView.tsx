import {AdjustmentHistory} from './SaleAdjustmentsPage';
import {useFeedbackMessage, FeedbackBanner} from './Feedback';
import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { receiptHtml, receiptIntegrityError } from './receipts.mjs';
import { loadPrintSettings } from './print-settings.mjs';
import { printHtml } from './printing';
import type {CheckoutRecord} from './types';
export default function ReceiptView({record,business,scope,pending,onClose,adjustments=[]}:{record:CheckoutRecord;business:string|import("./useBusinessBranding").Branding;scope:string;pending:boolean;adjustments?:import("./types").SaleAdjustment[];onClose:()=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage,messageTone]=useFeedbackMessage('success');
 const warning=receiptIntegrityError(record);
 return <Modal title={`Receipt ${record.id.slice(0,8).toUpperCase()}`} wide busy={busy} onClose={onClose}>{warning&&<p className="notice" role="alert">{warning}</p>}<>{adjustments.length>0&&<section className="panel"><p className="notice notice-warning">This is the original receipt. Sales on it have later adjustments shown below.</p><AdjustmentHistory records={adjustments}/></section>}</><div className="receipt-sheet" dangerouslySetInnerHTML={{__html:receiptHtml(record,business,pending,adjustments)}}/><FeedbackBanner message={message} tone={messageTone}/><button disabled={busy||!!warning} onClick={async()=>{setBusy(true);try{await printHtml(loadPrintSettings(scope),`Receipt ${record.id.slice(0,8)}`,receiptHtml(record,business,pending,adjustments));setMessage('Receipt submitted to the printer.');}catch(cause){setMessage(cause instanceof Error?cause.message:String(cause),'error');}finally{setBusy(false);}}}><Icon name="services"/> {busy?'Printing…':'Print receipt'}</button><button className="secondary" disabled={busy||!!warning} onClick={async()=>{setBusy(true);try{const {downloadReceiptPdf}=await import("./receipt-pdf");downloadReceiptPdf(record,business,pending,adjustments);setMessage("PDF downloaded.");}catch(error){setMessage(error instanceof Error?error.message:String(error),'error');}finally{setBusy(false);}}}>Download PDF</button></Modal>;
}
