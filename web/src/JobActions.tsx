import { jobWorkflow } from './business-options.mjs';
import Icon from './Icon';
import type { Job } from './types';
import { useWords } from './Words';
export type ProgressMode = 'next' | 'set' | 'complete';
export default function JobActions({
  job,
  busy,
  onAction,
}: {
  job: Job;
  busy: boolean;
  onAction: (job: Job, mode: ProgressMode) => void;
}) {
  const { stage } = useWords();
  const jobStatuses = jobWorkflow(job);
  const index = jobStatuses.indexOf(job.productionStatus ?? 'Added'),
    next = jobStatuses[index + 1];
  return (
    <div className="job-actions">
      <button
        className="text-button"
        disabled={busy || job.productionStatus === 'Cancelled' || !next}
        onClick={() => onAction(job, 'next')}
      >
        <Icon name="next" /> {next ? `Next: ${stage(next)}` : 'Next action'}
      </button>
      <button
        className="text-button"
        disabled={busy || job.productionStatus === 'Cancelled' || !next}
        onClick={() => onAction(job, 'set')}
      >
        <Icon name="quantity" /> Set Action
      </button>
      <button
        className="text-button"
        disabled={busy || job.productionStatus === 'Cancelled' || index >= jobStatuses.indexOf('Completed')}
        onClick={() => onAction(job, 'complete')}
      >
        <Icon name="complete" />{' '}
        {stage('Completed') === 'Completed' ? 'Mark as Complete' : `Mark as ${stage('Completed')}`}
      </button>
    </div>
  );
}
