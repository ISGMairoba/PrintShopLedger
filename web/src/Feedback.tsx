import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
export type FeedbackTone='success'|'error'|'warning'|'info';
type Toast={id:number;message:string;tone:FeedbackTone};
const labels={success:'Success',error:'Action failed',warning:'Warning',info:'Notice'};
function MessageText({message}:{message:string}){const midpoint=Math.ceil(message.length/2);return <><span>{message.slice(0,midpoint)}</span><span>{message.slice(midpoint)}</span></>;}
const FeedbackContext=createContext<(message:string,tone:FeedbackTone)=>void>(()=>{});
function Notification({item,onDismiss}:{item:Toast;onDismiss:()=>void}){
 const [paused,setPaused]=useState(false);
 useEffect(()=>{if(paused||item.tone==='error'||item.tone==='warning')return;const timer=window.setTimeout(onDismiss,6000);return()=>clearTimeout(timer);},[item,paused,onDismiss]);
 return <div className={`feedback-toast notice-${item.tone}`} role="group" aria-live={item.tone==='error'||item.tone==='warning'?'assertive':'polite'} aria-atomic="true" aria-label={`${labels[item.tone]} notification`} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false);}}><span className="feedback-symbol" aria-hidden="true">{item.tone==='success'?'✓':item.tone==='info'?'i':'!'}</span><div><strong>{labels[item.tone]}</strong><p>{labels[item.tone]}: <MessageText message={item.message}/></p></div><button type="button" className="feedback-dismiss" aria-label={`Dismiss ${labels[item.tone].toLowerCase()} notification`} onClick={onDismiss}>×</button></div>;
}
export function FeedbackProvider({children}:{children:ReactNode}){
 const [items,setItems]=useState<Toast[]>([]),[host,setHost]=useState<HTMLElement>(document.body);
 const viewport=useRef<HTMLDivElement>(null),sequence=useRef(0);
 const notify=useCallback((message:string,tone:FeedbackTone)=>{if(!message)return;setItems(current=>{if(current.some(item=>item.message===message&&item.tone===tone))return current;return [...current.slice(-2),{id:++sequence.current,message,tone}];});},[]);
 useEffect(()=>{const update=()=>setHost(document.querySelector<HTMLElement>('dialog[open]:last-of-type')??document.body);window.addEventListener('feedback:modal',update);return()=>window.removeEventListener('feedback:modal',update);},[]);
 useLayoutEffect(()=>{const element=viewport.current;if(!element?.isConnected||!('showPopover' in element))return;if(items.length){if(element.matches(':popover-open'))element.hidePopover();element.showPopover();}else if(element.matches(':popover-open'))element.hidePopover();},[items,host]);
 return <FeedbackContext.Provider value={notify}>{children}{createPortal(<div className="feedback-viewport" ref={viewport} popover={'showPopover' in HTMLElement.prototype?'manual':undefined}>{items.map(item=><Notification key={item.id} item={item} onDismiss={()=>setItems(current=>current.filter(value=>value.id!==item.id))}/>)}</div>,host)}</FeedbackContext.Provider>;
}
export const useFeedback=()=>useContext(FeedbackContext);
export function useFeedbackMessage(defaultTone:FeedbackTone='info'){
 const notify=useFeedback(),[message,setValue]=useState(''),[tone,setTone]=useState(defaultTone);
 const setMessage=useCallback((value:string,severity:FeedbackTone=defaultTone)=>{setValue(value);setTone(severity);if(value)notify(value,severity);},[notify,defaultTone]);
 return [message,setMessage,tone] as const;
}
export function FeedbackBanner({message,tone='info',login=false}:{message:string;tone?:FeedbackTone;login?:boolean}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(login&&tone==='error'&&message){ref.current?.focus();ref.current?.scrollIntoView({block:'nearest'});}},[message,tone,login]);
 return message?<div ref={ref} tabIndex={login?-1:undefined} className={`notice notice-${tone}${login?' login-feedback':''}`} role={tone==='error'?'alert':'status'}>{login&&tone==='error'&&<strong>Sign-in failed</strong>}{message}</div>:null;
}
