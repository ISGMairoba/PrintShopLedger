import { jobStatuses } from './checkout.mjs';
/** @returns {import('./types').JobStatusEvent[]} */
export function progressEvents(job,target,actor,now=new Date().toISOString()) {
 const from=jobStatuses.indexOf(job.productionStatus??'Added'),to=jobStatuses.indexOf(target);
 if(from<0||to<=from||!actor?.id||!actor.label)throw Error('Choose a stage after the current job stage.');
 return jobStatuses.slice(from+1,to+1).map((status,index)=>({id:crypto.randomUUID(),kind:'job.status_changed',data:{id:job.id,baseVersion:(job.version??1)+index,status,modifiedBy:actor.id,modifiedByLabel:actor.label,modifiedAt:now}}));
}
export function lastJobPayment(ledger,job) {
 return ledger.payments.filter(p=>p.allocations.some(a=>a.jobId===job.id&&a.amount>0)).sort((a,b)=>b.paidOn.localeCompare(a.paidOn)||Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]?.paidOn??null;
}
