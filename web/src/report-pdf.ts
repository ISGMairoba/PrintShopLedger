import {jsPDF,GState} from 'jspdf';
import {receiptBusiness,validLogo} from './business-branding.mjs';
import {registerPdfFonts,pdfText,PDF_FONT} from './pdf-common';
import type {Branding} from './useBusinessBranding';
import type {ReportSection} from './export-csv';

const FONT=PDF_FONT;
const latin=pdfText;

export type ReportPdfOptions={title:string;subtitle?:string[];sections:ReportSection[];generatedAt:string};

export function createReportPdf(business:string|Branding,options:ReportPdfOptions){
 const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
registerPdfFonts(doc);
 const pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight(),margin=14,usable=pageW-margin*2,bottom=pageH-14;
 const b=receiptBusiness(business);
 let logo:{data:string;type:string;w:number;h:number}|null=null;
 if(b.logo&&validLogo(b.logo)){try{const image=doc.getImageProperties(b.logo);logo={data:b.logo,type:image.fileType,w:image.width,h:image.height};}catch{/* A broken logo must not block the report. */}}
 // Faint centred logo behind each page's content, when the business turns it on.
 const watermark=()=>{
  if(!logo||!b.documents?.watermark)return;
  const scale=Math.min(150/logo.w,110/logo.h),w=logo.w*scale,h=logo.h*scale;
  doc.setGState(new GState({opacity:0.07}));
  doc.addImage(logo.data,logo.type,(pageW-w)/2,(pageH-h)/2,w,h,'watermark','FAST');
  doc.setGState(new GState({opacity:1}));
 };
 const newPage=()=>{doc.addPage();watermark();return margin;};
 watermark();
 let y=margin;
 const write=(text:string,size:number,style:'normal'|'bold'|'italic',colour:[number,number,number],width:number)=>{
  doc.setFont(FONT,style);doc.setFontSize(size);doc.setTextColor(...colour);
  for(const row of doc.splitTextToSize(latin(text),width) as string[]){if(y>bottom)y=newPage();doc.text(row,margin,y+size*0.35);y+=size*0.45;}
 };
 // Header: business identity on the left, a larger logo on the right.
 let logoBottom=margin;
 let textWidth=usable;
 if(logo){
  const scale=Math.min(70/logo.w,32/logo.h),w=logo.w*scale,h=logo.h*scale;
  doc.addImage(logo.data,logo.type,pageW-margin-w,margin,w,h,'logo','FAST');
  logoBottom=margin+h;textWidth=usable-w-8;
 }
 write(b.businessName||'Business',14,'bold',[20,20,20],textWidth);
 const contacts=[b.address,[b.phones,b.email,b.website].filter(Boolean).join('  |  ')].filter(Boolean);
 for(const line of contacts)write(line,8.5,'normal',[90,90,90],textWidth);
 y=Math.max(y,logoBottom)+5;
 doc.setDrawColor(200,205,200);doc.line(margin,y-2,margin+usable,y-2);
 y+=2;write(options.title,15,'bold',[20,20,20],usable);
 for(const line of options.subtitle??[])write(line,9.5,'normal',[60,60,60],usable);
 y+=2;

 for(const section of options.sections){
  const weights=section.widths??section.columns.map(()=>1);
  const total=weights.reduce((n,w)=>n+w,0);
  const widths=weights.map(w=>usable*w/total);
  const right=new Set(section.numeric??[]);
  const pad=1.6,size=8.2,lineH=3.6;
  const drawRow=(cells:(string|number)[],header:boolean)=>{
   doc.setFont(FONT,header?'bold':'normal');doc.setFontSize(size);
   const wrapped=cells.map((cell,i)=>doc.splitTextToSize(latin(cell),widths[i]-pad*2) as string[]);
   const height=Math.max(...wrapped.map(lines=>lines.length))*lineH+pad*2;
   if(y+height>bottom){y=newPage();if(!header)drawRow(section.columns,true);doc.setFont(FONT,'normal');doc.setFontSize(size);}
   if(header){doc.setFillColor(236,238,236);doc.rect(margin,y,usable,height,'F');}
   let x=margin;
   wrapped.forEach((lines,i)=>{doc.setTextColor(20,20,20);lines.forEach((line,k)=>{const ty=y+pad+lineH*(k+0.75);if(right.has(i))doc.text(line,x+widths[i]-pad,ty,{align:'right'});else doc.text(line,x+pad,ty);});x+=widths[i];});
   doc.setDrawColor(215,218,215);doc.line(margin,y+height,margin+usable,y+height);
   y+=height;
  };
  if(y+20>bottom)y=newPage();
  y+=4;write(section.title,11,'bold',[20,20,20],usable);y+=1;
  drawRow(section.columns,true);
  if(section.rows.length)for(const row of section.rows)drawRow(row,false);
  else{doc.setFont(FONT,'italic');doc.setFontSize(size);doc.setTextColor(110,110,110);doc.text('None',margin+pad,y+4.5);y+=7;}
 }
 // Footer on every page: generated time and page count.
 const pages=doc.getNumberOfPages();
 const stamp=new Date(options.generatedAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'});
 for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont(FONT,'normal');doc.setFontSize(7.5);doc.setTextColor(120,120,120);doc.text(latin(`Generated ${stamp} (Africa/Lagos)`),margin,pageH-7);doc.text(`Page ${i} of ${pages}`,pageW-margin,pageH-7,{align:'right'});}
 return doc;
}

export function downloadReportPdf(fileName:string,business:string|Branding,options:ReportPdfOptions){
 createReportPdf(business,options).save(fileName.endsWith('.pdf')?fileName:fileName+'.pdf');
}
