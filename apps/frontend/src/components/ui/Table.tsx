import type { ReactNode } from 'react';
import { EmptyState, LoadingState } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /**
   * Hidden on a narrow viewport, where the table becomes a card list and only the
   * primary fields survive. Applied through a class, not `display: none` in CSS
   * on a `<td>` that still occupies layout space.
   */
  secondary?: boolean;
}

/**
 * A real `<table>`, because a grid of divs is not one.
 *
 * The semantics are the whole reason: a screen reader announces row and column
 * headers as the user arrows through cells, which is how a table is actually
 * navigated. `role="table"` on a div grid announces nothing, and no amount of
 * ARIA on the cells fixes it.
 *
 * Below the layout breakpoint each row becomes a card and every cell carries its
 * column name as a `data-label` prefix. The markup is unchanged — a phone user
 * still gets a real table, just re-flowed — so there is nothing to keep in sync
 * between a desktop and a mobile render.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
}: {
  /** Required: a table without a caption is not self-describing to a screen reader. */
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
}): ReactNode {
  if (loading) return <LoadingState label={`Loading ${caption.toLowerCase()}`} rows={5} />;

  if (rows.length === 0) {
    return (
      empty ?? <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  return (
    <div className="table-wrapper" tabIndex={0} role="group" aria-label={caption}>
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={[
                  column.secondary && 'table__cell--secondary',
                  column.align === 'right' && 'table__cell--right',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={typeof column.header === 'string' ? column.header : column.key}
                  className={[
                    column.secondary && 'table__cell--secondary',
                    column.align === 'right' && 'table__cell--right',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A label/value pair for a detail page.
 *
 * Uses `<dl>` because that is what it is: a description of terms. A screen reader
 * lets the user jump between term and definition; a grid of divs does not.
 */
export function DescriptionList({ children }: { children: ReactNode }): ReactNode {
  return <dl className="details">{children}</dl>;
}

export function DescriptionItem({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="details__item">
      <dt className="details__term">{term}</dt>
      <dd className="details__value">{children ?? '—'}</dd>
    </div>
  );
}
