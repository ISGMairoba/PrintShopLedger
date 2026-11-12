import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
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
  'aria-label'?: string;
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
/** Lists adapt to their available width, including narrow desktop panels.
 * Declared details stay visible; other columns are available in a disclosure.
 * Audit columns remain visible when the user explicitly enables audit view.
 */
export default function ResponsiveTable({
  children,
  columns,
  labels = {},
  extraSortOptions = [],
  pageSort = false,
}: {
  children: ReactElement;
  columns: MobileColumn[];
  labels?: Record<number, string>;
  extraSortOptions?: { key: string; label: string }[];
  /** The page's own toolbar already has Sort by (shown on wider screens): no second one there. */
  pageSort?: boolean;
}) {
  const mobile = useMobileLayout();
  const container = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 840));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
  // Audit columns (who created or changed a record, and when) sit at the bottom right of a card,
  // beside the actions, so the name column stays short.
  const isAudit = (index: number) => {
    const header = headers[index];
    if (!header) return false;
    const column = header.props.column ?? '';
    return (
      ['createdAt', 'modifiedAt', 'createdBy', 'modifiedBy'].includes(column) ||
      /\baudit-heading\b/.test(header.props.className ?? '') ||
      /^(Created|Modified|Changed|Recorded)$/.test(String(header.props.label ?? ''))
    );
  };
  const auditing = headers.some((_, index) => isAudit(index));
  const shown = columns.slice(0, 3);
  const mainColumn = shown.find((column) => !column.actions);
  const mainDetails = (mainColumn?.details ?? []).map(resolve);
  const auditIndexes = [...mainDetails, ...extra].filter(isAudit);
  const plainDetails = mainDetails.filter((index) => !isAudit(index));
  const plainExtra = extra.filter((index) => !isAudit(index));
  const hasDetails = plainDetails.length > 0 || plainExtra.length > 0;
  const actionsColumn = shown.find((column) => column.actions);
  // Short details share a line in pairs; long ones (notes, references) take the full width.
  const textOf = (node: ReactNode): string =>
    node == null || typeof node === 'boolean'
      ? ''
      : typeof node === 'string' || typeof node === 'number'
        ? String(node)
        : Array.isArray(node)
          ? node.map(textOf).join('')
          : isValidElement(node)
            ? textOf((node as Element).props.children)
            : '';
  const metadata = (cells: Element[], detail: number) => {
    const value = cells[detail]?.props.children;
    const long = textOf(value).length + String(label(detail)).length > 26;
    return (
      <div className={long ? 'mobile-meta mobile-meta-long' : 'mobile-meta'} key={detail}>
        <span className="mobile-meta-label">{label(detail)}: </span>
        {value}
      </div>
    );
  };
  return (
    <div className="responsive-records" ref={container}>
      {!mobile && !narrow ? (
        children
      ) : (
        <>
          {sort && (mobile || !pageSort) && (
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
          <table className="mobile-list mobile-cards" aria-label={table.props['aria-label']}>
            <thead>
              <tr>
                {shown.map((column) => (
                  <th key={column.index} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cells = elements(row.props.children);
                const audit = auditIndexes.map((detail) => metadata(cells, detail));
                return (
                  <tr key={row.key}>
                    {shown
                      .filter((column) => !column.actions)
                      .flatMap((column, position) => {
                        const index = resolve(column.index);
                        const details = (column.details ?? []).map(resolve);
                        const cell = (
                          <td
                            key={column.index}
                            className={
                              position === 0
                                ? 'mobile-cell-main'
                                : position === 1
                                  ? 'mobile-cell-side'
                                  : 'mobile-cell-third'
                            }
                          >
                            <div className="mobile-main-value">{cells[index]?.props.children}</div>
                            {position > 0 && details.map((detail) => metadata(cells, detail))}
                          </td>
                        );
                        // The details follow the name in reading order; the amount is placed
                        // beside the name by the card's grid.
                        return position === 0 && hasDetails
                          ? [
                              cell,
                              <td className="mobile-cell-details" key="details">
                                <div className="mobile-details">
                                  {plainDetails.map((detail) => metadata(cells, detail))}
                                  {auditing && plainExtra.map((detail) => metadata(cells, detail))}
                                </div>
                                {!auditing && plainExtra.length > 0 && (
                                  <details className="record-details">
                                    <summary>More details</summary>
                                    <div className="mobile-details">
                                      {plainExtra.map((detail) => metadata(cells, detail))}
                                    </div>
                                  </details>
                                )}
                              </td>,
                            ]
                          : [cell];
                      })}
                    {(actionsColumn || audit.length > 0) && (
                      <td className="mobile-cell-actions">
                        {actionsColumn && (
                          <MobileActions>{cells[resolve(actionsColumn.index)]?.props.children}</MobileActions>
                        )}
                        {audit.length > 0 && <div className="mobile-audit">{audit}</div>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
