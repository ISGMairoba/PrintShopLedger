import {
  Children,
  Fragment,
  isValidElement,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import Modal from './Modal';
import { SortHeader } from './TableSort';

type Element = ReactElement<{
  children?: ReactNode;
  label?: string;
  column?: string;
  sort?: { key: string; direction: 'asc' | 'desc'; toggle: (key: string) => void };
  className?: string;
}>;
type MobileColumn = { index: number; label: string; details?: number[]; actions?: boolean };
// Flatten fragments, but retain cells and their original event handlers.
function elements(children: ReactNode): Element[] {
  return Children.toArray(children).flatMap((child) =>
    !isValidElement(child)
      ? []
      : child.type === Fragment
        ? elements((child as Element).props.children)
        : [child as Element],
  );
}
const mobileQuery = '(max-width: 740px), (max-width: 1024px) and (pointer: coarse)';
const subscribe = (callback: () => void) => {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
}
function MobileActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const container = elements(children);
  const buttons =
    container.length === 1 && container[0].type === 'div' ? elements(container[0].props.children) : container;
  if (buttons.length <= 1) return <div className="mobile-actions">{children}</div>;
  return (
    <div className="mobile-actions">
      {buttons[0]}
      <button className="text-button" onClick={() => setOpen(true)}>
        More
      </button>
      {open && (
        <Modal title="More actions" onClose={() => setOpen(false)}>
          <div
            className="mobile-action-menu"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('button:not(:disabled)'))
                setOpen(false);
            }}
          >
            {buttons.slice(1)}
          </div>
        </Modal>
      )}
    </div>
  );
}
/** All new list pages should use this wrapper and declare at most three mobile columns.
 * Unassigned columns (including audit fields) become labelled details in the first column.
 * The original table is retained on desktop; mobile uses the same content and handlers.
 */
export default function ResponsiveTable({
  children,
  columns,
  labels = {},
  extraSortOptions = [],
}: {
  children: ReactElement;
  columns: MobileColumn[];
  labels?: Record<number, string>;
  extraSortOptions?: { key: string; label: string }[];
}) {
  const mobile = useMobileLayout();
  if (!mobile) return children;
  const table = children as Element;
  const sections = elements(table.props.children);
  const head = sections.find((section) => section.type === 'thead');
  const body = sections.find((section) => section.type === 'tbody');
  const headers = elements(elements(head?.props.children)[0]?.props.children);
  const rows = elements(body?.props.children);
  const resolve = (index: number) => (index < 0 ? headers.length + index : index);
  const used = new Set(
    columns.flatMap((column) => [resolve(column.index), ...(column.details ?? []).map(resolve)]),
  );
  const extra = headers.map((_, index) => index).filter((index) => !used.has(index));
  const sortHeaders = headers.filter((header) => header.type === SortHeader && header.props.sort);
  const sort = sortHeaders[0]?.props.sort;
  const label = (index: number) =>
    labels[index] ?? headers[index]?.props.label ?? headers[index]?.props.children ?? 'Details';
  return (
    <>
      {sort && (
        <div className="mobile-sort">
          <label>
            Sort by
            <select
              aria-label="Sort list by"
              value={sort.key}
              onChange={(event) => sort.toggle(event.target.value)}
            >
              {extraSortOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
              {sortHeaders.map((header) => (
                <option key={header.props.column} value={header.props.column}>
                  {header.props.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            aria-label="Reverse sort direction"
            onClick={() => sort.toggle(sort.key)}
          >
            {sort.direction === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
          </button>
        </div>
      )}
      <table className="mobile-list mobile-cards">
        <thead>
          <tr>
            {columns.slice(0, 3).map((column) => (
              <th key={column.index} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = elements(row.props.children);
            return (
              <tr key={row.key}>
                {columns.slice(0, 3).map((column, position) => {
                  const index = resolve(column.index);
                  const details = [...(column.details ?? []).map(resolve), ...(position === 0 ? extra : [])];
                  return (
                    <td
                      key={column.index}
                      className={
                        column.actions
                          ? 'mobile-cell-actions'
                          : position === 0
                            ? 'mobile-cell-main'
                            : 'mobile-cell-side'
                      }
                    >
                      {column.actions ? (
                        <MobileActions>{cells[index]?.props.children}</MobileActions>
                      ) : (
                        <>
                          <div className="mobile-main-value">{cells[index]?.props.children}</div>
                          {details.map((detail) => (
                            <div className="mobile-meta" key={detail}>
                              <span className="mobile-meta-label">{label(detail)}: </span>
                              {cells[detail]?.props.children}
                            </div>
                          ))}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
