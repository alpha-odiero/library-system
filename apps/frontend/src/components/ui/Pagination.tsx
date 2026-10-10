import type { ReactNode } from 'react';
import type { PaginationMeta } from '@lms/shared';
import { formatCount } from '../../lib/format';
import { Button } from './Button';

/**
 * Page navigation.
 *
 * Two decisions worth stating:
 *
 *   1. **The range is derived from `meta`, not from the row count.** On the last
 *      page with 3 of 47 rows, "1–3" would be wrong; `limit * (page - 1) + 1`
 *      through `min(total, limit * page)` is right in every case.
 *   2. **`totalPages` can legitimately be 0** — an empty collection is not an
 *      error and must not render "Page 1 of 0" with two dead buttons.
 */

const WINDOW = 2;

function pageWindow(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 1) return [1];

  const pages = new Set<number>([1, totalPages]);
  for (let page = current - WINDOW; page <= current + WINDOW; page += 1) {
    if (page >= 1 && page <= totalPages) pages.add(page);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];

  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('gap');
    result.push(page);
    previous = page;
  }

  return result;
}

export function Pagination({
  meta,
  onPageChange,
  onLimitChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}): ReactNode {
  const { page, limit, total, totalPages } = meta;

  if (total === 0) {
    return <p className="pagination__summary">No records</p>;
  }

  const first = limit * (page - 1) + 1;
  const last = Math.min(total, limit * page);

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination__summary">
        Showing {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
      </p>

      <div className="pagination__controls">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>

        <ol className="pagination__pages">
          {pageWindow(page, totalPages).map((entry, index) =>
            entry === 'gap' ? (
              <li key={`gap-${index}`} className="pagination__gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={entry}>
                <Button
                  variant={entry === page ? 'primary' : 'ghost'}
                  size="sm"
                  // `aria-current` is what tells a screen reader which page is
                  // active; the highlight alone conveys nothing to one.
                  aria-current={entry === page ? 'page' : undefined}
                  aria-label={`Page ${entry}`}
                  onClick={() => onPageChange(entry)}
                >
                  {entry}
                </Button>
              </li>
            ),
          )}
        </ol>

        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>

        {onLimitChange && (
          <label className="pagination__limit">
            <span>Per page</span>
            <select
              className="input select select--compact"
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </nav>
  );
}
