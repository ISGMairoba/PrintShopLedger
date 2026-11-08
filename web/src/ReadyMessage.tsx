import { createContext, useContext } from 'react';
import Icon from './Icon';
import type { Job } from './types';
import { useWords } from './Words';

/** Opens WhatsApp with the "ready for collection" message for a job (set by the app). */
export const ReadyMessageContext = createContext<((job: Job) => { link: string; phone: string }) | null>(
  null,
);

/** "Tell customer": shown once a job is Completed (Ready). */
export function TellCustomer({ job, busy }: { job: Job; busy?: boolean }) {
  const message = useContext(ReadyMessageContext);
  const { w } = useWords();
  if (!message || job.productionStatus !== 'Completed') return null;
  return (
    <button
      type="button"
      className="text-button"
      disabled={busy}
      title={w('Send the customer a WhatsApp message that their job is ready')}
      onClick={() => {
        const { link } = message(job);
        window.open(link, '_blank', 'noopener');
      }}
    >
      <Icon name="share" /> Tell customer
    </button>
  );
}
