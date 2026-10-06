import { useEffect, useRef, useState } from 'react';

export const BAR_HIDE_DELAY = 2500;

/** Mobile navigation stays reachable without occupying the screen during reading. */
export default function useAutoHideBar(enabled: boolean, menuOpen: boolean) {
  const [visible, setVisible] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    setVisible(true);
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let lastY = Math.max(0, window.scrollY);
    const focused = () => !!barRef.current?.querySelector(':focus-visible');
    const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const arm = () => {
      clear();
      if (menuOpen || focused() || window.scrollY <= 12) return;
      timer = setTimeout(() => {
        if (!menuOpen && !focused() && window.scrollY > 12) setVisible(false);
      }, BAR_HIDE_DELAY);
    };
    const reveal = () => { setVisible(true); arm(); };
    wake.current = reveal;
    const readScroll = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      if (y <= 12 || menuOpen || focused()) reveal();
      else if (Math.abs(y - lastY) >= 4) {
        if (y < lastY) reveal();
        else { clear(); setVisible(false); }
      }
      if (Math.abs(y - lastY) >= 4 || y <= 12) lastY = y;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(readScroll); };
    window.addEventListener('scroll', onScroll, { passive: true });
    arm();
    return () => {
      clear(); cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      wake.current = () => {};
    };
  }, [enabled, menuOpen]);
  return { visible, barRef, reveal: () => wake.current() };
}
