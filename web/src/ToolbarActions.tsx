import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Icon from './Icon';

/**
 * Less-used actions behind one "More" button. The items are ordinary buttons (toggles keep
 * aria-pressed); choosing one closes the menu. Escape or a click outside also closes it.
 */
export function MoreMenu({ children, label = 'More' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!Children.toArray(children).length) return null;
  return (
    <div className="more-menu" ref={box}>
      <button
        ref={toggle}
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label} options`}
        onClick={() => setOpen((value) => !value)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={id}
          className="more-menu-panel"
          role="group"
          aria-label={`${label} actions`}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('button:not(:disabled)'))
              setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The right-hand side of a list page's toolbar: More menu, then secondary actions, then the one
 * main (filled) action last. Search and filters stay on the left as the toolbar's other children.
 */
export default function ToolbarActions({ more, children }: { more?: ReactNode; children?: ReactNode }) {
  // A menu with a single item is just an extra click: show that item as a button instead.
  const items = flatten(more);
  const views = items.filter((item) => isValidElement(item) && item.type === MenuToggle);
  const other = items.filter((item) => !views.includes(item));
  return (
    <div className="toolbar-actions">
      {views.length > 0 && (
        <div className="toolbar-view-controls" role="group" aria-label="List view">
          {views}
        </div>
      )}
      {other.length > 1 ? <MoreMenu>{other}</MoreMenu> : other}
      {children}
    </div>
  );
}

/** Menu items, with fragments and arrays opened up so each button counts once. */
function flatten(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? flatten((child.props as { children?: ReactNode }).children)
      : [child],
  );
}

/** A menu item that switches a view on and off. */
export function MenuToggle({
  pressed,
  icon,
  children,
  onClick,
}: {
  pressed: boolean;
  icon?: Parameters<typeof Icon>[0]['name'];
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`secondary${icon ? ' view-toggle' : ''}`}
      aria-label={typeof children === 'string' ? children : undefined}
      title={typeof children === 'string' ? children : undefined}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />} <span className="view-toggle-label">{children}</span>
      {pressed && (
        <span className="menu-check" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  );
}
