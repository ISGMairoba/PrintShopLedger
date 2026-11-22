import { canTellCustomer } from './ready-message.mjs';
import { createContext, useContext } from 'react';
import Icon from './Icon';
import { shareText } from './share-text';
import type { ShareMode } from './share-choice';
import type { Job } from './types';
import { useWords } from './Words';

/** Opens WhatsApp with the "ready for collection" message for a job (set by the app). */
export const ReadyMessageContext = createContext<
  ((job: Job) => { link: string; phone: string; text: string; mode: string }) | null
>(null);

/** "Tell customer": shown once a job is Completed (Ready), or part of a part order is ready. */
export function TellCustomer({ job, busy }: { job: Job; busy?: boolean }) {
  const message = useContext(ReadyMessageContext);
  const { w } = useWords();
  if (!message || !canTellCustomer(job)) return null;
  return (
    <button
      type="button"
      className="text-button"
      disabled={busy}
      title={w(
        job.hold
          ? 'Send the customer a message that their job is on hold'
          : job.productionStatus === 'Collected'
            ? 'Send the customer a message that their job was collected'
            : 'Send the customer a message that their job is ready',
      )}
      onClick={() => {
        const { text, phone, mode } = message(job);
        void shareText(text, {
          title: job.hold
            ? 'Order on hold'
            : job.productionStatus === 'Collected'
              ? 'Order collected'
              : 'Order ready',
          phone,
          mode: mode as ShareMode,
        });
      }}
    >
      <Icon name="share" /> Tell customer
    </button>
  );
}
