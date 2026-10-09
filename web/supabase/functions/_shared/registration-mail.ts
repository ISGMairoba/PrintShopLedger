import {developerActivationEmail} from '../../../src/registration.mjs';
export async function deliverRegistrationMail(admin:any,shopId:string|null=null){
 const apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('REGISTRATION_MAIL_FROM');
 if(!apiKey||!from)return {sent:0,queued:true,reason:'Email sender is not configured.'};
 const {data:rows,error}=await admin.rpc('claim_registration_mail',{p_shop:shopId});
 if(error)throw Error(error.message);
 let sent=0;
 for(const row of rows??[]){
  try{
   const message=developerActivationEmail(row);
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'registration-'+row.id},body:JSON.stringify({from,to:[row.recipient],...message}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Mail provider returned HTTP '+response.status);
   const result=await response.json();
   const {error:saved}=await admin.rpc('finish_registration_mail',{p_id:row.id,p_claim:row.claim_id,p_sent:true,p_error:null,p_provider_id:result.id??null});
   if(saved)throw Error(saved.message);sent++;
  }catch{
   // Do not persist provider responses, credentials or activation URLs in logs.
   await admin.rpc('finish_registration_mail',{p_id:row.id,p_claim:row.claim_id,p_sent:false,p_error:'Delivery failed. Scheduled retry will follow.',p_provider_id:null});
  }
 }
 return {sent,queued:sent<(rows?.length??0)};
}
