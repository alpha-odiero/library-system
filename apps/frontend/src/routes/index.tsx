import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { LoadingState } from '../components/ui/States';
import { RequireAnonymous, RequireAuth, RequirePermission, RequireRole } from './guards';
import { paths } from './paths';

/**
 * The route tree.
 *
 * Structure, and why it is shaped this way:
 *
 *   <RequireAuth>      → no session means no app shell at all. Without this the
 *                        sidebar renders for an anonymous visitor full of links
 *                        that each 403.
 *     <AppLayout>      → the shell, so navigation is defined once for every page.
 *       index          → dashboard
 *       members/*      → behind MEMBER_VIEW; create/edit behind their own
 *                        permissions. Nested guards, so a librarian without
 *                        MEMBER_CREATE never mounts the registration form.
 *   <RequireAnonymous> → a signed-in user is bounced off /login rather than shown
 *                        a form that cannot succeed.
 *
 * Permission gates are route elements, not checks inside components, so an
 * unauthorised request never mounts a page that would fire its data fetch. Hiding
 * the button is the second layer, not the first.
 *
 * Pages are `lazy()` because the shell must paint before the member register's
 * bundle parses — a user on the verification screen should not download a table
 * renderer first. `Suspense` renders a labelled status, so a slow chunk is
 * announced rather than appearing as a blank page.
 */

const LoginPage = lazy(() =>
  import('../features/auth/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const LandingPage = lazy(() =>
  import('../features/landing/LandingPage').then((module) => ({ default: module.LandingPage })),
);
const RegisterPage = lazy(() =>
  import('../features/auth/pages/RegisterPage').then((module) => ({
    default: module.RegisterPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import('../features/auth/pages/ForgotPasswordPage').then((module) => ({
    default: module.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import('../features/auth/pages/ResetPasswordPage').then((module) => ({
    default: module.ResetPasswordPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import('../features/auth/pages/VerifyEmailPage').then((module) => ({
    default: module.VerifyEmailPage,
  })),
);
const ProfilePage = lazy(() =>
  import('../features/auth/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
);
const UserListPage = lazy(() =>
  import('../features/users/pages/UserListPage').then((module) => ({
    default: module.UserListPage,
  })),
);
const UserCreatePage = lazy(() =>
  import('../features/users/pages/UserCreatePage').then((module) => ({
    default: module.UserCreatePage,
  })),
);
const MemberListPage = lazy(() =>
  import('../features/members/pages/MemberListPage').then((module) => ({
    default: module.MemberListPage,
  })),
);
const MemberCreatePage = lazy(() =>
  import('../features/members/pages/MemberCreatePage').then((module) => ({
    default: module.MemberCreatePage,
  })),
);
const MemberDetailPage = lazy(() =>
  import('../features/members/pages/MemberDetailPage').then((module) => ({
    default: module.MemberDetailPage,
  })),
);
const MemberEditPage = lazy(() =>
  import('../features/members/pages/MemberEditPage').then((module) => ({
    default: module.MemberEditPage,
  })),
);
const MemberTypeListPage = lazy(() =>
  import('../features/members/pages/MemberTypeListPage').then((module) => ({
    default: module.MemberTypeListPage,
  })),
);
const FinesPage = lazy(() =>
  import('../features/finance/pages/FinesPage').then((module) => ({ default: module.FinesPage })),
);
const PaymentsPage = lazy(() =>
  import('../features/finance/pages/PaymentsPage').then((module) => ({
    default: module.PaymentsPage,
  })),
);
const NotificationsPage = lazy(() =>
  import('../features/notifications/pages/NotificationsPage').then((module) => ({
    default: module.NotificationsPage,
  })),
);
const ReportsPage = lazy(() =>
  import('../features/reports/pages/ReportsPage').then((module) => ({
    default: module.ReportsPage,
  })),
);
const AuditLogPage = lazy(() =>
  import('../features/audit/pages/AuditLogPage').then((module) => ({
    default: module.AuditLogPage,
  })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);
const BookListPage = lazy(() =>
  import('../features/catalogue/pages/BookListPage').then((module) => ({
    default: module.BookListPage,
  })),
);
const BookDetailPage = lazy(() =>
  import('../features/catalogue/pages/BookDetailPage').then((module) => ({
    default: module.BookDetailPage,
  })),
);
const BookCreatePage = lazy(() =>
  import('../features/catalogue/pages/BookCreatePage').then((module) => ({
    default: module.BookCreatePage,
  })),
);
const BookEditPage = lazy(() =>
  import('../features/catalogue/pages/BookEditPage').then((module) => ({
    default: module.BookEditPage,
  })),
);
const CopyListPage = lazy(() =>
  import('../features/catalogue/pages/CopyListPage').then((module) => ({
    default: module.CopyListPage,
  })),
);
const AuthorListPage = lazy(() =>
  import('../features/catalogue/pages/ReferenceListPages').then((module) => ({
    default: module.AuthorListPage,
  })),
);
const CategoryListPage = lazy(() =>
  import('../features/catalogue/pages/ReferenceListPages').then((module) => ({
    default: module.CategoryListPage,
  })),
);
const PublisherListPage = lazy(() =>
  import('../features/catalogue/pages/ReferenceListPages').then((module) => ({
    default: module.PublisherListPage,
  })),
);
const LoanListPage = lazy(() =>
  import('../features/circulation/pages/LoanListPage').then((module) => ({
    default: module.LoanListPage,
  })),
);
const ReservationListPage = lazy(() =>
  import('../features/circulation/pages/ReservationListPage').then((module) => ({
    default: module.ReservationListPage,
  })),
);
const ForbiddenPage = lazy(() =>
  import('../features/errors/ForbiddenPage').then((module) => ({ default: module.ForbiddenPage })),
);
const NotFoundPage = lazy(() =>
  import('../features/errors/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);

function lazyElement(node: ReactNode): ReactNode {
  return <Suspense fallback={<LoadingState label="Loading page" />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <RequireAnonymous />,
    children: [
      { path: paths.landing, element: lazyElement(<LandingPage />) },
      { path: paths.login, element: lazyElement(<LoginPage />) },
      { path: paths.register, element: lazyElement(<RegisterPage />) },
      { path: paths.forgotPassword, element: lazyElement(<ForgotPasswordPage />) },
      { path: paths.resetPassword, element: lazyElement(<ResetPasswordPage />) },
      { path: paths.verifyEmail, element: lazyElement(<VerifyEmailPage />) },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: lazyElement(<DashboardPage />) },

          /*
           * The three role dashboards.
           *
           * Each is the same page component — it derives which variant to render
           * from the session's role — but each path sits behind `RequireRole`, so
           * a member following a link to `/admin/dashboard` is bounced to their
           * own dashboard before the page mounts (and never fires its data
           * fetch). The index route above serves the identical page at `/` for
           * whichever role is signed in.
           */
          {
            element: <RequireRole roles={['ADMIN']} />,
            children: [{ path: paths.adminDashboard, element: lazyElement(<DashboardPage />) }],
          },
          {
            element: <RequireRole roles={['LIBRARIAN']} />,
            children: [{ path: paths.librarianDashboard, element: lazyElement(<DashboardPage />) }],
          },
          {
            element: <RequireRole roles={['MEMBER']} />,
            children: [{ path: paths.memberDashboard, element: lazyElement(<DashboardPage />) }],
          },

          { path: paths.profile, element: lazyElement(<ProfilePage />) },
          { path: paths.forbidden, element: lazyElement(<ForbiddenPage />) },

          /*
           * Catalogue. Each list sits behind its own permission rather than a
           * shared "catalogue" gate, because `AUTHOR_VIEW` and `BOOK_VIEW` are
           * granted separately — a librarian allowed to read the catalogue is not
           * automatically allowed to edit the name authorities behind it.
           */
          {
            element: <RequirePermission permissions={['BOOK_VIEW']} />,
            children: [
              { path: paths.books, element: lazyElement(<BookListPage />) },
              // Declared before `:id` so "new" is never read as an id — the same
              // ordering rule the members routes use.
              {
                element: <RequirePermission permissions={['BOOK_CREATE']} />,
                children: [{ path: paths.bookNew, element: lazyElement(<BookCreatePage />) }],
              },
              { path: paths.book(':id'), element: lazyElement(<BookDetailPage />) },
              {
                element: <RequirePermission permissions={['BOOK_UPDATE']} />,
                children: [{ path: paths.bookEdit(':id'), element: lazyElement(<BookEditPage />) }],
              },
            ],
          },
          {
            element: <RequirePermission permissions={['COPY_VIEW']} />,
            children: [{ path: paths.copies, element: lazyElement(<CopyListPage />) }],
          },
          {
            element: <RequirePermission permissions={['AUTHOR_VIEW']} />,
            children: [{ path: paths.authors, element: lazyElement(<AuthorListPage />) }],
          },
          {
            element: <RequirePermission permissions={['CATEGORY_VIEW']} />,
            children: [{ path: paths.categories, element: lazyElement(<CategoryListPage />) }],
          },
          {
            element: <RequirePermission permissions={['PUBLISHER_VIEW']} />,
            children: [{ path: paths.publishers, element: lazyElement(<PublisherListPage />) }],
          },

          /*
           * Circulation. Either permission admits the page: `LOAN_VIEW` for staff
           * across the library, `LOAN_VIEW_OWN` for a member's own records. The
           * page narrows its columns and labels from whichever it was given, and the
           * server scopes the rows — so one route serves both without the route
           * having to know which kind of reader turned up.
           */
          {
            element: <RequirePermission permissions={['LOAN_VIEW', 'LOAN_VIEW_OWN']} />,
            children: [
              { path: paths.loans, element: lazyElement(<LoanListPage />) },
              { path: paths.returns, element: lazyElement(<LoanListPage />) },
            ],
          },
          {
            element: (
              <RequirePermission permissions={['RESERVATION_VIEW', 'RESERVATION_VIEW_OWN']} />
            ),
            children: [{ path: paths.reservations, element: lazyElement(<ReservationListPage />) }],
          },
          {
            element: <RequirePermission permissions={['FINE_VIEW', 'FINE_VIEW_OWN']} />,
            children: [{ path: paths.fines, element: lazyElement(<FinesPage />) }],
          },
          {
            element: <RequirePermission permissions={['PAYMENT_VIEW', 'PAYMENT_VIEW_OWN']} />,
            children: [{ path: paths.payments, element: lazyElement(<PaymentsPage />) }],
          },
          {
            element: <RequirePermission permissions={['MEMBER_VIEW']} />,
            children: [
              { path: paths.members, element: lazyElement(<MemberListPage />) },
              // Declared before `:id` so "new" is never read as an id. Express
              // needs this ordering; React Router matches by specificity, but
              // keeping the same order in both layers stops the two disagreeing
              // about what `/members/new` means.
              {
                element: <RequirePermission permissions={['MEMBER_CREATE']} />,
                children: [{ path: paths.memberNew, element: lazyElement(<MemberCreatePage />) }],
              },
              { path: paths.member(':id'), element: lazyElement(<MemberDetailPage />) },
              {
                element: <RequirePermission permissions={['MEMBER_UPDATE']} />,
                children: [
                  { path: paths.memberEdit(':id'), element: lazyElement(<MemberEditPage />) },
                ],
              },
            ],
          },
          {
            element: <RequirePermission permissions={['MEMBER_TYPE_VIEW']} />,
            children: [{ path: paths.memberTypes, element: lazyElement(<MemberTypeListPage />) }],
          },

          /*
           * Staff directory. `USER_VIEW` admits the list; creating an account is a
           * separate grant, nested so a viewer never mounts the provisioning form
           * and its data dependencies. Both sit behind USER_* rather than a role:
           * the permission is what the API checks, and the two must agree.
           */
          {
            element: <RequirePermission permissions={['USER_VIEW']} />,
            children: [
              { path: paths.librarians, element: lazyElement(<UserListPage />) },
              {
                element: <RequirePermission permissions={['USER_CREATE']} />,
                children: [{ path: paths.librarianNew, element: lazyElement(<UserCreatePage />) }],
              },
            ],
          },

          {
            element: <RequirePermission permissions={['NOTIFICATION_VIEW_OWN']} />,
            children: [{ path: paths.notifications, element: lazyElement(<NotificationsPage />) }],
          },

          /*
           * System administration. Reports and the audit log sit behind their own
           * permission, matching the API's gate (`REPORT_VIEW` /
           * `REPORT_VIEW_FINANCIAL`, `AUDIT_VIEW`). Settings does NOT: every
           * signed-in role has an account to manage, so `/settings` opens for
           * all three and shows each the sections it may use. The administrator's
           * organization forms call an API gated by `SETTINGS_UPDATE` + the
           * administrator role, so the screen being reachable is not the same as
           * policy being writable — a librarian who arrives at `?section=fines`
           * simply has no such section to render.
           */
          {
            element: <RequirePermission permissions={['REPORT_VIEW']} />,
            children: [{ path: paths.reports, element: lazyElement(<ReportsPage />) }],
          },
          {
            element: <RequirePermission permissions={['AUDIT_VIEW']} />,
            children: [{ path: paths.audit, element: lazyElement(<AuditLogPage />) }],
          },
          { path: paths.settings, element: lazyElement(<SettingsPage />) },
          { path: '*', element: lazyElement(<NotFoundPage />) },
        ],
      },
    ],
  },
]);

export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
