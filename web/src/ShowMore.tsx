import { useState } from 'react';

/** How many rows a long list draws at first; Show more adds the same again. */
export const LIST_PAGE = 100;

/**
 * Long lists draw their first rows and a "Show more" button: drawing every row at once froze slow
 * computers. Totals, search and sorting still cover the whole list; only the drawing is limited.
 */
export function useShowMore<T>(items: T[], page = LIST_PAGE) {
  const [limit, setLimit] = useState(page);
  const shown = items.length > limit ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  const more =
    hidden > 0 ? (
      <div className="show-more">
        <button type="button" className="secondary" onClick={() => setLimit((n) => n + page)}>
          Show {Math.min(page, hidden)} more
        </button>{' '}
        <button type="button" className="text-button" onClick={() => setLimit(items.length)}>
          Show all {items.length}
        </button>
        <small className="muted">
          {' '}
          Showing {shown.length} of {items.length}.
        </small>
      </div>
    ) : null;
  return { shown, more, limited: hidden > 0 };
}
