import { useEffect, useRef, useState, type ReactNode } from 'react';
import Modal from './Modal';
import { useMobileLayout } from './ResponsiveTable';
import useAutoHideBar from './useAutoHideBar';
export default function Sidebar({ title, header, children, footer }: { title: string; header: ReactNode; children: ReactNode; footer: ReactNode }) {
  const mobile = useMobileLayout();
  const [open, setOpen] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);
  const showScrollbar = () => {
    setScrolling(true);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setScrolling(false), 1200);
  };
  const { visible, barRef, reveal } = useAutoHideBar(mobile, open);
  useEffect(() => { if (!mobile) setOpen(false); }, [mobile]);
  const content = <><div className="sidebar-header">{header}</div><div className={`sidebar-menu${scrolling ? ' is-scrolling' : ''}`} onScroll={showScrollbar}>{children}</div><div className="sidebar-bottom">{footer}</div></>;
  if (!mobile) return <aside className="app-sidebar" aria-label="Workspace navigation">{content}</aside>;
  return <>
    <div className="mobile-app-bar-space" aria-hidden="true" />
    <div ref={barRef} className={`mobile-app-bar${visible ? '' : ' mobile-app-bar-hidden'}`} inert={!visible} aria-hidden={open || !visible || undefined} onFocusCapture={reveal} onBlurCapture={reveal}><button className="secondary" aria-label="Menu" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}><span aria-hidden="true">☰</span> Menu</button><strong>{title}</strong></div>
    {open && <Modal title="Navigation" closeLabel="Menu" className="sidebar-drawer" onClose={() => setOpen(false)}>
      <aside className="app-sidebar" aria-label="Workspace navigation" id="mobile-navigation" onClick={event => {
        if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) setOpen(false);
      }}>{content}</aside>
    </Modal>}
  </>;
}

