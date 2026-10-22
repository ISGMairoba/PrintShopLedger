import { useEffect, useRef, useState } from 'react';
import { createAutoSync } from './auto-sync.mjs';
type Status = 'waiting' | 'syncing' | 'saved' | 'retrying' | 'attention';
type Options = {
  scope: string;
  enabled: boolean;
  online: boolean;
  paused: boolean;
  pendingKey: string;
  /** How often to check for changes made on other devices. */
  pollMs: number;
  run: () => Promise<void>;
  onError: (error: unknown) => 'pause' | void;
};
export default function useAutoSync(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const scheduler = useRef<ReturnType<typeof createAutoSync> | null>(null);
  const [status, setStatus] = useState<Status>('waiting');
  useEffect(() => {
    setStatus('waiting');
    if (!options.enabled || !options.scope) return;
    const controller = createAutoSync({
      // A hidden tab only syncs to send its own changes; it catches up when shown again.
      canRun: () =>
        latest.current.enabled &&
        latest.current.online &&
        !latest.current.paused &&
        (document.visibilityState === 'visible' || latest.current.pendingKey !== ''),
      // Changes made here are sent at once; other devices' changes are fetched on the business's
      // schedule (Settings → Security), and straight away when the app is opened, focused or
      // reconnects.
      pollMs: options.pollMs,
      run: () => latest.current.run(),
      onError: (error: unknown) => latest.current.onError(error),
      onStatus: (value: Status) => setStatus(value),
    });
    scheduler.current = controller;
    const wake = () => {
      if (document.visibilityState === 'visible') controller.wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    controller.wake();
    return () => {
      controller.dispose();
      scheduler.current = null;
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [options.scope, options.enabled, options.pollMs]);
  useEffect(() => {
    scheduler.current?.request();
  }, [options.pendingKey]);
  useEffect(() => {
    if (options.online && !options.paused) scheduler.current?.wake();
  }, [options.online, options.paused]);
  /** Sync straight away (used by Sync all once it has asked for a full download). */
  const syncNow = () => scheduler.current?.wake();
  return [status, syncNow] as const;
}
