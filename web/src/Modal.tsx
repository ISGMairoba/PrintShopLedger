import Icon from './Icon';
import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
type Props = { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; className?: string; closeLabel?: string };
let openModals = 0;
let previousOverflow = '';
export default function Modal({ title, children, onClose, busy = false, wide = false, className = '', closeLabel = 'Close' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openModals++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    element.showModal();
    window.dispatchEvent(new Event('feedback:modal'));
    const input = element.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    input?.focus();
    return () => {
      element.close();
      window.dispatchEvent(new Event('feedback:modal'));
      if (--openModals === 0) document.body.style.overflow = previousOverflow;
      queueMicrotask(() => { if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus(); });
    };
  }, []);
  return createPortal(<dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} aria-labelledby={titleId} aria-modal="true" aria-busy={busy} tabIndex={-1}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const element = dialog.current!;
      const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'))
        .filter(control => control.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); element.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="secondary modal-close" aria-label={closeLabel} title={closeLabel} disabled={busy} onClick={onClose}><Icon name="close"/></button></div>
    <div className="modal-body">{children}</div>
  </dialog>, document.body);
}

