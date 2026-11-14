/**
 * A part of the app loaded only when needed (PDFs, the developer console) can fail to load: a
 * dropped connection, or an update that replaced it while a screen was open. Browsers word that
 * failure differently; this spots it and says what to do.
 */
const STALE = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
  /Loading chunk \S+ failed/i,
];

export const STALE_APP_MESSAGE =
  'This part of the app could not load. Check the internet connection and try again; if it still fails, the app was updated while open: reload it (saved work stays on this device).';

/** @param {string} text */
export const isStaleAppError = (text) => STALE.some((pattern) => pattern.test(String(text ?? '')));

/** The message to show: the plain explanation for an outdated screen, otherwise the text itself. */
export const plainError = (/** @type {string} */ text) => (isStaleAppError(text) ? STALE_APP_MESSAGE : text);

/** Fired on window when a part of the app failed to load because the app was updated. */
export const STALE_EVENT = 'printshopledger:stale-app';
