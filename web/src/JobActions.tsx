import Icon from './Icon';
import { jobStatuses } from './checkout.mjs';
import type {Job} from './types';
export type ProgressMode='next'|'set'|'complete';
export default function JobActions({job,busy,onAction}:{job:Job;busy:boolean;onAction:(job:Job,mode:ProgressMode)=>void}) {
 const index=jobStatuses.indexOf(job.productionStatus??'Added'),next=jobStatuses[index+1];
 return <div className="job-actions"><button className="text-button" disabled={busy||!next} onClick={()=>onAction(job,'next')}><Icon name="next"/> {next?`Next: ${next}`:'Next action'}</button><button className="text-button" disabled={busy||!next} onClick={()=>onAction(job,'set')}><Icon name="quantity"/> Set Action</button><button className="text-button" disabled={busy||index>=jobStatuses.indexOf('Completed')} onClick={()=>onAction(job,'complete')}><Icon name="complete"/> Mark as Complete</button></div>;
}
