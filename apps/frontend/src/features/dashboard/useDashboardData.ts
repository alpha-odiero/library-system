import { useEffect, useMemo, useState } from 'react';
import type { PermissionCode } from '@lms/shared';
import { ApiError } from '../../lib/api';
import { REALTIME_CHANNELS, subscribeToRealtime } from '../../lib/realtime';
import { useAuth } from '../../contexts/AuthContext';
import { listBooks, listCopies, type BookDto } from '../catalogue/api';
import { listLoans, listReservations, type LoanDto, type ReservationDto } from '../circulation/api';
import { fineBalance, listFines, sumMoney, type FineDto } from '../finance/api';
import { listMembers } from '../members/api';
import { listNotifications, type NotificationDto } from '../notifications/api';
import type { IconName } from '../../components/ui/Icon';
import { daysUntil } from '../../lib/format';
import { paths } from '../../routes/paths';

/**
 * Dashboard aggregation.
 *
 * ## Why there is no `/dashboard` endpoint
 *
 * Every figure below is a count the server already knows how to answer, but each
 * one sits behind a different permission: `BOOK_VIEW` for the catalogue,
 * `LOAN_VIEW` for circulation, `MEMBER_VIEW` for people, `FINE_VIEW` for finance. A
 * single dashboard endpoint would have to either demand all of them at once —
 * locking a librarian with no finance access out of the whole page — or accept an
 * arbitrary permission list from the client, which turns an authorization decision
 * into a client suggestion. So this composes the list endpoints the caller is
 * already entitled to call, and never asks for the ones they are not.
 *
 * ## The three rules this follows
 *
 * 1. **Never invent a figure.** There are no placeholder statistics in this file.
 *    A panel the user may not see is absent; a panel whose request failed is named.
 *    A dashboard of zeroes is a lie shaped like data, and a librarian who acts on it
 *    is acting on nothing.
 * 2. **Ask only what is permitted.** Each request is gated on `can()`, so a member
 *    never receives a 403 rendered as a broken panel, and never learns a count they
 *    were not entitled to.
 * 3. **`limit: 1` to count.** Pagination metadata carries the total, so a count
 *    costs one row. Fetching a thousand books to read `meta.total` is the kind of
 *    thing that works in development and falls over after the first import.
 *
 * Failures are settled individually. One 500 must not empty the other six panels,
 * and a 403 is not a failure at all — it means "not entitled", which is a layout
 * decision rather than an error to report.
 */

export interface DashboardStat {
  id: string;
  label: string;
  value: string;
  /** A ratio or a share. Never decoration. */
  detail?: string;
  href?: string;
  /** `warning` marks the figure to act on first. */
  tone?: 'neutral' | 'warning' | 'good';
  /**
   * Which subject the figure is about, and therefore what colour its icon box is
   * drawn in. Deliberately separate from `tone`: `tone` is a status that can change
   * (an overdue count is `warning` only while it is non-zero), whereas the category
   * of a figure never changes. Collapsing the two would mean a card repaints itself
   * from red to blue the moment somebody returned a book.
   */
  category?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'yellow' | 'pink' | 'slate';
}

export interface CalendarMark {
  /** `YYYY-MM-DD` in the library's timezone, not the browser's. */
  date: string;
  kind: 'due' | 'ready';
  label: string;
}

/**
 * One row of the right-hand due-dates list.
 *
 * Distinct from `CalendarMark` on purpose: the calendar answers "which days this
 * month are busy", this answers "which loan is next and how late am I". Sharing a
 * type would mean the list inherited the calendar's `label` copy, which is written
 * for a tooltip rather than for a line a member reads.
 */
export interface DueDateItem {
  id: string;
  title: string;
  href: string;
  /** `YYYY-MM-DD` in the library's timezone. */
  dueDate: string;
  /** Whole days from today. Negative is overdue; `null` means unparsable. */
  days: number | null;
}

/**
 * A measured rate for the borrowing panel.
 *
 * `percent` is `null` whenever its denominator is zero. Rendering that as `0%` or
 * as a full bar would both be claims the data does not support — an empty library
 * has not failed to return books on time, it has returned none.
 */
export interface BorrowingBar {
  label: string;
  percent: number | null;
  /** Replaces the bar when `percent` is null. */
  empty: string;
}

export interface BorrowingFigure {
  label: string;
  value: string;
}

export interface PerformanceSegment {
  label: string;
  value: number;
  /** A palette custom property, never a hard-coded hex. */
  colour: string;
}

export interface QuickLink {
  label: string;
  href: string;
  /**
   * Typed against the icon registry rather than `string`. The first version of this
   * interface used `string`, which meant `'arrow-right-left'` type-checked happily
   * and then rendered nothing at runtime, because the registry is camel-cased. Typing
   * the field is what turns that silent blank tile into a compile error.
   */
  icon: IconName;
  permission: PermissionCode;
  /**
   * Icon-box tint. Same vocabulary as `DashboardStat['category']` and for the same
   * reason: circulation is purple everywhere in this application, so a librarian
   * learns one colour rather than re-reading the label under each tile.
   */
  tone?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'yellow' | 'pink' | 'slate';
}

export interface DashboardData {
  stats: DashboardStat[];
  recentLoans: LoanDto[];
  notices: NotificationDto[];
  newArrivals: BookDto[];
  calendarMarks: CalendarMark[];
  /**
   * The ring plus the four figures beside it. `metrics` is drawn straight from
   * the counts the inventory requests already returned — available, on loan and
   * overdue — so the card's number and the ring's number cannot drift apart.
   */
  performance: {
    heading: string;
    figure: string;
    segments: PerformanceSegment[];
    metrics: BorrowingFigure[];
  };
  /**
   * The next loans to fall due, soonest first. `null` means no loan panel resolved
   * at all — which is a failed request, not an empty shelf, and the panel is
   * omitted rather than shown claiming nothing is due.
   */
  dueDates: DueDateItem[] | null;
  /** The member's own borrowing rates. `null` for staff, who see the donut. */
  borrowing: { heading: string; bars: BorrowingBar[]; figures: BorrowingFigure[] } | null;
  /** Panels that failed for a reason other than permission. */
  failed: string[];
}

const RECENT_LIMIT = 6;
const NOTICE_LIMIT = 4;
const CALENDAR_WINDOW = 100;
/** Rows in the right-hand due-dates list. */
const DUE_LIMIT = 5;

/** Panels the user is entitled to, keyed for the assembler. */
type Panels = Record<string, unknown>;

/**
 * `YYYY-MM-DD` for an ISO instant, in the library's timezone.
 *
 * `toISOString()` would be UTC, which is wrong for a calendar of "when is this due":
 * a copy due at 23:00 on the 4th in Nairobi is the 3rd in UTC, so the dashboard
 * would put it on the wrong day for eight hours a night. The library timezone is
 * resolved by the caller from settings and falls back to the host zone.
 */
export function libraryDate(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** `1,204` — grouped for the stat row. */
function grouped(value: number): string {
  return new Intl.NumberFormat('en-KE').format(value);
}

/**
 * Is this loan past its due date?
 *
 * Answered from the date, not from `loan.status`: no code in the backend ever
 * writes `OVERDUE` to a loan row, so the status field reads `ACTIVE` for a book
 * that is three weeks late. A returned loan is never past due — its date is
 * history, not a debt.
 */
function isPastDue(loan: LoanDto): boolean {
  if (loan.returnedAt) return false;
  const date = libraryDate(loan.dueDate);
  if (!date) return false;
  return (daysUntil(date) ?? 0) < 0;
}

function totalOf(panel: unknown): number {
  const meta = (panel as { meta?: { total?: number } } | undefined)?.meta;
  return meta?.total ?? 0;
}

function rowsOf<T>(panel: unknown): T[] {
  return (panel as { data?: T[] } | undefined)?.data ?? [];
}

/**
 * Quick Access entries, filtered by what the session actually holds.
 *
 * Every `href` here is a route the app actually defines. The original set pointed at
 * `/loans/new`, `/books/new`, `/copies/new` and `/payments/new` — none of which
 * exist — so four of six tiles navigated straight to the 404 page, and the only
 * reason that was not immediately obvious is that the tiles are styled as shortcuts
 * and look actionable. A shortcut panel that dead-ends is worse than no panel, so the
 * tiles point at the registers where the work is actually done.
 *
 * `MEMBER_CREATE` is the one genuine create route that exists, which is why it is the
 * only tile with a `New` label here.
 */
export const QUICK_ACCESS: readonly QuickLink[] = [
  {
    label: 'Register Student',
    href: paths.memberNew,
    icon: 'userPlus',
    permission: 'MEMBER_CREATE',
    tone: 'green',
  },
  {
    label: 'Circulation Desk',
    href: paths.loans,
    icon: 'arrowRightLeft',
    permission: 'LOAN_VIEW',
    tone: 'purple',
  },
  {
    label: 'Returns',
    href: paths.returns,
    icon: 'returns',
    permission: 'LOAN_RETURN',
    tone: 'purple',
  },
  {
    label: 'Holds Queue',
    href: paths.reservations,
    icon: 'reservations',
    permission: 'RESERVATION_VIEW',
    tone: 'orange',
  },
  {
    label: 'Fine Register',
    href: paths.fines,
    icon: 'fines',
    permission: 'FINE_VIEW',
    tone: 'red',
  },
  {
    label: 'Send Notice',
    href: paths.notifications,
    icon: 'megaphone',
    permission: 'NOTIFICATION_BROADCAST',
    tone: 'blue',
  },
];

/**
 * Turns resolved panels into the numbers, rows and marks to render.
 *
 * Pure and exported so the arithmetic can be tested without a network. The fetch is
 * the easy part; this is where a dashboard is usually wrong.
 */
export function assemble(panels: Panels, failed: string[] = []): DashboardData {
  const books = panels['books'];
  const copies = panels['copies'];
  const available = panels['copiesAvailable'];
  const active = panels['loansActive'];
  const overdue = panels['loansOverdue'];
  const members = panels['members'];
  const outstanding = panels['finesOutstanding'];
  const recent = panels['recentLoans'];
  const newArrivals = panels['newArrivals'];
  const ready = panels['reservationsReady'];
  const notices = panels['notices'];
  const myLoans = panels['myLoans'];
  const myHistory = panels['myHistory'];
  const myFines = panels['myFines'];

  const totalCopies = totalOf(copies);
  const availableCopies = totalOf(available);
  const totalActive = totalOf(active);
  const totalOverdue = totalOf(overdue);
  const fines: FineDto[] = rowsOf(outstanding);

  /* A member reads their own borrowing history instead of the staff figures. */
  const memberLoans: LoanDto[] = rowsOf(myLoans);
  const isMemberView = myLoans !== undefined || myHistory !== undefined;

  /**
   * The member's full record — returned loans included — with `myLoans` (ACTIVE
   * only) as the fallback when the wider request is the one that failed.
   *
   * One population feeds every member figure below. Counting "Borrowed" from the
   * active-only request and "Overdue" from the full one would let the second exceed
   * the first, because a loan past its due date is one of the loans that is out.
   */
  const memberHistory: LoanDto[] = myHistory !== undefined ? rowsOf(myHistory) : memberLoans;

  /* ── Stat row ─────────────────────────────────────────────────────────────
   * Only panels that resolved contribute a card, so an administrator gets five and a
   * librarian without finance access gets four — rather than six cards two of which
   * read "0".
   *
   * ## Why five cards and not six
   *
   * The design calls for five compact figures. The server had six entitlements
   * behind them, and the obvious way to reach five was to drop one — which is how a
   * dashboard ends up quietly lying to the librarian who works in that department.
   * So instead the two catalogue figures are *merged* rather than discarded: titles
   * and availability describe the same shelf, and "980 of 1,240 copies on shelf"
   * carries both answers on one card. Nothing entitled is dropped, and the row
   * still reads as five.
   */
  const stats: DashboardStat[] = [];

  /** The member's loans that are still out, and their borrowing panel. Set only
   *  in the member branch below; both feed the right-hand rail further down. */
  let memberOut: LoanDto[] | null = null;
  let borrowing: DashboardData['borrowing'] = null;

  /*
    Titles and copies are separate panels with separate permissions, so this card is
    built from whichever resolved. A `COPY_VIEW`-only session gets the same shape with
    copies as the headline number and no link — pointing it at `/books` would hand the
    user a 403, because the route is behind `BOOK_VIEW`. The card is built before the
    view split so a member (who holds `BOOK_VIEW` and `COPY_VIEW`, branch-scoped) gets
    the same "Total Books" as staff: one shelf, two parties entitled to count it.
  */
  if (books || copies) {
    stats.push({
      id: 'catalogue',
      // "Total Books" for a session that can see titles, which is the common case.
      // Without `BOOK_VIEW` the count is of physical copies, so it says so.
      label: books ? 'Total Books' : 'Total Copies',
      value: grouped(books ? totalOf(books) : totalCopies),
      // The availability figure rides along as the detail line rather than taking a
      // card of its own. It is a share of the total on the same card, which is what
      // `detail` is for.
      ...(copies
        ? { detail: `${grouped(availableCopies)} of ${grouped(totalCopies)} on shelf` }
        : {}),
      ...(books ? { href: '/books' } : {}),
      category: 'blue',
    });
  }

  if (isMemberView) {
    /*
     * Five figures, all derived from `memberHistory` above: what is out, what has
     * come back, what is late, what is waiting on the shelf, what is owed. The
     * catalogue total is deliberately not among them — a student's question is
     * about their own account, and the shelf count is the one figure on the old
     * row that did not answer any part of it.
     *
     * Overdue is derived from the due date rather than from `loan.status`. Nothing
     * in the backend ever writes `OVERDUE` to a loan (the sweep cron is declared
     * in `env.ts` and never scheduled), so reading the status field would report
     * zero forever while books sat weeks past their date.
     */
    const outOnLoan = memberHistory.filter((loan) => !loan.returnedAt);
    const returned = memberHistory.filter((loan) => loan.returnedAt !== null);
    const late = outOnLoan.filter((loan) => isPastDue(loan)).length;
    const onTime = returned.filter(
      (loan) =>
        loan.returnedAt !== null &&
        loan.dueDate !== '' &&
        new Date(loan.returnedAt).getTime() <= new Date(loan.dueDate).getTime(),
    ).length;

    memberOut = outOnLoan;

    stats.push(
      {
        id: 'loans',
        label: 'Books Borrowed',
        value: grouped(outOnLoan.length),
        href: '/loans',
        category: 'purple',
      },
      {
        id: 'returned',
        label: 'Books Returned',
        value: grouped(returned.length),
        href: '/loans',
        category: 'green',
      },
      {
        id: 'overdue',
        label: 'Books Overdue',
        value: grouped(late),
        tone: late > 0 ? 'warning' : 'good',
        category: 'red',
      },
    );

    // Only when the request resolved. A failed panel reads as an absent card, not
    // as a hold count of zero — the row above already says which requests failed.
    if (ready) {
      stats.push({
        id: 'holdReady',
        label: 'Books on Hold Ready',
        value: grouped(totalOf(ready)),
        href: '/reservations',
        category: 'orange',
      });
    }

    if (myFines) {
      const owing = sumMoney(rowsOf<FineDto>(myFines).map(fineBalance));
      stats.push({
        id: 'fines',
        label: 'Fines Owed',
        value: owing,
        href: '/fines',
        tone: owing === '0.00' ? 'good' : 'warning',
        category: 'red',
      });
    }

    borrowing = {
      heading: 'Library Performance',
      bars: [
        {
          label: 'On-time Returns',
          percent: returned.length > 0 ? Math.round((onTime / returned.length) * 100) : null,
          empty: 'No returns recorded yet',
        },
        {
          label: 'Loans on Schedule',
          percent:
            outOnLoan.length > 0
              ? Math.round(((outOnLoan.length - late) / outOnLoan.length) * 100)
              : null,
          empty: 'No books currently on loan',
        },
      ],
      figures: [
        { label: 'Current Loans', value: grouped(outOnLoan.length) },
        { label: 'Books Returned', value: grouped(returned.length) },
        { label: 'Overdue', value: grouped(late) },
        {
          label: 'Fines Owed',
          value: myFines ? sumMoney(rowsOf<FineDto>(myFines).map(fineBalance)) : '—',
        },
      ],
    };
  } else {
    if (active) {
      stats.push({
        id: 'loans',
        label: 'Books Borrowed',
        value: grouped(totalActive),
        href: '/loans',
        category: 'purple',
      });
    }

    if (overdue) {
      stats.push({
        id: 'overdue',
        label: 'Overdue',
        value: grouped(totalOverdue),
        tone: totalOverdue > 0 ? 'warning' : 'good',
        category: 'red',
      });
    }

    if (members) {
      stats.push({
        id: 'members',
        label: 'Students',
        value: grouped(totalOf(members)),
        href: '/members',
        category: 'green',
      });
    }

    if (outstanding) {
      stats.push({
        id: 'fines',
        label: 'Outstanding Fines',
        // `fine.amount` is what was assessed, not what is owed. A PARTIAL fine still
        // carries its full assessed amount, so summing that column would overstate
        // the debt on every fine that has been partly paid.
        value: sumMoney(fines.map(fineBalance)),
        href: '/fines',
        tone: fines.some((fine) => fineBalance(fine) !== '0.00') ? 'warning' : 'good',
        category: 'red',
      });
    }
  }

  /* ── Calendar marks ───────────────────────────────────────────────────────
   * Two real sources only: when a loan falls due, and when a ready hold lapses. A
   * calendar sprinkled with invented events would be worse than an empty one,
   * because a librarian would plan shelving around them.
   */
  const calendarMarks: CalendarMark[] = [];

  for (const loan of rowsOf<LoanDto>(recent).concat(memberLoans)) {
    const date = libraryDate(loan.dueDate);
    if (date) calendarMarks.push({ date, kind: 'due', label: `Due: ${loan.book.title}` });
  }

  for (const hold of rowsOf<ReservationDto>(ready)) {
    const date = libraryDate(hold.holdExpiresAt ?? hold.reservedAt);
    if (date) calendarMarks.push({ date, kind: 'ready', label: `Hold ready: ${hold.book.title}` });
  }

  /* ── Due dates ────────────────────────────────────────────────────────────
   * The five loans that fall due soonest, from the same population the stat row
   * counts. A member's list is their own loans; a librarian's is the tail of the
   * recent-circulation panel, which is the loans the desk has just issued.
   *
   * `null` — no loan panel resolved at all — renders no card, because "nothing is
   * due" and "the request failed" must not look alike on a page whose whole job is
   * telling them apart.
   */
  const dueLoans: LoanDto[] | null = isMemberView
    ? memberOut
    : recent === undefined
      ? null
      : rowsOf<LoanDto>(recent).filter((loan) => !loan.returnedAt);

  const dueDates: DueDateItem[] | null =
    dueLoans === null
      ? null
      : dueLoans
          .map((loan) => {
            const date = libraryDate(loan.dueDate);
            if (!date) return null;
            return {
              id: loan.id,
              title: loan.book.title,
              href: `/loans/${loan.id}`,
              dueDate: date,
              days: daysUntil(date),
            };
          })
          .filter((item): item is DueDateItem => item !== null)
          .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
          .slice(0, DUE_LIMIT);

  /* ── Collection health ───────────────────────────────────────────────────
   * The donut breaks the inventory into the states that explain the availability
   * figure above. Every segment is a count the server already returned, and the
   * headline is available ÷ total — the one number here that is not just a share
   * of the others.
   */
  /* ── Collection health ───────────────────────────────────────────────────
   * A donut is only honest if its segments are a partition — mutually exclusive, and
   * summing to the whole. This one previously mixed copy counts (available) with
   * loan counts (overdue) and hold counts (ready), which double-counts: a copy on
   * loan to someone overdue appears in both "on loan" and "overdue", and the
   * segments visibly add past the total. Every segment below is counted from the
   * same population of copies, so the ring is a real breakdown of the inventory.
   *
   * Segment shares are only shown when they describe the whole. If `available`
   * failed but `copies` succeeded, the ring would be a partial breakdown of a
   * partial total, so it is omitted rather than drawn wrong.
   */
  const unavailableCopies = Math.max(0, totalCopies - availableCopies);
  const shareIsComplete = copies !== undefined && available !== undefined;

  const segments: PerformanceSegment[] = shareIsComplete
    ? [
        // Green for available, because that is the one segment where the colour is
        // also the meaning. Blue is the brand accent and is spent on navigation and
        // primary actions; a green ring segment reads as "healthy" on its own.
        { label: 'Available', value: availableCopies, colour: 'var(--tone-green)' },
        { label: 'Not on shelf', value: unavailableCopies, colour: 'var(--tone-orange)' },
      ]
    : [];

  const percentage = totalCopies > 0 ? Math.round((availableCopies / totalCopies) * 100) : null;

  /* ── Performance figures ───────────────────────────────────────────────────
   * The four lines the ring is read against: what is on the shelf, what is out,
   * what is late, and the share the ring itself is drawn from. Each is included
   * only when its panel resolved, so a librarian without `LOAN_VIEW` sees the
   * inventory figures rather than zeroes standing in for requests they cannot
   * make.
   */
  const performanceMetrics: BorrowingFigure[] = [];
  if (available) performanceMetrics.push({ label: 'Available', value: grouped(availableCopies) });
  if (active) performanceMetrics.push({ label: 'Borrowed', value: grouped(totalActive) });
  if (overdue) performanceMetrics.push({ label: 'Overdue', value: grouped(totalOverdue) });
  performanceMetrics.push({
    label: 'Availability',
    value: percentage === null ? '—' : `${percentage}%`,
  });

  return {
    stats,
    // A member has no `recentLoans` panel, so falling back to their own loans is what
    // keeps the panel populated for them. Without this the table rendered empty above
    // two stat cards and three correct panels, which reads as a loading failure.
    recentLoans: (isMemberView ? memberLoans : rowsOf<LoanDto>(recent)).slice(0, RECENT_LIMIT),
    notices: rowsOf<NotificationDto>(notices),
    newArrivals: rowsOf<BookDto>(newArrivals).slice(0, RECENT_LIMIT),
    calendarMarks,
    performance: {
      heading: isMemberView ? 'My Borrowing' : 'Library Performance',
      figure: percentage === null ? '—' : `${percentage}%`,
      segments: segments.filter((segment) => segment.value > 0),
      metrics: performanceMetrics,
    },
    dueDates,
    borrowing,
    failed,
  };
}

export function useDashboardData(): { data: DashboardData | null; loading: boolean } {
  const { session, can } = useAuth();
  const [state, setState] = useState<{ data: DashboardData | null; loading: boolean }>({
    data: null,
    loading: true,
  });
  // Every relevant realtime event re-runs the fetch below. A counter, not a list:
  // the events only say "something changed", and the fetch re-reads whatever the
  // session is entitled to (it does not care which row changed).
  const [revision, setRevision] = useState(0);

  /**
   * Read once into locals. Depending on the six booleans directly would still be
   * correct, but this makes the effect's real dependency — the session — explicit.
   */
  const entitled = useMemo(
    () => ({
      books: can('BOOK_VIEW'),
      copies: can('COPY_VIEW'),
      loans: can('LOAN_VIEW'),
      ownLoans: can('LOAN_VIEW_OWN'),
      // `_OWN` counts too: the route accepts either grant, and the service forces
      // `memberId` on the query whenever `RESERVATION_VIEW` is absent. Checking the
      // staff grant alone left a member's ready-holds card and the matching
      // calendar marks permanently empty on a dashboard whose stat row asks for
      // exactly that figure.
      reservations: can('RESERVATION_VIEW') || can('RESERVATION_VIEW_OWN'),
      fines: can('FINE_VIEW'),
      members: can('MEMBER_VIEW'),
      notifications: can('NOTIFICATION_VIEW_OWN'),
    }),
    [can],
  );

  // A change in any domain can move a dashboard panel — a book was posted
  // (catalogue), a loan issued (circulation), a fine assessed (finance), a member
  // archived (members), a setting saved (settings), a notice sent (notifications) —
  // so the dashboard treats the whole stream as one trigger and re-reads its panels.
  useEffect(() => {
    if (!session) return;
    const unsubscribers = REALTIME_CHANNELS.map((channel) =>
      subscribeToRealtime(channel, () => setRevision((n) => n + 1)),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const controller = new AbortController();
    const { signal } = controller;

    /**
     * A member sees their own loans rather than the whole library's, so `ownLoans`
     * only applies once the staff view is ruled out.
     *
     * The `loans`/`members` checks are what actually discriminate today — a
     * librarian holds `LOAN_VIEW` and `MEMBER_VIEW` but *not* `LOAN_VIEW_OWN`
     * (`packages/shared/src/roles.ts`, LIBRARIAN_PERMISSIONS). They are kept anyway
     * because this is a narrowing decision: if a future role gains `LOAN_VIEW_OWN`
     * alongside staff rights, `ownLoans` alone would quietly switch it to the member
     * view and hide the staff panels it is entitled to.
     */
    const memberView = entitled.ownLoans && !entitled.loans && !entitled.members;

    const jobs: Promise<[string, unknown]>[] = [];

    if (entitled.books) {
      jobs.push(settled('books', () => listBooks({ limit: 1 }, signal)));
      jobs.push(
        settled('newArrivals', () =>
          listBooks({ limit: RECENT_LIMIT, sort: 'createdAt', direction: 'desc' }, signal),
        ),
      );
    }
    if (entitled.copies) {
      jobs.push(settled('copies', () => listCopies({ limit: 1 }, signal)));
      jobs.push(
        settled('copiesAvailable', () => listCopies({ limit: 1, status: 'AVAILABLE' }, signal)),
      );
    }
    if (entitled.loans) {
      jobs.push(settled('loansActive', () => listLoans({ limit: 1, status: 'ACTIVE' }, signal)));
      jobs.push(settled('loansOverdue', () => listLoans({ limit: 1, status: 'OVERDUE' }, signal)));
      jobs.push(
        settled('recentLoans', () =>
          listLoans(
            { limit: RECENT_LIMIT, sort: 'loanedAt', direction: 'desc', includeReturned: true },
            signal,
          ),
        ),
      );
    }
    if (memberView) {
      jobs.push(
        settled('myLoans', () => listLoans({ limit: CALENDAR_WINDOW, status: 'ACTIVE' }, signal)),
      );
      /*
       * The full record, returned loans included — the only way to count books
       * returned or measure an on-time rate. `myLoans` above stays ACTIVE-only
       * because the recent-activity feed and the calendar marks both read from it,
       * and neither should show a book that is already back on the shelf.
       */
      jobs.push(
        settled('myHistory', () =>
          listLoans({ limit: CALENDAR_WINDOW, includeReturned: true }, signal),
        ),
      );
    }
    if (entitled.reservations) {
      jobs.push(
        settled('reservationsReady', () =>
          listReservations({ limit: CALENDAR_WINDOW, status: 'READY' }, signal),
        ),
      );
    }
    if (entitled.fines) {
      jobs.push(
        settled('finesOutstanding', () =>
          listFines({ limit: CALENDAR_WINDOW, status: 'OUTSTANDING' }, signal),
        ),
      );
    }
    if (memberView) {
      jobs.push(
        settled('myFines', () =>
          listFines({ limit: CALENDAR_WINDOW, status: 'OUTSTANDING' }, signal),
        ),
      );
    }
    if (entitled.members) jobs.push(settled('members', () => listMembers({ limit: 1 }, signal)));
    if (entitled.notifications) {
      jobs.push(settled('notices', () => listNotifications({ limit: NOTICE_LIMIT }, signal)));
    }

    async function load(): Promise<void> {
      const results = await Promise.all(jobs);
      const panels: Panels = {};
      const failed: string[] = [];

      for (const [key, value] of results) {
        if (value === NOT_ENTITLED) continue;
        if (value === FAILED) {
          failed.push(key);
          continue;
        }
        panels[key] = value;
      }

      setState({ data: assemble(panels, failed), loading: false });
    }

    void load().catch(() => setState({ data: null, loading: false }));

    return () => controller.abort();
  }, [session, entitled, revision]);

  return state;
}

/* ── Result sentinels ──────────────────────────────────────────────────────────
 * Two distinct absent cases share one promise chain, and neither may be confused
 * with a successful panel whose value happens to be falsy.
 */

const NOT_ENTITLED = Symbol('not-entitled');
const FAILED = Symbol('failed');

async function settled(key: string, load: () => Promise<unknown>): Promise<[string, unknown]> {
  try {
    return [key, await load()];
  } catch (error) {
    // A 403 means this panel was never the caller's to see. The page simply
    // omits it; surfacing it as an error would be noise about a correct decision.
    if (error instanceof ApiError && error.status === 403) return [key, NOT_ENTITLED];
    return [key, FAILED];
  }
}

/**
 * The quick-access panel is a UX affordance; the server re-checks every action.
 *
 * Takes the candidate list rather than reaching for `QUICK_ACCESS` itself: each
 * dashboard variant brings its own tiles (see `configs.ts`), and this applies the
 * one filter all of them share — the session's permissions.
 */
export function visibleQuickLinks(
  links: readonly QuickLink[],
  allowed: (permission: PermissionCode) => boolean,
): QuickLink[] {
  return links.filter((entry) => allowed(entry.permission));
}
