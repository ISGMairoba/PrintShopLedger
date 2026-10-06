import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './cloud';
import Modal from './Modal';
import Icon from './Icon';
import { SortHeader, useTableSort } from './TableSort';
import { accessLevels, userCode, validateUser } from './users.mjs';

type Staff = { id:string;userId:string;name:string;username:string;rank:string;role:'admin'|'manager'|'cashier';email:string;archived:boolean;version:number;lastLogin:string|null;createdAt:string;createdByLabel:string;modifiedAt:string;modifiedByLabel:string };
type Props = { shopId:string; actorId:string; role:string; online:boolean; demo:boolean };
const date = (value:string|null) => value ? new Date(value).toLocaleString('en-NG',{timeZone:'Africa/Lagos'}) : 'Never';
export default function UsersPage({shopId,actorId,role,online,demo}:Props) {
 const [users,setUsers]=useState<Staff[]>([]);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState('active');
 const [audit,setAudit]=useState(false);
 const [editor,setEditor]=useState<Staff|'new'|null>(null);
 const [confirmation,setConfirmation]=useState<Staff|null>(null);
 const [error,setError]=useState('');
 const [formError,setFormError]=useState('');
 const sorting=useTableSort<Staff>('name');
 const allowed=!demo&&role==='admin';
 async function load() {
  if(!supabase||!allowed||!online) return;
  const {data,error:failure}=await supabase.rpc('list_shop_users',{p_shop:shopId});
  if(failure) throw new Error(failure.message);
  setUsers(data??[]);setReady(true);
 }
 useEffect(()=>{
  let active=true;
  setReady(false);setUsers([]);
  if(supabase&&allowed&&online) {
   Promise.resolve(supabase.rpc('list_shop_users',{p_shop:shopId})).then(({data,error:failure})=>{
    if(!active)return;
    if(failure)setError(failure.message);else{setUsers(data??[]);setReady(true);}
   }).catch(cause=>{if(active)setError(String(cause));});
  }
  return()=>{active=false;};
 },[shopId,allowed,online]);
 async function save(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy||!supabase||!online||!allowed)return;
  setFormError('');setBusy(true);
  try{
   const form=new FormData(event.currentTarget);
   const profile=validateUser(Object.fromEntries(form.entries()));
   if(editor==='new'){
    const password=String(form.get('password')??'');
    if(password.length<12||password.length>128)throw new Error('Use a password with 12–128 characters.');
    const {data,error:failure}=await supabase.functions.invoke('manage-users',{body:{shopId,...profile,email:String(form.get('email')??''),password}});
    if(failure){
     const response=(failure as {context?:Response}).context;
     let message=failure.message;
     if(response)try{message=(await response.json()).error||message;}catch{}
     throw new Error(message);
    }
    if(data?.error)throw new Error(data.error);
   }else if(editor){
    const {error:failure}=await supabase.rpc('save_shop_user',{p_shop:shopId,p_action:'edit',p_data:{...profile,id:editor.id,version:editor.version}});
    if(failure)throw new Error(failure.message);
   }
   setEditor(null);setError('');
   try{await load();}catch{setError('User saved. Refresh to load the latest list.');}
  }catch(cause){setFormError(cause instanceof Error?cause.message:'Could not save user.');}
  finally{setBusy(false);}
 }
 async function changeStatus(){
  if(!confirmation||busy||!supabase||!online||!allowed)return;
  setBusy(true);setFormError('');
  try{
   const {error:failure}=await supabase.rpc('save_shop_user',{p_shop:shopId,p_action:confirmation.archived?'restore':'archive',p_data:{id:confirmation.id,version:confirmation.version}});
   if(failure)throw new Error(failure.message);
   setConfirmation(null);setError('');
   try{await load();}catch{setError('Status saved. Refresh to load the latest list.');}
  }catch(cause){setFormError(cause instanceof Error?cause.message:'Could not save user.');}
  finally{setBusy(false);}
 }
 const visible=sorting.sortRows(users.filter(user=>(filter==='all'||user.archived===(filter==='archived'))&&
  [userCode(user.id),user.name,user.username,user.rank,accessLevels[user.role],user.email,date(user.lastLogin),user.createdByLabel,date(user.createdAt),user.modifiedByLabel,date(user.modifiedAt),user.archived?'Archived':'Active'].join(' ').toLowerCase().includes(query.trim().toLowerCase())),
  {id:u=>userCode(u.id),name:u=>u.name,username:u=>u.username,rank:u=>u.rank,role:u=>accessLevels[u.role],email:u=>u.email,lastLogin:u=>u.lastLogin?Date.parse(u.lastLogin):0,status:u=>u.archived,createdBy:u=>u.createdByLabel,createdAt:u=>Date.parse(u.createdAt),modifiedBy:u=>u.modifiedByLabel,modifiedAt:u=>Date.parse(u.modifiedAt)});
 const heading=(column:string,label:string)=><SortHeader column={column} label={label} sort={sorting}/>;
 if(!allowed)return <section className="panel"><div className="empty"><h2>{demo?'Sign in to manage users':'Administrator access required'}</h2><p>{demo?'Users belong to a signed-in business workspace.':'Only active administrators can create, edit or archive business users.'}</p></div></section>;
 return <>
 <section className="panel">
 <div className="toolbar">
  <input aria-label="Search users" placeholder="Search any user field" value={query} onChange={e=>setQuery(e.target.value)}/>
  <select aria-label="User status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All users</option></select>
  <button className="secondary" aria-pressed={audit} onClick={()=>setAudit(!audit)}><Icon name={audit?'table':'audit'}/> {audit?'Normal view':'Audit view'}</button>
  <button className="secondary" disabled={busy||!online} onClick={()=>{setError('');void load().catch(cause=>setError(cause.message));}}><Icon name="sync"/> Refresh</button>
  <button disabled={busy||!ready||!online} onClick={()=>{setEditor('new');setFormError('');}}><Icon name="add"/> Add user</button>
 </div>
 {!online&&<div className="notice">Connect to the internet to manage user accounts.</div>}
 {error&&<div className="notice" role="alert">{error}</div>}
 {!ready?<div className="empty">{online?'Loading users…':'User management is available online.'}</div>:!visible.length?<div className="empty">No matching users.</div>:
 <div className="table-wrap"><table><thead><tr>{heading('id','User ID')}{heading('name','Name')}{heading('username','Username')}{heading('rank','Rank')}{heading('role','Access level')}{heading('email','Email')}{heading('lastLogin','Last login')}{heading('status','Status')}
 {audit&&<>{heading('createdBy','Created by')}{heading('createdAt','Created at')}{heading('modifiedBy','Modified by')}{heading('modifiedAt','Modified at')}</>}<th>Actions</th></tr></thead><tbody>
 {visible.map(user=><tr key={user.id}><td className="material-id">{userCode(user.id)}</td><td><strong>{user.name}</strong>{user.userId===actorId?' (you)':''}</td><td>{user.username}</td><td>{user.rank}</td><td>{accessLevels[user.role]}</td><td>{user.email}</td><td>{date(user.lastLogin)}</td><td><span className={`badge ${user.archived?'unpaid':'paid'}`}>{user.archived?'Archived':'Active'}</span></td>
 {audit&&<><td>{user.createdByLabel}</td><td>{date(user.createdAt)}</td><td>{user.modifiedByLabel}</td><td>{date(user.modifiedAt)}</td></>}
 <td><div className="material-actions">{!user.archived&&<button className="text-button" disabled={busy||!online} onClick={()=>{setEditor(user);setFormError('');}}><Icon name="edit"/> Edit</button>}
 <button className={`text-button ${user.archived?'':'danger-text'}`} disabled={busy||!online||user.userId===actorId} onClick={()=>{setConfirmation(user);setFormError('');}}><Icon name={user.archived?'restore':'archive'}/> {user.archived?'Restore':'Archive'}</button></div></td></tr>)}
 </tbody></table></div>}
 <p className="muted">Rank is a job title. Administrators manage users and all modules; managers manage operations; cashiers record customers, jobs and payments and view the catalogue. Last login is the account's latest sign-in.</p>
 </section>
 {editor&&<Modal title={editor==='new'?'Add user':'Edit user'} busy={busy} onClose={()=>setEditor(null)}>
 {formError&&<div className="notice" role="alert">{formError}</div>}
 <form className="form-grid" onSubmit={save}>
 <label>Name<input name="name" defaultValue={editor==='new'?'':editor.name} maxLength={160} required/></label>
 <label>Username<input name="username" defaultValue={editor==='new'?'':editor.username} minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoComplete="off" required/></label>
 <label>Rank / job title<input name="rank" defaultValue={editor==='new'?'Staff':editor.rank} maxLength={80} list="staff-ranks" required/><datalist id="staff-ranks">{['Owner','Administrator','Manager','Cashier','Operator','Staff'].map(value=><option key={value} value={value}/>)}</datalist></label>
 <label>Access level<select name="role" defaultValue={editor==='new'?'cashier':editor.role}>{Object.entries(accessLevels).map(([value,label])=><option value={value} key={value} disabled={editor!=='new'&&editor.userId===actorId&&value!=='admin'}>{label}</option>)}</select></label>
 {editor==='new'?<><label>Email<input name="email" type="email" maxLength={254} autoComplete="off" required/></label><label>Password<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label><p className="muted">The user signs in with this email and password. Account creation requires an internet connection.</p></>:<p className="muted">Login email: {editor.email}</p>}
 <div className="material-actions"><button disabled={busy||!online}><Icon name="save"/> {busy?'Saving…':'Save user'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button></div>
 </form></Modal>}
 {confirmation&&<Modal title={`${confirmation.archived?'Restore':'Archive'} ${confirmation.name}?`} busy={busy} onClose={()=>setConfirmation(null)}>
 {formError&&<div className="notice" role="alert">{formError}</div>}
 <p>{confirmation.archived?'Restore access to this business?':'This user will lose access to this business. Existing jobs, payments and audit records will remain.'}</p>
 <div className="material-actions"><button className={confirmation.archived?'':'danger-button'} disabled={busy||!online} onClick={()=>void changeStatus()}>{busy?'Saving…':confirmation.archived?'Restore user':'Archive user'}</button><button className="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>Cancel</button></div>
 </Modal>}
 </>;
}
