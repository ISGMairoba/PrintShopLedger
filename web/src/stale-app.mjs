/**
 * After an update, a screen still open from the older version may ask for a part of the app that
 * the new version replaced. Browsers word that failure differently; this spots it and says what to do.
 */
const STALE = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
  /Loading chunk \S+ failed/i,
];

export const STALE_APP_MESSAGE =
  'The app was updated while this screen was open, so this part could not load. Reload the app (saved work stays on this device), then try again.';

/** @param {string} text */
export const isStaleAppError = (text) => STALE.some((pattern) => pattern.test(String(text ?? '')));

/** The message to show: the plain explanation for an outdated screen, otherwise the text itself. */
export const plainError = (/** @type {string} */ text) => (isStaleAppError(text) ? STALE_APP_MESSAGE : text);

/** Fired on window when a part of the app failed to load because the app was updated. */
export const STALE_EVENT = 'printshopledger:stale-app';
