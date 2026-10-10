import { env } from './env.js';

/**
 * Application constants.
 *
 * Anything that a business rule depends on and that must NOT be tuned by an
 * administrator belongs here as a hard ceiling. Everything an administrator
 * *should* be able to tune belongs in `member_types` (policy) or `settings`
 * (configuration).
 */

/** Immutable structural limits. Not user-configurable. */
export const LIMITS = {
  /** Hard ceiling on collection page size, independent of any client request. */
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE_SIZE: 20,
  /** Reject a body larger than this before parsing it. */
  MAX_JSON_BODY_BYTES: '1mb',
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  /** Accession/barcode/QR lengths. */
  ACCESSION_NUMBER_MAX: 50,
  BARCODE_MAX: 64,
  QR_TOKEN_MAX: 64,
  MEMBERSHIP_NUMBER_MAX: 30,
  /** Ceiling on a single offline loan extension, whatever an admin configures. */
  MAX_LOAN_DURATION_DAYS: 365,
  MAX_RENEWALS: 20,
  MAX_FINE_AMOUNT: 99_999_999.99,
  MAX_PAYMENT_AMOUNT: 99_999_999.99,
  /** A hold may not be extended indefinitely. */
  MAX_HOLD_DURATION_DAYS: 30,
} as const;

/** Password policy. */
export const PASSWORD_POLICY = {
  MIN_LENGTH: 12,
  MAX_LENGTH: 128,
  /** Small, explicit denylist. A production deployment should load a larger
   *  breach corpus (e.g. HIBP top-passwords) into this set at boot. */
  COMMON_DENYLIST: new Set([
    'password',
    'password1',
    'password123',
    'passw0rd',
    'qwerty',
    'qwerty123',
    '12345678',
    '123456789',
    '1234567890',
    '11111111',
    'admin',
    'administrator',
    'letmein',
    'welcome',
    'iloveyou',
    'abc123',
    'monkey',
    'dragon',
    'library',
    'changeme',
    'trustno1',
    'sunshine',
    'princess',
    'football',
    'baseball',
  ]),
} as const;

/** Token / session lifetimes are configuration; these are the bounds. */
export const TOKEN_LIMITS = {
  PASSWORD_RESET_TTL_MINUTES: 30,
  EMAIL_VERIFICATION_TTL_HOURS: 48,
  /** How far back a rotated refresh token may be presented before we treat it
   *  as theft. Anything older means the family is already fully rotated. */
  ROTATION_GRACE_SECONDS: 0,
} as const;

/** Cookie scoping. The refresh cookie is limited to the auth routes so it is
 *  not attached to every ordinary API call. */
export const COOKIE_PATHS = {
  REFRESH: '/api/v1/auth',
  CSRF: '/',
} as const;

/**
 * Cookie names.
 *
 * `ACCESS` carries the short-lived signed access credential. `REFRESH` carries
 * the opaque rotating token whose SHA-256 lives in `sessions.refresh_token_hash`;
 * only the hash is stored, so a database disclosure does not yield usable
 * credentials.
 *
 * The CSRF cookie is configurable (see `CSRF_COOKIE_NAME`) and deliberately NOT
 * HttpOnly — the browser client must read it to echo it in a header. It is
 * worthless on its own: forging the header requires a successful CORS preflight,
 * and the token is only accepted alongside a valid session cookie.
 */
export const COOKIE_NAMES = {
  ACCESS: 'lms_session',
  REFRESH: 'lms_refresh',
} as const;

/**
 * Methods the CSRF check exempts.
 *
 * GET/HEAD/OPTIONS are "safe" by definition and must not mutate state, so a
 * cross-site invocation cannot do damage. Exempting them is what lets a
 * bookmarked GET work at all; anything that mutates still needs a token.
 *
 * With `SameSite=Lax` on the session cookie a cross-site POST already carries no
 * cookie, so the double-submit check is defence in depth rather than the primary
 * control. It is kept because `Lax` does not cover every browser behaviour, and a
 * silent regression there would otherwise be invisible.
 */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Why a session ended. Persisted on `sessions.revoked_reason`. */
export const REVOCATION_REASONS = {
  LOGOUT: 'logout',
  LOGOUT_ALL: 'logout_all',
  ROTATED: 'rotated',
  REUSE_DETECTED: 'reuse_detected',
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_RESET: 'password_reset',
  USER_DEACTIVATED: 'user_deactivated',
  EXPIRED: 'expired',
  ADMIN_REVOKED: 'admin_revoked',
} as const;

export type RevocationReason = (typeof REVOCATION_REASONS)[keyof typeof REVOCATION_REASONS];

/** Header names. `HEADER_CSRF` is configurable so the name can change without a
 *  coordinated frontend release; it must stay in sync with the client. */
export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_CSRF = env.CSRF_HEADER_NAME;

/** Dates after which a member's notification nudges are due. */
export const REMINDER_DAYS_BEFORE_DUE = 3;

/**
 * Sort allowlists, one per listable resource.
 *
 * Interpolating a caller-supplied `sort` value into Prisma's `orderBy` would be
 * a mass-assignment hole: an arbitrary key could order by an internal column or
 * a relation, letting a caller probe data through result ordering. Each list is
 * also constrained to columns a member is allowed to know they exist — ordering
 * by `lockedUntil` would confirm an account is locked even when the field is not
 * in the projection.
 */
export const SORTABLE_FIELDS = {
  book: ['title', 'publicationYear', 'createdAt', 'updatedAt'],
  author: ['name', 'sortName', 'createdAt'],
  category: ['name', 'position', 'createdAt'],
  publisher: ['name', 'createdAt'],
  memberType: ['name', 'createdAt'],
  member: ['membershipNumber', 'joinedAt', 'expiresAt', 'createdAt', 'updatedAt'],
  user: ['lastName', 'createdAt', 'updatedAt', 'lastLoginAt'],
  branch: ['name', 'code', 'createdAt'],
  location: ['name', 'code', 'createdAt'],
  shelf: ['code', 'createdAt'],
  copy: ['accessionNumber', 'acquisitionDate', 'createdAt', 'updatedAt'],
  loan: ['loanedAt', 'dueDate', 'createdAt', 'returnedAt'],
  renewal: ['renewedAt', 'renewalNumber'],
  reservation: ['reservedAt', 'position', 'holdExpiresAt', 'createdAt'],
  fine: ['assessedAt', 'dueDate', 'amount', 'createdAt'],
  payment: ['paidAt', 'amount', 'createdAt'],
  notification: ['createdAt', 'readAt'],
  audit: ['createdAt'],
  digitalResource: ['title', 'createdAt'],
  report: ['createdAt'],
} as const satisfies Record<string, readonly string[]>;

export type SortableResource = keyof typeof SORTABLE_FIELDS;
export type SortableBookField = (typeof SORTABLE_FIELDS.book)[number];

/** Backwards-compatible alias used by the book list route. */
export const SORTABLE_BOOK_FIELDS = SORTABLE_FIELDS.book;

/**
 * Per-resource pagination ceilings.
 *
 * `MEMBERS`, `BOOKS` and `LOANS` are deliberately smaller than the structural
 * maximum: those tables reach 50k–100k+ rows, and a 100-row page of joined
 * catalogue data is where an N+1 in a projection first becomes visible.
 * Reference data (authors, categories, publishers) has no ceiling because the
 * caller needs the whole list to populate a picker.
 */
export const PAGE_SIZE_LIMITS = {
  default: 20,
  member: 25,
  book: 24,
  loan: 50,
  audit: 100,
  reference: 100,
  max: 100,
} as const;

/**
 * Field allowlists.
 *
 * Anything reachable from a request body must appear here. Prisma rejects
 * unknown keys, but an explicit allowlist also blocks *mass assignment* of
 * columns a schema forgot — e.g. `roleId` sneaking through a member-update body.
 */
export const WRITABLE_FIELDS = {
  user: ['firstName', 'lastName', 'phone'] as const,
  member: [
    'status',
    'address',
    'city',
    'occupation',
    'dateOfBirth',
    'gender',
    'memberTypeId',
    'homeBranchId',
    'expiresAt',
    'notes',
  ] as const,
  book: [
    'isbn13',
    'isbn10',
    'title',
    'subtitle',
    'description',
    'edition',
    'language',
    'publicationYear',
    'publicationDate',
    'pageCount',
    'publisherId',
    'coverImageUrl',
    'callNumber',
    'subjects',
    'summary',
    'isReferenceOnly',
  ] as const,
} as const;

/**
 * Never serialised into any API response, log payload, or audit snapshot.
 *
 * `redact()` and `toTransport()` derive their blocklist from this list, so a
 * credential missing here is a credential that leaks — the pino `REDACT_PATHS`
 * list alone is not sufficient.
 */
export const NEVER_SERIALISE_FIELDS = [
  // Credentials — plaintext and hashed alike.
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'password_hash',
  'refreshTokenHash',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'secret',
  'clientSecret',
  'consumerSecret',
  'mfaSecret',
  'pin',
  'otp',
  'mpesaPin',
  'nationalId',
  'ssn',
  // Operational data that must not reach a client response.
  'failedLoginCount',
  'lockedUntil',
  'lastLoginIp',
  'storageKey',
] as const;
