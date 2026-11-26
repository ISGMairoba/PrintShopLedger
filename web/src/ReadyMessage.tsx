import { canTellCustomer, messageFor } from './ready-message.mjs';
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

const TITLES: Record<string, { title: string; hint: string }> = {
  held: { title: 'Order on hold', hint: 'Send the customer a message that their job is on hold' },
  collected: { title: 'Order collected', hint: 'Send the customer a message that their job was collected' },
  ready: { title: 'Order ready', hint: 'Send the customer a message that their job is ready' },
  part_ready: {
    title: 'Part of order ready',
    hint: 'Send the customer a message that part of their job is ready',
  },
  resumed: {
    title: 'Work continues',
    hint: 'Send the customer a message that work on their job has continued',
  },
  update: {
    title: 'Order update',
    hint: 'Send the customer where their job is: its stage, progress and when it should be ready',
  },
};

/** "Tell customer": the right message for where the job is (ready-message.mjs messageFor). */
export function TellCustomer({ job, busy }: { job: Job; busy?: boolean }) {
  const message = useContext(ReadyMessageContext);
  const { w } = useWords();
  if (!message || !canTellCustomer(job)) return null;
  return (
    <button
      type="button"
      className="text-button"
      disabled={busy}
      title={w(TITLES[messageFor(job)].hint)}
      onClick={() => {
        const { text, phone, mode } = message(job);
        void shareText(text, {
          title: TITLES[messageFor(job)].title,
          phone,
          mode: mode as ShareMode,
        });
      }}
    >
      <Icon name="share" /> Tell customer
    </button>
  );
}
