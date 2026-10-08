import {defaultOptions,validateOptions} from './business-options.mjs';
export const defaultBranding=()=>({businessName:'',address:'',phones:'',email:'',website:'',socials:'',logo:'',primary:'#124b40',accent:'#d9a126',theme:'system',options:defaultOptions(),receipt:{showLogo:true,showAddress:true,showContacts:true,footer:'Thank you for your business.'}});
export function validLogo(value){return value===''||typeof value==='string'&&value.length<=350000&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);}
export function validateBranding(input){
 const value=structuredClone(input);
 for(const [key,max] of Object.entries({businessName:160,address:500,phones:200,email:200,website:300,socials:500})){
  if(typeof value?.[key]!=='string'||value[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value[key]))throw Error(`Invalid ${key}.`);value[key]=value[key].trim();
 }
 if(!value.businessName)throw Error('Enter the business name.');
 if(value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))throw Error('Enter a valid email address.');
 if(value.website&&!/^https?:\/\/[^\s]+$/i.test(value.website))throw Error('Website must start with https:// or http://.');
 if(!validLogo(value.logo))throw Error('Choose a PNG or JPEG logo (up to 250 KB after processing).');
 for(const key of ['primary','accent'])if(!/^#[0-9a-f]{6}$/i.test(value[key]))throw Error('Choose valid brand colors.');
 if(!['light','dark','system'].includes(value.theme))throw Error('Choose Light, Dark or System.');
 for(const key of ['showLogo','showAddress','showContacts'])if(typeof value.receipt?.[key]!=='boolean')throw Error('Invalid receipt options.');
 if(typeof value.receipt.footer!=='string'||value.receipt.footer.length>500)throw Error('Receipt footer must be up to 500 characters.');
 value.receipt.footer=value.receipt.footer.trim();value.options=validateOptions(value.options);return value;
}
export function contrastText(hex){
 const channels=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 const luminance=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];return luminance>.179?'#000000':'#ffffff';
}
export function receiptBusiness(input){
 if(typeof input==='string')return {...defaultBranding(),businessName:input};
 return {...defaultBranding(),...input,receipt:{...defaultBranding().receipt,...input?.receipt}};
}
export function suggestedPalette(pixels){
 const buckets=new Map();for(let i=0;i<pixels.length;i+=4){const [r,g,b,a]=pixels.slice(i,i+4);if(a<180||Math.max(r,g,b)<25||Math.min(r,g,b)>235)continue;const rgb=[r,g,b].map(v=>Math.min(255,Math.round(v/24)*24));const key='#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');buckets.set(key,(buckets.get(key)||0)+1);}
 return [...buckets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([hex])=>hex);
}
