import { createContext, useContext } from 'react';
import { customerNames, messageMode, messagesDefaults, messageText } from './messages.mjs';

type Settings = ReturnType<typeof messagesDefaults>;
/** The business's message wording and sending (Business Settings → Messages), set by the app. */
export const MessagesContext = createContext<{ settings: Settings; business: string; legacyReady: string }>({
  settings: messagesDefaults(),
  business: '',
  legacyReady: '',
});

/** Build a message in the business's wording, and how it should go out. */
export function useMessages() {
  const { settings, business, legacyReady } = useContext(MessagesContext);
  return {
    /** The text, with the business name and the customer's names filled in. */
    text: (key: string, values: Record<string, string | number>, customerName?: string) =>
      messageText(
        settings,
        key,
        {
          business: business || 'our shop',
          ...(customerName !== undefined ? customerNames(customerName) : {}),
          ...values,
        },
        legacyReady,
      ),
    mode: (key: string) => messageMode(settings, key) as 'whatsapp' | 'share',
  };
}
