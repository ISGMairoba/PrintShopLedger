import type { ShareMode } from './share-choice';
import { createContext, useContext } from 'react';
import { customerNames, messageMode, messagesDefaults, messageText } from './messages.mjs';

type Settings = ReturnType<typeof messagesDefaults>;
/** The business's message wording and sending (Business Settings → Messages), set by the app. */
export const MessagesContext = createContext<{
  settings: Settings;
  business: string;
  legacyReady: string;
  customers?: { id: string; name: string; calledAs?: string }[];
}>({
  settings: messagesDefaults(),
  business: '',
  legacyReady: '',
});

/** Build a message in the business's wording, and how it should go out. */
export function useMessages() {
  const { settings, business, legacyReady, customers } = useContext(MessagesContext);
  // The customer's names: by id when the record is known ("Called as" lives there), else the name given.
  const names = (who: { id?: string | null; name?: string | null }) => {
    const saved = who.id ? customers?.find((c) => c.id === who.id) : undefined;
    return customerNames(saved?.name ?? who.name ?? '', saved?.calledAs ?? '');
  };
  return {
    /** The text, with the business name and the customer's names filled in. */
    text: (
      key: string,
      values: Record<string, string | number>,
      who?: { id?: string | null; name?: string | null },
    ) =>
      messageText(
        settings,
        key,
        { business: business || 'our shop', ...(who ? names(who) : {}), ...values },
        legacyReady,
      ),
    mode: (key: string) => messageMode(settings, key) as ShareMode,
  };
}
