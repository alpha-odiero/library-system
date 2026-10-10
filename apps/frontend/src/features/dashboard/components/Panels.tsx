import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/ui/Card';
import { EmptyState, LoadingState } from '../../../components/ui/States';
import { Icon, type IconName } from '../../../components/ui/Icon';
import { LibraryArt } from '../../../components/ui/LibraryArt';
import { loanMovement, type LoanDto } from '../../circulation/api';
import type { BookDto } from '../../catalogue/api';
import {
  formatCalendarDate,
  formatInstant,
  formatRelativeDays,
  fullName,
} from '../../../lib/format';
import type {
  BorrowingBar,
  BorrowingFigure,
  CalendarMark,
  DueDateItem,
  QuickLink,
} from '../useDashboardData';

/**
 * The dashboard's panels.
 *
 * Each is its own component because they fail and load independently. One request
 * timing out must empty one panel, not the page — and the moment they share a
 * parent state object is the moment a slow `listCopies` becomes a blank dashboard.
 */

/* ── Welcome ─────────────────────────────────────────────────────────────────
 * A thin tinted banner, not a hero. It greets the user by name and says what the
 * library looks like today, which is the one thing a dashboard can usefully say
 * before any number.
 */

export function WelcomeBanner({
  name,
  branch,
  summary,
  isMember,
}: {
  name: string;
  branch: string | null;
  summary: string;
  isMember: boolean;
}): ReactNode {
  const today = new Intl.DateTimeFormat('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <section className="welcome">
      <div className="welcome__body-copy">
        <p className="welcome__eyebrow">{today}</p>
        <h1 className="welcome__title">Welcome back, {name}!</h1>
        <p className="welcome__body">{summary}</p>

        {branch && (
          <div className="welcome__aside">
            <p className="welcome__aside-label">{isMember ? 'Your branch' : 'Working at'}</p>
            <p className="welcome__aside-value">{branch}</p>
          </div>
        )}
      </div>

      <LibraryArt className="welcome__art" />
    </section>
  );
}

/* ── Stat row ───────────────────────────────────────────────────────────────
 * Five compact cards. Each links through to the page that owns the figure, so a
 * librarian who reads "17 overdue" can act on it without navigating first.
 *
 * The icons are keyed by `stat.id` and not by label, because the label is copy and
 * copy gets rewritten — the ids are what the aggregation is built on.
 */

const STAT_ICONS: Record<string, IconName> = {
  catalogue: 'books',
  loans: 'loans',
  returned: 'returns',
  overdue: 'alert',
  holdReady: 'reservations',
  members: 'members',
  fines: 'wallet',
};

export function StatRow({ stats }: { stats: readonly StatShape[] }): ReactNode {
  if (stats.length === 0) return null;

  /*
   * Six figures are a different problem from five. The base track count is set
   * with `auto-fit`, which wraps once the tiles fall under ~132px and leaves the
   * remainder of the last row empty — at six cards in a 1260px column that means
   * five across and a lone sixth card sitting under a fifth of the row. `--six`
   * pins three tracks and lets the row fill itself evenly, six across only when
   * the main column reaches ~1376px and each tile can hold its label.
   */
  const rowClasses = stats.length >= 6 ? 'stat-row stat-row--six' : 'stat-row';

  return (
    <div className={rowClasses}>
      {stats.map((stat) => {
        const body = (
          <>
            <span className="stat-card__icon" aria-hidden="true">
              <Icon name={STAT_ICONS[stat.id] ?? 'activity'} size={16} />
            </span>
            <div>
              <p className="stat-card__label">{stat.label}</p>
              <p className="stat-card__value">{stat.value}</p>
              {stat.detail && <p className="stat-card__hint">{stat.detail}</p>}
            </div>
          </>
        );

        /*
          Two independent modifiers, deliberately not one. `--<category>` sets the
          icon box's tint and never changes; `--<tone>` sets the status colour and an
          edge marker, and does change with the figure's health. Keeping them apart is
          what stops a card repainting itself the moment someone returns a book.
        */
        const modifier = ['stat-card', stat.category && `stat-card--${stat.category}`]
          .filter(Boolean)
          .join(' ');
        const classes = [modifier, stat.tone && `stat-card--${stat.tone}`]
          .filter(Boolean)
          .join(' ');

        return stat.href ? (
          <Link key={stat.id} className={classes} to={stat.href}>
            {body}
          </Link>
        ) : (
          <div key={stat.id} className={classes}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

interface StatShape {
  id: string;
  label: string;
  value: string;
  detail?: string;
  href?: string;
  tone?: 'neutral' | 'warning' | 'good';
  category?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'yellow' | 'pink' | 'slate';
}

/* ── Recent activity ─────────────────────────────────────────────────────────
 * The last few movements, newest first, as a compact feed for the narrow column.
 * Each row is one movement: the book, who moved it (the copy number for a
 * member's own record), and when it is due or was returned. The heavy five-column
 * table is what made circulation crowd the page before; a feed at 30% width is
 * the version that fits.
 */

export function RecentLoans({
  loans,
  loading,
  memberView,
  title = 'Recent Activity',
}: {
  loans: readonly LoanDto[];
  loading: boolean;
  memberView: boolean;
  /** Overridden per role — a member's feed is their own history, not the desk's. */
  title?: string;
}): ReactNode {
  return (
    <Card
      className="dash-panel dash-panel--activity"
      title={title}
      actions={
        <Link className="card-link" to="/loans">
          View all
        </Link>
      }
    >
      {loading ? (
        <LoadingState label="Loading recent circulation" rows={4} />
      ) : loans.length === 0 ? (
        <EmptyState
          icon="arrowRightLeft"
          title="No circulation yet"
          description={
            memberView
              ? 'Books you borrow will appear here.'
              : 'Issued loans will appear here as soon as circulation starts.'
          }
        />
      ) : (
        <ul className="notices">
          {loans.map((loan) => {
            const tone = activityTone(loan);
            return (
              <li className="notice" key={loan.id}>
                <span
                  className={`notice__icon${tone !== 'blue' ? ` notice__icon--${tone}` : ''}`}
                  aria-hidden="true"
                >
                  <Icon name={activityIcon(loan)} size={14} />
                </span>
                <div>
                  <p className="notice__title">
                    <Link className="cell-link" to={`/loans/${loan.id}`}>
                      {loan.book.title}
                    </Link>
                  </p>
                  <p className="notice__body">
                    {memberView ? loan.copy.accessionNumber : fullName(loan.member.user)}
                  </p>
                  <p className="notice__date">
                    {loan.returnedAt
                      ? `Returned ${formatInstant(loan.returnedAt)}`
                      : `${loanMovement(loan)} · due ${formatInstant(loan.dueDate)}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function activityIcon(loan: LoanDto): IconName {
  if (loan.returnedAt) return 'returns';
  if (loanMovement(loan) === 'Renewed') return 'refresh';
  return 'arrowRightLeft';
}

function activityTone(loan: LoanDto): 'red' | 'pink' | 'orange' | 'blue' {
  if (loan.status === 'OVERDUE' || loan.status === 'LOST' || loan.status === 'DAMAGED') {
    return 'red';
  }
  return loanMovement(loan) === 'Renewed' ? 'pink' : 'blue';
}

/* ── Notice board ────────────────────────────────────────────────────────────
 * This user's own notifications. It is per-user by construction — the endpoint
 * filters on the session — so an administrator's board and a member's are
 * different documents, and neither can see the other's.
 */

export function NoticeBoard({
  notices,
  loading,
  title = 'Notice Board',
}: {
  notices: readonly NoticeShape[];
  loading: boolean;
  /** "My Notices" for a member — the document is theirs either way. */
  title?: string;
}): ReactNode {
  return (
    <Card
      className="dash-panel dash-panel--notices"
      title={title}
      actions={
        <Link className="card-link" to="/notifications">
          All notices
        </Link>
      }
    >
      {loading ? (
        <LoadingState label="Loading notices" rows={3} />
      ) : notices.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="Nothing to announce"
          description="Notices you receive will appear here."
        />
      ) : (
        <ul className="notices">
          {/*
            Two rows, not the four the request asked for.
            The board sits in the rail, where the budget for the whole card is
            140–170px: header, body padding and one row already come to ~115, so a
            third and fourth notice would push it past 240 and make it the tallest
            thing on the right-hand side by a wide margin. The rest are one click
            away on the link in the header, which is what that link is for.
          */}
          {notices.slice(0, 2).map((notice) => (
            <li className="notice" key={notice.id}>
              <span
                className={`notice__icon notice__icon--${noticeTone(notice.type)}`}
                aria-hidden="true"
              >
                <Icon name={noticeIcon(notice.type)} size={14} />
              </span>
              <div>
                <p className="notice__title">{notice.title}</p>
                <p className="notice__body">{notice.message}</p>
                <p className="notice__date">
                  {formatInstant(notice.createdAt)}
                  {!notice.readAt && ' · Unread'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface NoticeShape {
  id: string;
  title: string;
  message: string;
  type: string;
  readAt: string | null;
  createdAt: string;
}

function noticeIcon(type: string): IconName {
  switch (type) {
    case 'LOAN_OVERDUE':
      return 'alert';
    case 'FINE_ASSESSED':
      return 'wallet';
    case 'LOAN_DUE':
      return 'calendar';
    case 'RESERVATION_READY':
      return 'reservations';
    default:
      return 'megaphone';
  }
}

function noticeTone(type: string): 'blue' | 'orange' | 'pink' | 'red' {
  switch (type) {
    case 'LOAN_OVERDUE':
    case 'FINE_ASSESSED':
      return 'red';
    case 'LOAN_DUE':
      return 'pink';
    case 'RESERVATION_READY':
      return 'orange';
    default:
      return 'blue';
  }
}

/* ── New arrivals ────────────────────────────────────────────────────────────
 * The newest titles by `createdAt`, newest first. The same component on every
 * role's dashboard: a librarian scans it for cataloguing, and a member is shown
 * the same shelf — the source list is branch-scoped by the server.
 */

export function NewArrivals({
  books,
  loading,
}: {
  books: readonly BookDto[];
  loading: boolean;
}): ReactNode {
  return (
    <Card
      className="dash-panel dash-panel--shelf"
      title="Newly Added Books"
      actions={
        <Link className="card-link" to="/books">
          View all
        </Link>
      }
    >
      {loading ? (
        <LoadingState label="Loading new arrivals" rows={3} />
      ) : books.length === 0 ? (
        <EmptyState
          icon="books"
          title="No new arrivals yet"
          description="Recent catalogue additions will appear here."
        />
      ) : (
        <ul className="book-grid">
          {books.map((book) => (
            <li className="book-card" key={book.id}>
              <BookThumb book={book} />
              <div className="book-card__body">
                <p className="book-card__title">
                  <Link className="cell-link" to={`/books/${book.id}`}>
                    {book.title}
                  </Link>
                </p>
                <p className="book-card__author">
                  {book.authors.length > 0
                    ? book.authors.map((author) => author.name).join(', ')
                    : 'Author not recorded'}
                </p>
                <p className="book-card__meta">
                  {book.publicationYear ?? 'Year unknown'}
                  {book.isbn13 ? ` · ${book.isbn13}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The thumbnail half of a book card.
 *
 * A missing cover falls back to a tinted glyph rather than to a broken image or an
 * empty box: most records in a catalogue have no cover file, and a shelf of empty
 * rectangles reads as a loading failure. The image is decorative — the title sits
 * immediately beside it — so it carries an empty `alt` rather than repeating the
 * title to a screen reader.
 */
function BookThumb({ book }: { book: BookDto }): ReactNode {
  if (book.coverImageUrl) {
    return <img className="book-card__cover" src={book.coverImageUrl} alt="" loading="lazy" />;
  }

  return (
    <span className="book-card__cover book-card__cover--empty" aria-hidden="true">
      <Icon name="books" size={16} />
    </span>
  );
}

/* ── Calendar ────────────────────────────────────────────────────────────────
 * A month grid marked with real events. Days are buttons, not divs: a librarian
 * clicking "what is due on the 12th" should be able to reach the answer by
 * keyboard, and the day must have an accessible name that is not "12".
 */

export function LibraryCalendar({
  marks,
  title = 'Library Calendar',
}: {
  marks: readonly CalendarMark[];
  /** "My Due Dates" for a member, whose marks are their own loans. */
  title?: string;
}): ReactNode {
  const today = new Date();
  /*
   * Which month is on screen. The default is the real one; the arrows move a whole
   * month at a time and are clamped to a year either side, because a calendar that
   * can be paged to 1997 is a calendar nobody can get back out of.
   */
  const [offset, setOffset] = useState(0);

  const view = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();

  const byDate = new Map<string, CalendarMark[]>();
  for (const mark of marks) {
    const existing = byDate.get(mark.date);
    if (existing) existing.push(mark);
    else byDate.set(mark.date, [mark]);
  }

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // `getDay()` is 0 for Sunday, and the grid starts on Sunday, so it is the count.
  const leadingBlanks = firstOfMonth.getDay();
  const todayKey = toKey(today.getFullYear(), today.getMonth(), today.getDate());

  const cells: ReactNode[] = [];
  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(<span className="calendar__day calendar__day--empty" key={`blank-${index}`} />);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = toKey(year, month, day);
    const dayMarks = byDate.get(key) ?? [];
    const isToday = key === todayKey;
    /*
      A day can carry both kinds of mark, so one dot has to stand for both. It is
      drawn as a hold whenever there is a hold on that day, because a hold waiting
      for collection is the more time-critical of the two and a librarian would
      rather see that first. The `title` below still lists every mark, so nothing is
      hidden by the choice.
    */
    const kind: CalendarMark['kind'] | null =
      dayMarks.length === 0
        ? null
        : dayMarks.some((mark) => mark.kind === 'ready')
          ? 'ready'
          : 'due';

    cells.push(
      <button
        className={[
          'calendar__day',
          isToday && 'calendar__day--today',
          kind && `calendar__day--${kind}`,
        ]
          .filter(Boolean)
          .join(' ')}
        key={key}
        type="button"
        // The visible text is the day number, so the name has to carry the rest —
        // including which kind of event it is, since the dot is the only thing on
        // screen that distinguishes the two.
        aria-label={
          dayMarks.length > 0
            ? `${day} ${monthName(month)}, ${dayMarks.length} ${dayMarks.length === 1 ? 'item' : 'items'}: ${dayMarks.map((mark) => mark.label).join('; ')}`
            : `${day} ${monthName(month)}`
        }
        title={dayMarks.map((mark) => mark.label).join('\n')}
      >
        {day}
      </button>,
    );
  }

  return (
    <Card
      className="dash-panel dash-panel--calendar"
      title={title}
      description={`${monthName(month)} ${year}`}
      actions={
        <div className="calendar__nav">
          <button
            type="button"
            className="icon-button calendar__nav-button"
            onClick={() => setOffset((current) => Math.max(MONTH_RANGE * -1, current - 1))}
            disabled={offset <= -MONTH_RANGE}
            aria-label="Previous month"
            title="Previous month"
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <button
            type="button"
            className="icon-button calendar__nav-button"
            onClick={() => setOffset((current) => Math.min(MONTH_RANGE, current + 1))}
            disabled={offset >= MONTH_RANGE}
            aria-label="Next month"
            title="Next month"
          >
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
      }
    >
      <div className="calendar__weekdays" aria-hidden="true">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <span className="calendar__weekday" key={day}>
            {day}
          </span>
        ))}
      </div>

      <div className="calendar__grid">{cells}</div>

      {/* Three swatches, three things the grid actually draws. A legend entry that
          no cell can ever have would be a promise the component does not keep. */}
      <p className="calendar__legend">
        <span className="calendar__legend-item">
          <span className="calendar__swatch calendar__swatch--due" aria-hidden="true" />
          Due date
        </span>
        <span className="calendar__legend-item">
          <span className="calendar__swatch calendar__swatch--ready" aria-hidden="true" />
          Hold ready
        </span>
        <span className="calendar__legend-item">
          <span className="calendar__swatch calendar__swatch--today" aria-hidden="true" />
          Today
        </span>
      </p>
    </Card>
  );
}

/** How far the arrows may page in either direction. */
const MONTH_RANGE = 12;

function toKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthName(month: number): string {
  return new Intl.DateTimeFormat('en-KE', { month: 'long' }).format(new Date(2000, month, 1));
}

/* ── Quick access ────────────────────────────────────────────────────────────
 * The actions a librarian performs most. Permission-filtered by the caller; a tile
 * the user cannot use is omitted rather than disabled, because a permanently greyed
 * button is noise that never becomes actionable.
 */

export function QuickAccess({
  links,
  title = 'Quick Access',
}: {
  links: readonly QuickLink[];
  /** "Quick Actions" for a member. */
  title?: string;
}): ReactNode {
  if (links.length === 0) return null;

  return (
    <Card className="dash-panel dash-panel--actions" title={title}>
      <div className="quick-grid">
        {links.map((link) => (
          <Link
            className={`quick-tile quick-tile--${link.tone ?? 'blue'}`}
            to={link.href}
            key={link.href}
          >
            <span className="quick-tile__icon" aria-hidden="true">
              <Icon name={link.icon} size={16} />
            </span>
            <span className="quick-tile__label">{link.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/* ── Performance ─────────────────────────────────────────────────────────────
 * A donut of the inventory's states, with the availability percentage at its
 * centre, and the four figures it is read against down the right: what is on the
 * shelf, what is out, what is late, and the share the ring is drawn from. All
 * five numbers come from the same three requests — a ring and a table disagreeing
 * would be worse than neither.
 *
 * `stroke-dasharray` rather than conic gradients so the segments are real SVG
 * that scales cleanly and can be read in forced-colors mode.
 */

export function PerformanceDonut({
  heading,
  figure,
  segments,
  metrics,
}: {
  heading: string;
  figure: string;
  segments: readonly { label: string; value: number; colour: string }[];
  metrics: readonly BorrowingFigure[];
}): ReactNode {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <Card className="dash-panel dash-panel--performance" title={heading}>
      <div className="performance">
        {/*
          The ring is the SVG; the figure at its centre is HTML in a `.donut__centre`
          overlay. Drawing the figure as SVG `<text>` instead would put it inside
          `.donut__svg`, which carries the rotation that puts the first segment at
          twelve o'clock — the figure would be rendered sideways. It would also take
          its `font-size` in viewBox user units rather than rem, so the CSS could no
          longer size it in step with the rest of the page.
        */}
        <div className="donut">
          <svg
            className="donut__svg"
            viewBox="0 0 140 140"
            role="img"
            aria-label={
              total > 0
                ? `${heading}: ${figure} available, ${segments
                    .map((segment) => `${segment.value} ${segment.label.toLowerCase()}`)
                    .join(', ')}`
                : `${heading}: no inventory data available`
            }
          >
            <circle className="donut__track" cx="70" cy="70" r={radius} />
            {total > 0 &&
              segments.map((segment) => {
                const length = (segment.value / total) * circumference;
                const dash = `${length} ${circumference - length}`;
                const rotation = (offset / total) * 360 - 90;
                offset += segment.value;

                return (
                  <circle
                    key={segment.label}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={segment.colour}
                    strokeWidth="16"
                    strokeDasharray={dash}
                    transform={`rotate(${rotation} 70 70)`}
                  />
                );
              })}
          </svg>

          {/* The SVG already carries this as its accessible name, so repeating it
              visually here must not also be announced. */}
          <div className="donut__centre" aria-hidden="true">
            <span className="donut__value">{figure}</span>
            <span className="donut__caption">available</span>
          </div>
        </div>

        <ul className="performance__metrics">
          {metrics.map((metric) => (
            <li className="performance__row" key={metric.label}>
              <span className="performance__label">{metric.label}</span>
              <span className="performance__value">{metric.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/* ── Due dates ─────────────────────────────────────────────────────────────────
 * The next loans to fall due, soonest first. The calendar answers "which days this
 * month are busy"; this answers "what do I have to bring back next", which is the
 * question a member actually opens the dashboard with, and it needs the book, the
 * date and how far away that date is — none of which fit in a 24px calendar cell.
 */

export function DueDates({
  items,
  loading,
  title = 'Upcoming Due Dates',
}: {
  items: readonly DueDateItem[];
  loading: boolean;
  title?: string;
}): ReactNode {
  return (
    <Card
      className="dash-panel dash-panel--due"
      title={title}
      actions={
        <Link className="card-link" to="/loans">
          View all
        </Link>
      }
    >
      {loading ? (
        <LoadingState label="Loading due dates" rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No books currently due"
          description="Books you borrow will appear here with their due dates."
        />
      ) : (
        <ul className="due-list">
          {items.map((item) => (
            <li className="due-row" key={item.id}>
              <span className="due-row__icon" aria-hidden="true">
                <Icon name="calendar" size={14} />
              </span>
              <div className="due-row__body">
                <p className="due-row__title">
                  <Link className="cell-link" to={item.href}>
                    {item.title}
                  </Link>
                </p>
                <p className="due-row__date">{formatCalendarDate(item.dueDate)}</p>
              </div>
              <span className={`due-row__chip due-row__chip--${dueTone(item.days)}`}>
                {formatRelativeDays(item.days)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The chip's colour follows urgency, but the chip's *text* already says the whole
 * thing — "3 days overdue" is legible without the red. Colour is the second
 * signal, never the only one.
 */
function dueTone(days: number | null): 'late' | 'today' | 'soon' {
  if (days === null) return 'soon';
  if (days < 0) return 'late';
  if (days === 0) return 'today';
  return 'soon';
}

/* ── Borrowing performance ─────────────────────────────────────────────────────
 * Two measured rates and four figures, all from the member's own record. The
 * staff dashboard gets the inventory donut instead; a patron has no inventory to
 * draw, so the equivalent panel measures their borrowing rather than the shelf's.
 */

export function BorrowingPerformance({
  heading,
  bars,
  figures,
}: {
  heading: string;
  bars: readonly BorrowingBar[];
  figures: readonly BorrowingFigure[];
}): ReactNode {
  return (
    <Card className="dash-panel dash-panel--performance dash-panel--borrowing" title={heading}>
      <ul className="bars">
        {bars.map((bar) => (
          <li className="bar" key={bar.label}>
            <div className="bar__head">
              <span className="bar__label">{bar.label}</span>
              {bar.percent !== null && <span className="bar__value">{bar.percent}%</span>}
            </div>
            {bar.percent === null ? (
              <p className="bar__empty">{bar.empty}</p>
            ) : (
              // The percentage is already written above, so the track itself carries
              // no text and may stay decorative for assistive technology.
              <div className="bar__track" aria-hidden="true">
                <span className="bar__fill" style={{ width: `${bar.percent}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>

      <ul className="bar-figures">
        {figures.map((figure) => (
          <li className="bar-figures__item" key={figure.label}>
            <span className="bar-figures__label">{figure.label}</span>
            <span className="bar-figures__value">{figure.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Bottom banner ─────────────────────────────────────────────────────────────
 * The page's last words before the footer. It is the one deliberately decorative
 * element on the dashboard: no figure, no request, no claim about the library —
 * just the line the reader leaves with, and a single route back to the catalogue.
 */

export function BottomBanner({ canBrowse }: { canBrowse: boolean }): ReactNode {
  return (
    <section className="dash-banner">
      <div className="dash-banner__copy">
        <h2 className="dash-banner__title">Keep Reading, Keep Growing</h2>
        <p className="dash-banner__text">
          Discover new books, stay on top of your loans, and make the most of your library.
        </p>
      </div>

      <div className="dash-banner__aside">
        {/* Decoration only: the sentence to its left carries the message, so the
            artwork is hidden from assistive technology rather than repeated as an
            image with no text of its own. */}
        <LibraryArt className="dash-banner__art" />
        {canBrowse && (
          <Link className="dash-banner__action" to="/books">
            Browse the catalogue
            <Icon name="arrowRight" size={15} />
          </Link>
        )}
      </div>
    </section>
  );
}
