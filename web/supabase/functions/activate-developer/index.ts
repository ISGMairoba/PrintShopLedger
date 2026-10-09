import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {validActivationToken,validateNewPassword} from '../../../src/registration.mjs';
const headers={'Access-Control-Allow-Origin':'https://print-shop-ledger.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Content-Type':'application/json'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply(405,{error:'Use POST.'});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 let hash:string|null=null,claim=crypto.randomUUID();
 try{
  const body=await req.json();
  if(!validActivationToken(body.token))return reply(400,{error:'Activation link is invalid or expired.'});
  validateNewPassword(body.password);
  hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.token))),b=>b.toString(16).padStart(2,'0')).join('');
  const {data:target,error:denied}=await admin.rpc('claim_developer_activation',{p_hash:hash,p_claim:claim});
  if(denied||!target)return reply(400,{error:'Activation link is invalid, expired or already used.'});
  const {error:updateError}=await admin.auth.admin.updateUserById(target.userId,{password:body.password});
  if(updateError){await admin.rpc('finish_developer_activation',{p_hash:hash,p_claim:claim,p_success:false});return reply(400,{error:updateError.message});}
  const {data:result,error:finishError}=await admin.rpc('finish_developer_activation',{p_hash:hash,p_claim:claim,p_success:true});
  if(finishError)return reply(503,{error:'Password saved, but activation needs verification. Retry this link before signing in.'});
  return reply(200,{success:true,...result});
 }catch{return reply(400,{error:'Could not activate the account. Use a valid link and a password with 12–128 characters.'});}
});
