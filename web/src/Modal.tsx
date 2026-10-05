import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
type Props = { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean };
let openModals = 0;
let previousOverflow = '';
export default function Modal({ title, children, onClose, busy = false, wide = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    if (openModals++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    element.showModal();
    const input = element.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    input?.focus();
    return () => {
      element.close();
      if (--openModals === 0) document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(<dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={titleId} aria-modal="true" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="secondary modal-close" disabled={busy} onClick={onClose}>Close</button></div>
    <div className="modal-body">{children}</div>
  </dialog>, document.body);
}
