import { useEffect, useRef } from 'react';
import { ACTIVITY_KEY, latestActivity, shouldLock } from '../auto-lock.mjs';

const read = () => {
  try {
    return localStorage.getItem(ACTIVITY_KEY);
  } catch {
    return null;
  }
};
const write = (time: number) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(time));
  } catch {
    /* Private mode or a full device: this tab still keeps its own time. */
  }
};

/**
 * Calls onLock after `minutes` without a tap, click, key press or scroll (0 = off).
 * Activity in any tab of the app counts. Checks every 10 seconds and when the screen wakes.
 */
export function useAutoLock({
  minutes,
  active,
  online,
  busy,
  onLock,
}: {
  minutes: number;
  active: boolean;
  online: boolean;
  busy: boolean;
  onLock: () => void;
}) {
  const last = useRef(Date.now());
  const state = useRef({ minutes, online, busy, onLock });
  state.current = { minutes, online, busy, onLock };
  useEffect(() => {
    if (!active || !(minutes > 0)) return;
    // A fresh sign-in (or turning the lock on) starts the clock now.
    last.current = Date.now();
    write(last.current);
    let wrote = 0;
    const touch = () => {
      last.current = Date.now();
      // Moving the mouse fires often: share it with other tabs at most every 5 seconds.
      if (last.current - wrote > 5000) {
        wrote = last.current;
        write(last.current);
      }
    };
    const check = () => {
      const s = state.current;
      if (
        shouldLock({
          now: Date.now(),
          lastActivity: latestActivity(last.current, read()),
          minutes: s.minutes,
          online: s.online,
          busy: s.busy,
        })
      )
        s.onLock();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true, capture: true });
    const wake = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', wake);
    const timer = setInterval(check, 10_000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch, { capture: true });
      document.removeEventListener('visibilitychange', wake);
      clearInterval(timer);
    };
  }, [active, minutes]);
}
