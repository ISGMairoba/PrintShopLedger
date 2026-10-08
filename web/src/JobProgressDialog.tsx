import {jobWorkflow} from './business-options.mjs';
import {useState} from 'react';
import Modal from './Modal';
import type {Job} from './types';
import type {ProgressMode} from './JobActions';
export default function JobProgressDialog({job,mode,busy,onClose,onSave}:{job:Job;mode:ProgressMode;busy:boolean;onClose:()=>void;onSave:(target:string)=>Promise<void>}) {
 const jobStatuses=jobWorkflow(job);
 const index=jobStatuses.indexOf(job.productionStatus??'Added');
 const [target,setTarget]=useState(mode==='complete'?'Completed':jobStatuses[index+1]),[error,setError]=useState('');
 const path=jobStatuses.slice(index+1,jobStatuses.indexOf(target)+1);
 return <Modal title={mode==='set'?'Set job stage':`Move job to ${target}?`} busy={busy} onClose={onClose}><strong>{job.service}</strong><p>{job.description}</p><p>Current stage: {job.productionStatus??'Added'}</p>{error&&<p role="alert" className="notice">{error}</p>}<form onSubmit={async e=>{e.preventDefault();if(busy)return;setError('');try{await onSave(target);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}}>{mode==='set'&&<label>Desired stage<select value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}>{jobStatuses.slice(index+1).map(stage=><option key={stage}>{stage}</option>)}</select></label>}<p>Proceed in order: {path.join(' → ')}</p><p className="muted">Each stage is recorded separately. {target==='Collected'?'This action also records collection.':'Completion does not mark the job as collected.'}</p><button disabled={busy||!path.length}>{mode==='next'?'Confirm next action':mode==='complete'?'Mark as Complete':'Set action'}</button></form></Modal>;
}
