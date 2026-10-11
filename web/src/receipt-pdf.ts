import {jsPDF,GState} from 'jspdf';
import {receiptBusiness} from './business-branding.mjs';
import {receiptIntegrityError,receiptModel} from './receipts.mjs';
import {registerPdfFonts,pdfText,PDF_FONT,rgb} from './pdf-common';
import type {CheckoutRecord,SaleAdjustment} from './types';
import type {Branding} from './useBusinessBranding';

export type ReceiptPdfSize='a4'|'roll';
type Model=ReturnType<typeof receiptModel>;
type Colour=[number,number,number];
const INK:Colour=[29,43,39],MUTED:Colour=[95,108,103],RULE:Colour=[220,226,222];

function imageInfo(doc:jsPDF,data:string){try{const p=doc.getImageProperties(data);return {type:p.fileType,w:p.width,h:p.height};}catch{return null;}}

/** A4 portrait receipt: branded header, item table, totals and account panel. */
function drawA4(doc:jsPDF,m:Model,watermark:boolean){
 const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),L=16,R=W-16,U=R-L,bottom=H-18;
 const brand=rgb(m.business.primary),accent=rgb(m.business.accent);
 const logo=m.business.logo?imageInfo(doc,m.business.logo):null;
 const mark=()=>{if(!logo||!watermark)return;const s=Math.min(130/logo.w,100/logo.h);doc.setGState(new GState({opacity:0.06}));doc.addImage(m.business.logo,logo.type,(W-logo.w*s)/2,(H-logo.h*s)/2,logo.w*s,logo.h*s,'wm','FAST');doc.setGState(new GState({opacity:1}));};
 mark();
 let y=18;
 const page=(need:number)=>{if(y+need>bottom){doc.addPage();mark();y=18;}};
 const text=(t:string,x:number,size:number,style:'normal'|'bold'|'italic'='normal',colour:Colour=INK,align:'left'|'right'|'center'='left',width?:number)=>{
  doc.setFont(PDF_FONT,style);doc.setFontSize(size);doc.setTextColor(...colour);
  const lines=width?doc.splitTextToSize(pdfText(t),width) as string[]:[pdfText(t)];
  lines.forEach((line,i)=>doc.text(line,x,y+i*size*0.42,{align}));return lines.length*size*0.42;
 };
 // Header
 let logoH=0,textW=U;
 if(logo){const s=Math.min(60/logo.w,28/logo.h);doc.addImage(m.business.logo,logo.type,R-logo.w*s,14,logo.w*s,logo.h*s,'logo','FAST');logoH=logo.h*s;textW=U-logo.w*s-8;}
 y=20;y+=text(m.business.name,L,17,'bold',brand,'left',textW)+1;
 for(const line of [m.business.address,m.business.contacts.join('  |  ')].filter(Boolean))y+=text(line,L,8.8,'normal',MUTED,'left',textW);
 y=Math.max(y,14+logoH)+5;
 // Title band
 doc.setFillColor(...brand);doc.rect(L,y,U,11,'F');
 doc.setFont(PDF_FONT,'bold');doc.setFontSize(13);doc.setTextColor(255,255,255);doc.text(pdfText(m.title.toUpperCase()),L+4,y+7.4);
 doc.setFont(PDF_FONT,'normal');doc.setFontSize(10);doc.text(pdfText(`No. ${m.number}`),R-4,y+7.2,{align:'right'});
 y+=17;
 for(const n of m.notices){doc.setFillColor(253,247,232);doc.setDrawColor(...accent);doc.rect(L,y-4,U,7.5,'F');doc.setLineWidth(1.2);doc.line(L,y-4,L,y+3.5);doc.setLineWidth(0.2);text(n,L+4,9.5,'bold');y+=10;}
 // Meta
 const meta:[string,string][]=[['Customer',m.customer.name+(m.customer.phone?`  ·  ${m.customer.phone}`:'')],['Date',m.date],['Cashier',m.cashier],['Payment date',m.paidOn]];
 meta.forEach(([k,v],i)=>{const x=i%2?L+U/2:L;if(i%2===0&&i)y+=6;text(k,x,8.5,'normal',MUTED);text(v,x+24,9.5,'normal',INK,'left',U/2-28);});
 y+=11;
 // Items
 if(m.items.length){
  const cols=[L,R-78,R-50,R-22];
  const head=()=>{doc.setDrawColor(...brand);doc.setLineWidth(0.6);doc.line(L,y+2,R,y+2);doc.setLineWidth(0.2);text('JOB',cols[0],8,'bold',MUTED);text('AMOUNT',cols[1]+22,8,'bold',MUTED,'right');text('PAID NOW',cols[2]+22,8,'bold',MUTED,'right');text('BALANCE',R,8,'bold',MUTED,'right');y+=7;};
  head();
  for(const i of m.items){
   doc.setFont(PDF_FONT,'normal');doc.setFontSize(8.2);
   const sub=doc.splitTextToSize(pdfText(`${i.service} · ${i.ref}${i.details.length?' · '+i.details.join(' · '):''}`),cols[1]-L-6) as string[];
   doc.setFontSize(10);const name=doc.splitTextToSize(pdfText(i.description),cols[1]-L-6) as string[];
   const h=name.length*4.4+sub.length*3.6+(i.paidBefore?3.6:0)+4;
   page(h+4);if(y===18)head();
   const top=y;
   text(i.description,L,10,'bold',INK,'left',cols[1]-L-6);y+=name.length*4.4;
   text(sub.join('\n'),L,8.2,'normal',MUTED);
   y=top;text(i.amount,cols[1]+22,10,'normal',i.ok?INK:[170,40,30],'right');
   text(i.paidNow,cols[2]+22,10,'normal',INK,'right');text(i.balance,R,10,'bold',INK,'right');
   if(i.paidBefore){y+=4.4;text(`Paid before ${i.paidBefore}`,cols[1]+22,7.8,'normal',MUTED,'right');}
   y=top+h;doc.setDrawColor(...RULE);doc.line(L,y-1.5,R,y-1.5);y+=3;
  }
 }
 // Totals
 page(m.totals.length*6+30);y+=2;
 const sx=L+U*0.48;
 m.totals.forEach((t,k)=>{const last=k===m.totals.length-1&&t.strong;
  if(last){y+=1.5;doc.setDrawColor(...brand);doc.setLineWidth(0.6);doc.line(sx,y-5,R,y-5);doc.setLineWidth(0.2);}
  text(t.label,sx,last?11:9.8,t.strong?'bold':'normal',last?brand:INK);text(t.value,R,last?11:9.8,t.strong?'bold':'normal',last?brand:INK,'right');y+=last?7:5.8;});
 y+=3;
 doc.setFillColor(243,246,244);doc.rect(L,y-4.5,U,m.account.length*5.6+2.5,'F');
 m.account.forEach(a=>{text(a.label,L+4,9.5,'normal',MUTED);text(a.value,R-4,9.5,'bold',INK,'right');y+=5.6;});
 y+=4;
 if(m.note){page(8);y+=text(`Note: ${m.note}`,L,9,'italic',MUTED,'left',U)+2;}
 if(m.adjustments.length){page(14);y+=3;text('Later adjustments',L,11,'bold',brand);y+=6;
  for(const a of m.adjustments){const lines=[`${a.label} · ${a.ref} · Job ${a.job}`,...a.lines];page(lines.length*3.8+3);text(lines[0],L,9,'bold');y+=4.2;for(const line of lines.slice(1)){y+=text(line,L+3,8.2,'normal',MUTED,'left',U-3);}y+=2;}}
 if(m.footer){page(14);y+=6;doc.setDrawColor(...RULE);doc.line(L,y-4,R,y-4);text(m.footer,W/2,10,'normal',MUTED,'center',U);}
 const pages=doc.getNumberOfPages();
 for(let p=1;p<=pages;p++){doc.setPage(p);doc.setFont(PDF_FONT,'normal');doc.setFontSize(7.5);doc.setTextColor(...MUTED);doc.text(pdfText(`${m.title} ${m.number}`),L,H-9);if(pages>1)doc.text(`Page ${p} of ${pages}`,R,H-9,{align:'right'});}
}

/** 80mm roll receipt, monochrome, exactly as tall as its content. Returns the content height. */
function drawRoll(doc:jsPDF,m:Model){
 const W=80,L=4,R=W-4,U=R-L,C=W/2;
 let y=5;
 const text=(t:string,x:number,size:number,style:'normal'|'bold'|'italic'='normal',align:'left'|'right'|'center'='left',width=U)=>{
  doc.setFont(PDF_FONT,style);doc.setFontSize(size);doc.setTextColor(0,0,0);
  const lines=doc.splitTextToSize(pdfText(t),width) as string[];lines.forEach((line,i)=>doc.text(line,x,y+size*0.35+i*size*0.4,{align}));return lines.length*size*0.4;
 };
 const pair=(k:string,v:string,size=8,style:'normal'|'bold'='normal')=>{doc.setFont(PDF_FONT,style);doc.setFontSize(size);const vw=doc.getTextWidth(pdfText(v));const h=text(k,L,size,style,'left',U-vw-3);text(v,R,size,style,'right',vw+1);y+=Math.max(h,size*0.4)+0.8;};
 const rule=(dash=true)=>{doc.setDrawColor(0,0,0);doc.setLineWidth(dash?0.2:0.5);if(dash)doc.setLineDashPattern([0.8,0.8],0);doc.line(L,y,R,y);doc.setLineDashPattern([],0);doc.setLineWidth(0.2);y+=2.5;};
 const logo=m.business.logo?imageInfo(doc,m.business.logo):null;
 if(logo){const s=Math.min(46/logo.w,20/logo.h);doc.addImage(m.business.logo,logo.type,C-logo.w*s/2,y,logo.w*s,logo.h*s,'logo','FAST');y+=logo.h*s+2;}
 y+=text(m.business.name.toUpperCase(),C,12,'bold','center')+0.5;
 for(const line of [m.business.address,...m.business.contacts].filter(Boolean))y+=text(line,C,7.2,'normal','center');
 y+=1.5;rule(false);y+=text(m.title.toUpperCase(),C,10.5,'bold','center')+0.5;rule(false);
 for(const n of m.notices){y+=text(n,C,7.5,'bold','center')+1;}
 pair('Receipt no.',m.number);pair('Date',m.date);pair('Customer',m.customer.name);if(m.customer.phone)pair('Phone',m.customer.phone);pair('Cashier',m.cashier);pair('Payment date',m.paidOn);
 y+=0.5;rule();
 for(const i of m.items){
  y+=text(i.description,L,8.6,'bold')+0.3;
  y+=text(`${i.service} · ${i.ref}${i.details.length?' · '+i.details.join(' · '):''}`,L,6.8)+0.6;
  pair('Amount',i.amount,7.8);if(i.paidBefore)pair('Paid before',i.paidBefore,7.8);pair('Paid now',i.paidNow,7.8);pair('Balance',i.balance,7.8,'bold');y+=1;
 }
 if(m.items.length)rule();
 m.totals.forEach((t,k)=>{const last=k===m.totals.length-1&&t.strong;if(last){y+=0.5;rule(false);}pair(t.label,t.value,last?9.6:8,t.strong?'bold':'normal');});
 rule();
 for(const a of m.account)pair(a.label,a.value,7.8);
 if(m.note){y+=1;y+=text(`Note: ${m.note}`,L,7,'italic');}
 if(m.adjustments.length){y+=1.5;y+=text('LATER ADJUSTMENTS',L,7.8,'bold')+0.5;for(const a of m.adjustments){y+=text(`${a.label} · ${a.ref} · Job ${a.job}`,L,7,'bold');for(const line of a.lines)y+=text(line,L+1.5,6.5,'normal','left',U-1.5);y+=1;}}
 if(m.footer){y+=2.5;y+=text(m.footer,C,8,'normal','center');}
 y+=1.5;y+=text(`${m.title} ${m.number}`,C,6.5,'normal','center');
 return y+5;
}

export function createReceiptPdf(record:CheckoutRecord,business:string|Branding,pending=false,adjustments:SaleAdjustment[]=[],size:ReceiptPdfSize='a4'){
 const warning=receiptIntegrityError(record);if(warning)throw Error(warning);
 const m=receiptModel(record,business,pending,adjustments);
 if(size==='roll'){
  // Measure on a long strip, then draw again on a page cut to the content's height.
  const probe=new jsPDF({unit:'mm',format:[80,2000]});registerPdfFonts(probe);
  const height=Math.max(80,Math.ceil(drawRoll(probe,m)));
  const doc=new jsPDF({unit:'mm',format:[80,height]});registerPdfFonts(doc);drawRoll(doc,m);return doc;
 }
 const doc=new jsPDF({unit:'mm',format:'a4'});registerPdfFonts(doc);
 drawA4(doc,m,!!receiptBusiness(business).documents?.watermark);
 return doc;
}
export function downloadReceiptPdf(record:CheckoutRecord,business:string|Branding,pending=false,adjustments:SaleAdjustment[]=[],size:ReceiptPdfSize='a4'){
 createReceiptPdf(record,business,pending,adjustments,size).save(`Receipt-${record.id.slice(0,8).toUpperCase()}${record.corrected?'-corrected':''}${size==='roll'?'-80mm':''}.pdf`);
}
