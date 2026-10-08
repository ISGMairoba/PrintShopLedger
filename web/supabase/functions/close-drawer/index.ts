import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers});
 if(request.method!=='POST')return reply(405,{error:'Use POST.'});
 const authorization=request.headers.get('Authorization')??'';
 if(!authorization.startsWith('Bearer '))return reply(401,{error:'Sign in first.'});
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
 const caller=createClient(url,key,{auth:{persistSession:false}});
 const {data:auth,error:authError}=await caller.auth.getUser(authorization.slice(7));
 if(authError||!auth.user)return reply(401,{error:'Sign in first.'});
 const server=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const currentLogin=createClient(url,key,{auth:{persistSession:false}}),nextLogin=createClient(url,key,{auth:{persistSession:false}});
 let successful=false;
 try{
  const body=await request.json();
  if(!uuid(body.shopId)||!uuid(body.id)||typeof body.currentPassword!=='string'||typeof body.nextPassword!=='string'||typeof body.nextUsername!=='string'||!Number.isSafeInteger(body.countedCash)||body.countedCash<0||body.countedCash>100000000000||!Array.isArray(body.checkoutIds)||body.checkoutIds.length>10000||!body.checkoutIds.every(uuid)||(body.openingId!==null&&!uuid(body.openingId))||typeof body.note!=='string'||body.note.length>500)return reply(400,{error:'Check the handover details.'});
  const {data:actor,error:actorError}=await server.from('shop_members').select('user_id,name,archived,access_level').eq('shop_id',body.shopId).eq('user_id',auth.user.id).maybeSingle();
  const {data:receiver,error:receiverError}=await server.from('shop_members').select('user_id,name,archived,access_level').eq('shop_id',body.shopId).eq('username',body.nextUsername.trim().toLowerCase()).maybeSingle();
  if(actorError||receiverError||!actor||!receiver||actor.archived||receiver.archived||!actor.access_level||!receiver.access_level)return reply(401,{error:'Check both passwords and the receiving username. Both users must have active business access.'});
  if(actor.user_id===receiver.user_id)return reply(400,{error:'Choose a different receiving user.'});
  const identities=await Promise.all([server.auth.admin.getUserById(actor.user_id),server.auth.admin.getUserById(receiver.user_id)]);
  if(identities.some(item=>item.error||!item.data.user?.email))return reply(401,{error:'Check both users’ credentials.'});
  const current=await currentLogin.auth.signInWithPassword({email:identities[0].data.user!.email!,password:body.currentPassword});
  if(current.error||!current.data.session||current.data.user?.id!==actor.user_id)return reply(401,{error:'Check both users’ credentials.'});
  const next=await nextLogin.auth.signInWithPassword({email:identities[1].data.user!.email!,password:body.nextPassword});
  if(next.error||!next.data.session||next.data.user?.id!==receiver.user_id)return reply(401,{error:'Check both users’ credentials.'});
  // SQL rechecks active membership, locks the business and verifies the exact unclosed transactions.
  const {data:closing,error}=await server.rpc('finish_drawer_handover',{p_shop:body.shopId,p_actor:auth.user.id,p_receiver:receiver.user_id,p_id:body.id,p_counted:body.countedCash,p_checkouts:body.checkoutIds,p_opening:body.openingId,p_note:body.note.trim()});
  if(error)return reply(['PT409','40001'].includes(error.code)?409:400,{error:error.message});
  successful=true;
  return reply(200,{closing,access_token:next.data.session.access_token,refresh_token:next.data.session.refresh_token});
 }catch{return reply(400,{error:'Could not complete the handover. Review the drawer and retry.'});}
 finally{
  // Temporary password-verification sessions never replace the cashier's session on failure.
  await currentLogin.auth.signOut({scope:'local'}).catch(()=>{});
  if(!successful)await nextLogin.auth.signOut({scope:'local'}).catch(()=>{});
 }
});
