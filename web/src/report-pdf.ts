import {jsPDF} from 'jspdf';
import {receiptBusiness,validLogo} from './business-branding.mjs';
import type {Branding} from './useBusinessBranding';
import type {ReportSection} from './export-csv';

// Built-in PDF fonts are Latin-1 only; keep other characters legible without corrupting text.
const latin=(value:unknown)=>String(value??'').replace(/[^\x20-\x7e\xa0-\xff\n]/g,'?');

export type ReportPdfOptions={
 title:string;
 subtitle?:string[];
 sections:ReportSection[];
 /** Relative widths per column index for a section title; defaults to equal widths. */
 widths?:Record<string,number[]>;
 /** Columns (by index) to right-align, per section title. */
 numeric?:Record<string,number[]>;
 generatedAt:string;
};

export function createReportPdf(business:string|Branding,options:ReportPdfOptions){
 const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
 const pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight(),margin=14,usable=pageW-margin*2,bottom=pageH-14;
 const b=receiptBusiness(business);
 let y=margin;
 const write=(text:string,size=10,bold=false,colour:[number,number,number]=[20,20,20])=>{
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...colour);
  for(const row of doc.splitTextToSize(latin(text),usable) as string[]){if(y>bottom){doc.addPage();y=margin;}doc.text(row,margin,y);y+=size*0.45;}
 };
 // Header: logo, business identity, report title.
 if(b.logo&&validLogo(b.logo)){try{const image=doc.getImageProperties(b.logo);const scale=Math.min(45/image.width,18/image.height);doc.addImage(b.logo,image.fileType,margin,y,image.width*scale,image.height*scale);y+=image.height*scale+4;}catch{/* A broken logo must not block the report. */}}
 write(b.businessName||'Business',13,true);
 const contacts=[b.address,b.phones,b.email,b.website].filter(Boolean).join('  |  ');
 if(contacts)write(contacts,8.5,false,[90,90,90]);
 y+=3;write(options.title,15,true);
 for(const line of options.subtitle??[])write(line,9.5,false,[60,60,60]);
 y+=2;

 for(const section of options.sections){
  const weights=options.widths?.[section.title]??section.columns.map(()=>1);
  const total=weights.reduce((n,w)=>n+w,0);
  const widths=weights.map(w=>usable*w/total);
  const right=new Set(options.numeric?.[section.title]??[]);
  const pad=1.6,size=8.2,lineH=3.6;
  const drawRow=(cells:(string|number)[],header:boolean)=>{
   doc.setFont('helvetica',header?'bold':'normal');doc.setFontSize(size);
   const wrapped=cells.map((cell,i)=>doc.splitTextToSize(latin(cell),widths[i]-pad*2) as string[]);
   const height=Math.max(...wrapped.map(lines=>lines.length))*lineH+pad*2;
   if(y+height>bottom){doc.addPage();y=margin;if(!header)drawRow(section.columns,true);doc.setFont('helvetica','normal');doc.setFontSize(size);}
   if(header){doc.setFillColor(236,238,236);doc.rect(margin,y,usable,height,'F');}
   let x=margin;
   wrapped.forEach((lines,i)=>{doc.setTextColor(20,20,20);lines.forEach((line,k)=>{const ty=y+pad+lineH*(k+0.75);if(right.has(i))doc.text(line,x+widths[i]-pad,ty,{align:'right'});else doc.text(line,x+pad,ty);});x+=widths[i];});
   doc.setDrawColor(215,218,215);doc.line(margin,y+height,margin+usable,y+height);
   y+=height;
  };
  if(y+20>bottom){doc.addPage();y=margin;}
  y+=4;write(section.title,11,true);y+=1;
  drawRow(section.columns,true);
  if(section.rows.length)for(const row of section.rows)drawRow(row,false);
  else{doc.setFont('helvetica','italic');doc.setFontSize(size);doc.setTextColor(110,110,110);doc.text('None',margin+pad,y+4.5);y+=7;}
 }
 // Footer on every page: generated time and page count.
 const pages=doc.getNumberOfPages();
 const stamp=new Date(options.generatedAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'});
 for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(120,120,120);doc.text(latin(`Generated ${stamp} (Africa/Lagos)`),margin,pageH-7);doc.text(`Page ${i} of ${pages}`,pageW-margin,pageH-7,{align:'right'});}
 return doc;
}

export function downloadReportPdf(fileName:string,business:string|Branding,options:ReportPdfOptions){
 createReportPdf(business,options).save(fileName.endsWith('.pdf')?fileName:fileName+'.pdf');
}
