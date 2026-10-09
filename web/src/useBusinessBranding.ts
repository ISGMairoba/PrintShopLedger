import {useEffect,useRef,useState} from 'react';
import {supabase} from './cloud';
import {defaultBranding,validateBranding,themeVariables} from './business-branding.mjs';
export type Branding=ReturnType<typeof defaultBranding>;
type Saved={settings:Branding;version:number;modified_at?:string;modified_by?:string};
export default function useBusinessBranding(shopId:string,scope:string,name:string,online:boolean,demo:boolean){
 const [saved,setSaved]=useState<Saved>({settings:defaultBranding(),version:0}),[ready,setReady]=useState(false),[error,setError]=useState(''),[preference,setPreference]=useState('business');
 const key=`printshopledger:branding:v1:${scope}`;const current=useRef(scope);current.current=scope;
 const latest=useRef(saved);latest.current=saved;
 async function reload(){
  if(!scope)return;if(demo){setReady(true);return;}if(!online||!supabase){setReady(true);return;}
  const expected=scope;
  const {data,error}=await supabase.from('business_settings').select('settings,version,modified_at,modified_by').eq('shop_id',shopId).maybeSingle();
  if(current.current!==expected)return;
  if(error){setError(error.message);setReady(true);return;}
  const value:Saved=data?{...data,settings:validateBranding(data.settings)}:{settings:{...defaultBranding(),businessName:name},version:0};
  if(value.version<latest.current.version){setReady(true);return;}
  latest.current=value;
  setSaved(value);setError('');setReady(true);try{localStorage.setItem(key,JSON.stringify(value));}catch{setError('Settings loaded, but this device could not cache them for offline use.');}
 }
 useEffect(()=>{
  setReady(false);setError('');latest.current={settings:{...defaultBranding(),businessName:name},version:0};setSaved(latest.current);setPreference('business');
  try{const cache=JSON.parse(localStorage.getItem(key)??'null');if(cache){cache.settings=validateBranding(cache.settings);latest.current=cache;setSaved(cache);}const pref=localStorage.getItem(`printshopledger:theme:${scope}`);if(pref&&['business','light','dark','system'].includes(pref))setPreference(pref);}catch{}
  if(!scope)return;void reload();const timer=setInterval(()=>void reload(),60000);
  const listener=(event:StorageEvent)=>{if(event.key===key)void reload();};window.addEventListener('storage',listener);
  return()=>{clearInterval(timer);window.removeEventListener('storage',listener);};
 },[scope,shopId,online,demo]);
 async function save(settings:Branding,version:number){
  const value=validateBranding(settings);if(!scope)throw Error('Sign in first.');if(!demo&&(!navigator.onLine||!supabase))throw Error('Connect to save business settings.');
  const expected=scope;
  let result:Saved={settings:value,version:version+1,modified_at:new Date().toISOString()};
  if(!demo){const {data,error}=await supabase!.rpc('save_business_settings',{p_shop:shopId,p_version:version,p_settings:value});if(error)throw Error(error.message);result=data;}
  if(current.current!==expected)throw Error('The settings were saved. Reopen the business to review them.');
  latest.current=result;setSaved(result);setError('');try{localStorage.setItem(key,JSON.stringify(result));}catch{setError('Saved online; offline caching failed.');}return result;
 }
 function setTheme(value:string){if(!['business','light','dark','system'].includes(value))return;try{localStorage.setItem(`printshopledger:theme:${scope}`,value);setPreference(value);}catch{setError('Could not save your device theme preference.');throw Error('Could not save your device theme preference.');}}
 useEffect(()=>{
  const settings=scope?saved.settings:defaultBranding(),media=matchMedia('(prefers-color-scheme: dark)');
  const mode=scope&&preference!=='business'?preference:settings.theme;
  const apply=()=>{const resolved=mode==='system'?(media.matches?'dark':'light'):mode;document.documentElement.dataset.theme=resolved;for(const [key,value] of Object.entries(themeVariables(settings,resolved)))document.documentElement.style.setProperty(key,value);};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
 },[saved.settings,scope,preference]);
 return {settings:{...saved.settings,businessName:saved.settings.businessName||name},version:saved.version,modifiedAt:saved.modified_at,ready,error,save,reload,preference,setTheme};
}

