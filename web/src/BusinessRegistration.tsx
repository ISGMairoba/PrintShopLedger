import {useState,type FormEvent} from 'react';
import {businessAuth,supabase} from './cloud';
import {validateSignup,validateNewPassword} from './registration.mjs';
import {FeedbackBanner} from './Feedback';
export async function registrationError(error:unknown){
 const response=(error as {context?:Response})?.context;
 if(response)try{return (await response.json()).error||'Could not complete the request.';}catch{}
 return error instanceof Error?error.message:'Could not complete the request.';
}
export function BusinessSignup({online,onBack}:{online:boolean;onBack:()=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[sent,setSent]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||!online||!businessAuth)return;
  setBusy(true);setMessage('');
  try{
   const profile=validateSignup(Object.fromEntries(new FormData(event.currentTarget)));
   const {error}=await businessAuth.auth.signUp({email:profile.email,password:profile.password,options:{emailRedirectTo:'https://print-shop-ledger.vercel.app/',data:{full_name:profile.ownerName,business_name:profile.businessName}}});
   if(error)throw error;
   setSent(true);setMessage('Check your email to confirm your address. Then sign in here to finish creating your business.');
  }catch(error){setMessage(await registrationError(error));}finally{setBusy(false);}
 }
 return <main className="auth"><section className="auth-card"><h1>Register your business</h1><p>Your business will have its own customers, jobs, payments and stock.</p>{!sent&&<form onSubmit={submit}><label>Business name<input name="businessName" maxLength={160} required autoComplete="organization"/></label><label>Owner’s full name<input name="ownerName" maxLength={160} required autoComplete="name"/></label><label>Business email<input name="email" type="email" required autoComplete="email" maxLength={254}/></label><label>Password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><label>Confirm password<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><small>Use 12–128 characters. Your first staff account will be Manager. A separate Developer account handles maintenance.</small><button disabled={busy||!online}>{busy?'Registering…':'Register business'}</button></form>}<FeedbackBanner message={message} tone={sent?'success':'error'} login/><button className="secondary" disabled={busy} onClick={onBack}>{sent?'Back to sign in':'Already registered? Sign in'}</button></section></main>;
}
export function DeveloperActivation({token,online}:{token:string;online:boolean}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[complete,setComplete]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||!online||!supabase)return;setBusy(true);setMessage('');
  try{
   const form=new FormData(event.currentTarget),password=validateNewPassword(String(form.get('password')),String(form.get('confirmPassword')));
   const {data,error}=await supabase.functions.invoke('activate-developer',{body:{token,password}});
   if(error)throw error;
   if(!data?.success)throw Error('Activation was not confirmed.');
   setComplete(true);setMessage(`Developer account activated for ${data.businessName}. Username: developer. Sign in to the business first, then use this staff account.`);
   history.replaceState(null,'',location.pathname+location.search);
  }catch(error){setMessage(await registrationError(error));}finally{setBusy(false);}
 }
 return <main className="auth"><section className="auth-card"><h1>Activate Developer account</h1><p>Set a password for this business’s maintenance account.</p>{!complete&&<form onSubmit={submit}><label>New password<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label><label>Confirm password<input name="confirmPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label><button disabled={busy||!online}>{busy?'Activating…':'Activate account'}</button></form>}<FeedbackBanner message={message} tone={complete?'success':'error'} login/>{complete&&<button className="secondary" onClick={()=>location.assign('/')}>Open sign in</button>}</section></main>;
}
