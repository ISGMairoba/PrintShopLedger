import {createClient,type SupabaseClient} from '@supabase/supabase-js';
type Approval={scope:string;shopId:string;client:SupabaseClient;expires:number};
let approval:Approval|null=null;
export function clearConflictApproval(){const old=approval;approval=null;if(old)void old.client.auth.signOut({scope:'local'});}
export async function approveConflictReview(business:SupabaseClient,scope:string,shopId:string,username:string,password:string){
 clearConflictApproval();
 const {data,error}=await business.functions.invoke('staff-login',{body:{shopId,username,password}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
 const client=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'printshopledger-conflict-supervisor'}});
 try{
  const {error:sessionError}=await client.auth.setSession(data);if(sessionError)throw sessionError;
  const {data:shops,error:lookupError}=await client.rpc('list_my_shops').abortSignal(AbortSignal.timeout(20000));
  if(lookupError)throw lookupError;
  const member=shops?.find((item:{id:string;accessLevel:number})=>item.id===shopId&&item.accessLevel>=2);
  if(!member)throw Error('Admin, Manager or Developer access is required to review conflicts.');
  approval={scope,shopId,client,expires:Date.now()+5*60000};return member.staffName||member.username||'Supervisor';
 }catch(error){await client.auth.signOut({scope:'local'});throw error;}
}
export async function requireConflictReviewer(staff:SupabaseClient,scope:string,shopId:string){
 const {data,error}=await staff.rpc('list_my_shops').abortSignal(AbortSignal.timeout(20000));if(error)throw Error(error.message);
 if(data?.some((item:{id:string;accessLevel:number})=>item.id===shopId&&item.accessLevel>=2))return staff;
 const current=approval;
 if(!current||current.scope!==scope||current.shopId!==shopId||current.expires<Date.now()){clearConflictApproval();throw Error('An Admin or higher rank must sign in to review this conflict.');}
 const {data:shops,error:lookupError}=await current.client.rpc('list_my_shops').abortSignal(AbortSignal.timeout(20000));
 if(lookupError||!shops?.some((item:{id:string;accessLevel:number})=>item.id===shopId&&item.accessLevel>=2)){clearConflictApproval();throw Error('Supervisor access is no longer available. Ask an Admin to sign in again.');}
 return current.client;
}
