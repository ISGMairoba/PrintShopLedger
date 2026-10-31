import { useSyncExternalStore } from 'react';
import { deadlineProgress } from './job-deadlines.mjs';
import type { Job } from './types';
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!timer) timer = setInterval(() => listeners.forEach((fn) => fn()), 60000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
};
const clock = () => Math.floor(Date.now() / 60000);
export default function DeadlineProgress({ job }: { job: Job }) {
  const minute = useSyncExternalStore(subscribe, clock, clock);
  const info = deadlineProgress(job, minute * 60000);
  return (
    <div className={`due-progress due-${info.state}`} aria-label="Deadline countdown">
      <small>
        {job.dueAt && info.state !== 'done'
          ? new Date(job.dueAt).toLocaleString('en-NG', {
              timeZone: 'Africa/Lagos',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : ''}
      </small>
      <strong>{info.label}</strong>
      {!['none', 'done'].includes(info.state) && (
        <progress max={100} value={Math.round(info.progress * 100)} aria-label={info.label} />
      )}
    </div>
  );
}
