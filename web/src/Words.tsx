import { createContext, useContext, type ReactNode } from 'react';
import { pageName, renameTerms, stageName, termDefaults } from './terms.mjs';

type Terms = ReturnType<typeof termDefaults>;
/** The business's words (Business Settings → Jobs & payments → Words). */
export const TermsContext = createContext<Terms>(termDefaults());

// The words in use now, for text produced outside a component (messages, errors and toasts).
let active: Terms = termDefaults();
/** Rename an app-written message with the business's words. */
export const renameActive = (text: string) => renameTerms(text, active);
/** A job stage as the business names it. */
export const stageActive = (stage: string) => stageName(stage, active);

/** Provides the words to the app; also keeps them for messages shown outside components. */
export function TermsProvider({ value, children }: { value: Terms; children: ReactNode }) {
  active = value;
  return <TermsContext.Provider value={value}>{children}</TermsContext.Provider>;
}

/** w('Add job') → 'Add order'; stage('Added') → 'Order placed'; page('Jobs') → 'Orders'. */
export function useWords() {
  const terms = useContext(TermsContext);
  return {
    terms,
    w: (text: string) => renameTerms(text, terms),
    stage: (value: string) => stageName(value, terms),
    page: (value: string) => pageName(value, terms),
  };
}
