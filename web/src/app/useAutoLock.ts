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
  onLock: () => void | Promise<unknown>;
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
    /** Locks when the time is up; returns the lock's promise then (false: not due). */
    const check = (): false | Promise<unknown> => {
      const s = state.current;
      if (
        !shouldLock({
          now: Date.now(),
          lastActivity: latestActivity(last.current, read()),
          minutes: s.minutes,
          online: s.online,
          busy: s.busy,
        })
      )
        return false;
      return Promise.resolve(s.onLock());
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true, capture: true });
    // While the app is in the background its screen is hidden (privacy-cover in branding.css), and on
    // the way back it stays hidden until the lock time has been checked. So the phone's app switcher
    // and a lock that is due never show the screen behind it.
    const cover = (on: boolean) => document.documentElement.classList.toggle('privacy-cover', on);
    const wake = () => {
      if (document.visibilityState !== 'visible') {
        cover(true);
        return;
      }
      const due = check();
      if (due) void Promise.resolve(due).finally(() => cover(false));
      else cover(false);
    };
    const hide = () => cover(true);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', wake);
    document.addEventListener('visibilitychange', wake);
    const timer = setInterval(check, 10_000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch, { capture: true });
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', wake);
      cover(false);
      clearInterval(timer);
    };
  }, [active, minutes]);
}
