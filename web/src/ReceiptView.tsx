import {AdjustmentHistory} from './SaleAdjustmentsPage';
import {useFeedbackMessage, FeedbackBanner} from './Feedback';
import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { receiptHtml, receiptIntegrityError, correctedReceipt, receiptLayout } from './receipts.mjs';
import { loadPrintSettings } from './print-settings.mjs';
import { printHtml } from './printing';
import type {CheckoutRecord} from './types';
export default function ReceiptView({record:originalRecord,ledger,business,scope,pending,onClose,adjustments=[]}:{record:CheckoutRecord;ledger?:import("./types").Ledger;business:string|import("./useBusinessBranding").Branding;scope:string;pending:boolean;adjustments?:import("./types").SaleAdjustment[];onClose:()=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage,messageTone]=useFeedbackMessage('success');
 const [corrected,setCorrected]=useState(false);
 const record=corrected&&ledger?correctedReceipt(originalRecord,ledger) as CheckoutRecord:originalRecord;
 const warning=receiptIntegrityError(record);
 const settings=loadPrintSettings(scope),layout=receiptLayout(settings.width) as 'narrow'|'wide';
 const html=receiptHtml(record,business,pending,adjustments,{layout});
 async function pdf(size:'a4'|'roll'){setBusy(true);try{const {downloadReceiptPdf}=await import('./receipt-pdf');downloadReceiptPdf(record,business,pending,adjustments,size);setMessage('PDF downloaded.');}catch(error){setMessage(error instanceof Error?error.message:String(error),'error');}finally{setBusy(false);}}
 return <Modal title={`Receipt ${record.id.slice(0,8).toUpperCase()}`} wide busy={busy} onClose={onClose}>{warning&&<p className="notice" role="alert">{warning}</p>}<>{adjustments.length>0&&<section className="panel"><p className="notice notice-warning">{corrected?'Corrected receipt with current balances. The original remains available.':'This is the original receipt. It has later adjustments shown below.'}</p>{ledger&&<button className="secondary" disabled={busy} onClick={()=>setCorrected(v=>!v)}>{corrected?'Original receipt':'Corrected receipt'}</button>}<AdjustmentHistory records={adjustments}/></section>}</><div className={`receipt-sheet ${layout}`} dangerouslySetInnerHTML={{__html:html}}/><FeedbackBanner message={message} tone={messageTone}/><div className="receipt-actions"><button disabled={busy||!!warning} onClick={async()=>{setBusy(true);try{await printHtml(settings,`Receipt ${record.id.slice(0,8)}`,html);setMessage('Receipt submitted to the printer.');}catch(cause){setMessage(cause instanceof Error?cause.message:String(cause),'error');}finally{setBusy(false);}}}><Icon name="services"/> {busy?'Printing…':'Print receipt'}</button><button className="secondary" disabled={busy||!!warning} onClick={()=>void pdf('a4')}>Download PDF (A4)</button><button className="secondary" disabled={busy||!!warning} onClick={()=>void pdf('roll')}>Download PDF (80mm)</button><small>Preview matches your printer paper in Print Settings ({settings.paper}).</small></div></Modal>;
}
