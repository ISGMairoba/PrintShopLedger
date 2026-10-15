import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Reload only when the app has no open form and no save in progress. */
export default function useAppUpdates(busy: boolean) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Look for a new version every 30 minutes, not only when the app is opened.
    onRegisteredSW: (_url: string, registration: ServiceWorkerRegistration | undefined) => {
      if (registration) setInterval(() => void registration.update(), 30 * 60 * 1000);
    },
  });
  // Apply an update by itself once nothing is in progress: no open window or form, nothing
  // saving. Saved and pending work stay on this device, so reloading loses nothing.
  useEffect(() => {
    if (!needRefresh) return;
    const tryUpdate = () => {
      if (!busy && !document.querySelector('dialog[open]')) void updateServiceWorker(true);
    };
    tryUpdate();
    const timer = setInterval(tryUpdate, 15000);
    return () => clearInterval(timer);
  }, [needRefresh, busy, updateServiceWorker]);
  return { needRefresh, updateServiceWorker };
}
