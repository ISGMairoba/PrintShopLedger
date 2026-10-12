import { createContext, useContext } from 'react';
import { pageName, renameTerms, stageName, termDefaults } from './terms.mjs';

/** The business's words (Business Settings → Words). */
export const TermsContext = createContext(termDefaults());

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
