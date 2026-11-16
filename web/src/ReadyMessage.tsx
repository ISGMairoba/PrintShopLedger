import { createContext, useContext } from 'react';
import Icon from './Icon';
import { shareText } from './share-text';
import type { Job } from './types';
import { useWords } from './Words';

/** Opens WhatsApp with the "ready for collection" message for a job (set by the app). */
export const ReadyMessageContext = createContext<
  ((job: Job) => { link: string; phone: string; text: string; mode: string }) | null
>(null);

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
        const { text, phone, mode } = message(job);
        void shareText(text, { title: 'Order ready', phone, mode: mode === 'share' ? 'share' : 'whatsapp' });
      }}
    >
      <Icon name="share" /> Tell customer
    </button>
  );
}
