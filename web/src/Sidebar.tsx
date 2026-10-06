import { useEffect, useState, type ReactNode } from 'react';
import Modal from './Modal';
import { useMobileLayout } from './ResponsiveTable';
import useAutoHideBar from './useAutoHideBar';
export default function Sidebar({ header, children, footer }: { header: ReactNode; children: ReactNode; footer: ReactNode }) {
  const mobile = useMobileLayout();
  const [open, setOpen] = useState(false);
  const { visible, barRef, reveal } = useAutoHideBar(mobile, open);
  useEffect(() => { if (!mobile) setOpen(false); }, [mobile]);
  const content = <><div className="sidebar-header">{header}</div><div className="sidebar-menu">{children}</div><div className="sidebar-bottom">{footer}</div></>;
  if (!mobile) return <aside className="app-sidebar" aria-label="Workspace navigation">{content}</aside>;
  return <>
    <div className="mobile-app-bar-space" aria-hidden="true" />
    <div ref={barRef} className={`mobile-app-bar${visible ? '' : ' mobile-app-bar-hidden'}`} inert={!visible} aria-hidden={open || !visible || undefined} onFocusCapture={reveal} onBlurCapture={reveal}><button className="secondary" aria-label="Menu" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}><span aria-hidden="true">☰</span> Menu</button><strong>PrintShopLedger</strong></div>
    {open && <Modal title="Navigation" closeLabel="Menu" className="sidebar-drawer" onClose={() => setOpen(false)}>
      <aside className="app-sidebar" aria-label="Workspace navigation" id="mobile-navigation" onClick={event => {
        if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) setOpen(false);
      }}>{content}</aside>
    </Modal>}
  </>;
}

