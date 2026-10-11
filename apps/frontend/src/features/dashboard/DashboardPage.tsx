import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePublicSettings } from '../../app/usePublicSettings';
import { displayName } from '../../lib/contracts';
import { Card } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/States';
import {
  BottomBanner,
  BorrowingPerformance,
  DueDates,
  LibraryCalendar,
  NewArrivals,
  NoticeBoard,
  PerformanceDonut,
  QuickAccess,
  RecentLoans,
  StatRow,
  WelcomeBanner,
} from './components/Panels';
import { useDashboardData, visibleQuickLinks } from './useDashboardData';
import { dashboardConfigFor } from './configs';

/**
 * The landing page — one component, three role-shaped configurations.
 *
 * Which variant renders comes from the session's role via `configs.ts`, never
 * from the URL: the route guard decides which dashboard path a role may open,
 * and this decides what that role's page says and shows. Deriving from the
 * session keeps the two answers consistent even at `/`, where the index route
 * serves whichever variant the signed-in role owns.
 *
 * ## The layout, and why
 *
 * One pair of columns, not two. `.dash-body` is `main | rail`, and *everything*
 * the reader scrolls past lives in the left track — the greeting, the figures,
 * the shelf, the two summaries and the closing banner — so the right track can
 * run beside all of it as a standing column of things to *act* on: the calendar,
 * what falls due next, this user's notices, and the shortcuts.
 *
 * That is what makes the split read as roughly 70/30 rather than as two
 * independent stacks of unequal length. Greeting and figures sitting above the
 * split, as they used to, put a full-width block over a column that only started
 * below it, which is why the page looked like three flat rows instead of a
 * composition.
 *
 * The rail is `16.5rem` and fixed; the main column takes the rest — about 70% on
 * a laptop. Below `64rem` the rail drops under the main column and the DOM order
 * above becomes the reading order, which is why the panels are laid out in this
 * sequence rather than being reordered per breakpoint.
 *
 * ## No invented figures
 *
 * Every number comes from a live request the session is entitled to make. There are
 * no placeholder statistics and no zeros standing in for data — see
 * `useDashboardData` for why, and for what happens when a request fails.
 */
export function DashboardPage(): ReactNode {
  const { session, can } = useAuth();
  const settings = usePublicSettings();
  const { data, loading } = useDashboardData();

  const orgName = settings?.['org.name'] || 'Soma360';
  const config = dashboardConfigFor(session?.roleCode);
  const isMember = config.variant === 'member';
  const pending = loading && !data;

  // Staff see the inventory ring; a member's page gets the borrowing panel
  // instead, because a patron has no inventory to draw (see `showPerformance`
  // in `configs.ts`). Both answer "how is this library / my account doing", and
  // neither is ever rendered empty.
  const showDonut = !!data && config.showPerformance && data.performance.segments.length > 0;

  return (
    <div className="dash" role="region" aria-label={config.title}>
      <div className="dash-body">
        <div className="dash-main">
          {/* The greeting and the figures are the top of the main column, not a
              band across both columns: keeping them inside the split is what lets
              the rail start level with the page's first line. */}
          <WelcomeBanner
            name={displayName(session)}
            branch={session?.primaryBranchName ?? null}
            isMember={isMember}
            summary={describe(data, isMember)}
          />

          {pending ? (
            <StatRowPlaceholder count={isMember ? 6 : 5} />
          ) : (
            data && <StatRow stats={data.stats} />
          )}

          {/*
            A failed panel is named rather than hidden. A librarian seeing three figures
            where there should be five needs to know whether the library is quiet or the
            request failed — those are very different problems with the same appearance.
          */}
          {data && data.failed.length > 0 && (
            <p className="dash__notice" role="status">
              Some figures could not be loaded. Refresh to try again.
            </p>
          )}

          {/* The newest titles, full width: staff scan it for cataloguing, and a
              member reads the same shelf. */}
          <NewArrivals books={data?.newArrivals ?? []} loading={pending} />

          <div className="dash-duo">
            {pending ? (
              <Card className="dash-panel dash-panel--borrowing" title="Performance">
                <LoadingState label="Loading performance" rows={3} />
              </Card>
            ) : data && showDonut ? (
              <PerformanceDonut
                heading={data.performance.heading}
                figure={data.performance.figure}
                segments={data.performance.segments}
                metrics={data.performance.metrics}
              />
            ) : data && data.borrowing ? (
              <BorrowingPerformance
                heading={data.borrowing.heading}
                bars={data.borrowing.bars}
                figures={data.borrowing.figures}
              />
            ) : null}

            {/*
              Recent circulation is the record column: it is what already happened,
              so it sits beside the summary rather than above it.
            */}
            <RecentLoans
              loans={data?.recentLoans ?? []}
              loading={pending}
              memberView={isMember}
              title={config.recentTitle}
            />
          </div>

          <BottomBanner canBrowse={can('BOOK_VIEW')} />
        </div>

        <aside className="dash-rail">
          {config.showCalendar && data && (
            <LibraryCalendar marks={data.calendarMarks} title={config.calendarTitle} />
          )}

          {/* Rendered only when the loan request resolved: `null` there means the
              request failed, and "nothing due" must not stand in for that. */}
          {data?.dueDates && <DueDates items={data.dueDates} loading={pending} />}

          {config.showNoticeBoard && (
            <NoticeBoard
              notices={data?.notices ?? []}
              loading={pending}
              title={config.noticesTitle}
            />
          )}

          <QuickAccess
            links={visibleQuickLinks(config.quickLinks, can)}
            title={config.quickLinksTitle}
          />
        </aside>
      </div>

      <footer className="app-footer">
        <p className="app-footer__tagline">
          © {new Date().getFullYear()} {orgName} · Library Management System
        </p>
      </footer>
    </div>
  );
}

/**
 * One sentence about the library today.
 *
 * Built from figures already on the page rather than invented, and it says nothing
 * when there is nothing known yet — a greeting that claims "everything is running
 * smoothly" on an empty database is the exact confident nonsense this page exists
 * to avoid.
 */
function describe(data: ReturnType<typeof useDashboardData>['data'], isMember: boolean): string {
  if (!data || data.stats.length === 0) {
    return 'Your account is ready. Figures appear once the library records load.';
  }

  const overdue = data.stats.find((stat) => stat.id === 'overdue');
  const catalogue = data.stats.find((stat) => stat.id === 'catalogue');

  if (isMember) {
    const loans = data.stats.find((stat) => stat.id === 'loans');
    return loans
      ? `You have ${loans.value} ${loans.value === '1' ? 'book' : 'books'} on loan.`
      : 'Your borrowing record is up to date.';
  }

  const parts: string[] = [];
  // The catalogue card carries the on-shelf share in its detail line, which is the
  // same wording the card shows — repeating the number in the greeting would only
  // add a second place for it to be wrong.
  if (catalogue?.detail) parts.push(catalogue.detail.replace(/ on shelf$/, ' copies on shelf'));
  if (overdue && overdue.value !== '0') parts.push(`${overdue.value} overdue`);

  return parts.length > 0
    ? `${parts.join(' · ')}.`
    : 'No overdue items. Circulation is up to date.';
}

/*
 * Skeleton for the stat row, matching its count and height so nothing shifts on
 * load.
 *
 * The count is passed rather than fixed at five: staff rows are five, but a
 * member's resolves to six, and a five-card skeleton collapsing into a six-card
 * row moves every figure on it by one column width as the page settles.
 */
function StatRowPlaceholder({ count = 5 }: { count?: number }): ReactNode {
  const rowClasses = count >= 6 ? 'stat-row stat-row--six' : 'stat-row';

  return (
    <div className={rowClasses} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="stat-card" key={index}>
          <span className="skeleton__row" />
        </div>
      ))}
    </div>
  );
}
