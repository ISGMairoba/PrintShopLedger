// The branch this device works in. It is remembered per business sign-in, and every request to
// the server says it (header x-psl-branch), so the server tags new records with the branch.
import { MAIN, setLocalBranch } from './branches.mjs';

const key = (scope: string) => `printshopledger:branch:v1:${scope}`;
let current = MAIN;

/** The branch requests are sent for now. */
export const requestBranch = () => current;
export function setRequestBranch(id: string | null | undefined) {
  current = id || MAIN;
  setLocalBranch(current);
}
export function storedBranch(scope: string): string | null {
  try {
    return localStorage.getItem(key(scope));
  } catch {
    return null;
  }
}
export function storeBranch(scope: string, id: string) {
  try {
    localStorage.setItem(key(scope), id);
  } catch {}
}
/** fetch for the app's server client: adds the branch header when it is not the main branch. */
export const branchFetch: typeof fetch = (input, init) => {
  if (current === MAIN) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-psl-branch', current);
  return fetch(input, { ...init, headers });
};
