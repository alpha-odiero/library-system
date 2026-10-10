/**
 * Every path in the app, in one place.
 *
 * A string literal typed twice is a link that 404s after a rename. Guards,
 * navigation, and the router all import from here so a route cannot exist in the
 * navigation and not in the router — which is how a user ends up clicking a
 * sidebar item that dumps them on a not-found page.
 *
 * Nav items are only added here when the API behind them is implemented. A
 * sidebar entry pointing at a page that does not exist is a promise the product
 * cannot keep, and a librarian who learns to distrust one entry stops trusting
 * the six that work.
 */
export const paths = {
  /*
   * The public marketing page.
   *
   * Deliberately not `/`. That path is the dashboard, and it is written as the
   * post-sign-in redirect in `AuthContext`, in `RequireAuth`'s `from` fallback and
   * in `RequireAnonymous`. Repointing the index route at a landing page would mean an
   * anonymous visitor silently landing on marketing instead of the dashboard, and
   * every one of those references would need auditing to keep the app's behaviour
   * identical. A separate path keeps the landing page a real, linkable destination
   * without touching how the app routes a signed-in reader.
   */
  landing: '/welcome',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  /**
   * The role-aware index: whichever dashboard the signed-in role should see.
   *
   * The three explicit paths below are the *destinations* — sign-in redirects,
   * nav links and the role guard all resolve to one of them so the URL says
   * which dashboard is on screen. `/` stays a working alias because it is the
   * path written in guards, in the auth context's boot redirect, and in every
   * "go to the dashboard" fallback; removing it would break all three at once.
   */
  dashboard: '/',
  adminDashboard: '/admin/dashboard',
  librarianDashboard: '/librarian/dashboard',
  memberDashboard: '/member/dashboard',
  profile: '/profile',
  forbidden: '/forbidden',
  notFound: '/not-found',

  /* Catalogue */
  books: '/books',
  bookNew: '/books/new',
  book: (id: string) => `/books/${id}`,
  bookEdit: (id: string) => `/books/${id}/edit`,
  copies: '/copies',
  authors: '/authors',
  categories: '/categories',
  publishers: '/publishers',

  /* Circulation */
  loans: '/loans',
  returns: '/returns',
  reservations: '/reservations',
  fines: '/fines',
  payments: '/payments',

  /* People */
  members: '/members',
  memberNew: '/members/new',
  member: (id: string) => `/members/${id}`,
  memberEdit: (id: string) => `/members/${id}/edit`,
  memberTypes: '/member-types',
  /* Staff directory (USER_VIEW) */
  librarians: '/librarians',
  librarianNew: '/librarians/new',

  /* Inbox */
  notifications: '/notifications',

  /* System (ADMIN-only in practice — see the permission registry) */
  reports: '/reports',
  audit: '/audit',
  settings: '/settings',
} as const;

/** Where to send someone who asked for a page they may not see. */
export const FORBIDDEN_PATH = paths.forbidden;
