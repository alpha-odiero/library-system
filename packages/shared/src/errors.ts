/**
 * API error codes — the stable machine-readable contract between API and client.
 *
 * Rules:
 *   - Codes never change meaning once published; add a new code instead.
 *   - Messages are safe to display to end users (no SQL, paths, or stack traces).
 *   - HTTP status is derived from the code in one place (backend `lib/errors.ts`),
 *     so a code can never disagree with its status.
 */

export const ERROR_CODES = {
  // ── Generic ──────────────────────────────────────────────────────────────
  VALIDATION_ERROR: 400,
  MALFORMED_REQUEST: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,

  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  SESSION_REVOKED: 401,
  EMAIL_NOT_VERIFIED: 401,
  ACCOUNT_LOCKED: 423,

  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,

  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,

  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  TIMEOUT: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function statusForCode(code: ErrorCode): number {
  return ERROR_CODES[code] ?? 500;
}

/**
 * Domain error codes.
 *
 * These are *reasons*, layered on top of a transport status. The HTTP status
 * stays meaningful while the client can still branch on the precise cause —
 * e.g. a borrow attempt can be 409 CONFLICT because the copy was taken, and
 * the UI must distinguish that from a member-at-limit failure even though both
 * arrive as 409.
 */
export const DOMAIN_CODES = [
  'COPY_NOT_AVAILABLE',
  'COPY_ALREADY_ON_LOAN',
  'COPY_NOT_BORROWABLE',
  'LOAN_NOT_ACTIVE',
  'LOAN_LIMIT_REACHED',
  'LOAN_OVERDUE',
  'LOAN_ALREADY_RETURNED',
  'RENEWAL_LIMIT_REACHED',
  'RENEWAL_BLOCKED_BY_RESERVATION',
  'MEMBER_INACTIVE',
  'MEMBERSHIP_EXPIRED',
  'MEMBER_SUSPENDED',
  'MEMBER_ALREADY_REGISTERED',
  'MEMBER_HAS_ACTIVE_LOANS',
  'MEMBER_HAS_ACTIVE_RESERVATIONS',
  'MEMBER_HAS_OUTSTANDING_FINES',
  'OUTSTANDING_BALANCE_TOO_HIGH',
  'RESERVATION_DUPLICATE',
  'BOOK_ISBN13_DUPLICATE',
  'BOOK_DUPLICATE',
  'RESERVATION_LIMIT_REACHED',
  'RESERVATION_NOT_READY',
  'RESERVATION_EXPIRED',
  'CANNOT_RESERVE_HELD_COPY',
  'BOOK_NOT_LOANABLE',
  'FINE_NOT_FOUND',
  'FINE_ALREADY_SETTLED',
  'FINE_OVERPAYMENT',
  'FINE_NOT_WAIVABLE',
  'PAYMENT_INVALID',
  'PAYMENT_ALREADY_VOIDED',
  'COPY_ALREADY_RESERVED',
  'SETTINGS_INVALID',
  'IMMUTABLE_RECORD',
  'IDEMPOTENCY_CONFLICT',
  'STALE_RESOURCE_VERSION',
] as const;

export type DomainCode = (typeof DOMAIN_CODES)[number];

/** Every code the API can emit. */
export type ApiErrorCode = ErrorCode | DomainCode;

/**
 * `Object.keys` widens to `string[]`, so the keys are asserted back to `ErrorCode`.
 * Without this the list is `string[]`, and `statusForApiCode(ALL_ERROR_CODES[i])`
 * stops type-checking — exactly where exhaustiveness would be worth having.
 */
export const ALL_ERROR_CODES: readonly ApiErrorCode[] = [
  ...(Object.keys(ERROR_CODES) as ErrorCode[]),
  ...DOMAIN_CODES,
];

/**
 * HTTP status for a domain code. Domain codes are conflicts/state problems in
 * the circulation domain and therefore map to 409; validation-shaped ones map
 * to 422 so clients can separate "you sent nonsense" from "the world disagrees".
 */
const DOMAIN_STATUS: Record<DomainCode, number> = {
  COPY_NOT_AVAILABLE: 409,
  COPY_ALREADY_ON_LOAN: 409,
  COPY_NOT_BORROWABLE: 409,
  LOAN_NOT_ACTIVE: 409,
  LOAN_LIMIT_REACHED: 409,
  LOAN_OVERDUE: 409,
  LOAN_ALREADY_RETURNED: 409,
  RENEWAL_LIMIT_REACHED: 409,
  RENEWAL_BLOCKED_BY_RESERVATION: 409,
  MEMBER_INACTIVE: 409,
  MEMBERSHIP_EXPIRED: 409,
  MEMBER_SUSPENDED: 409,
  MEMBER_ALREADY_REGISTERED: 409,
  MEMBER_HAS_ACTIVE_LOANS: 409,
  MEMBER_HAS_ACTIVE_RESERVATIONS: 409,
  MEMBER_HAS_OUTSTANDING_FINES: 409,
  OUTSTANDING_BALANCE_TOO_HIGH: 409,
  RESERVATION_DUPLICATE: 409,
  BOOK_ISBN13_DUPLICATE: 409,
  BOOK_DUPLICATE: 409,
  RESERVATION_LIMIT_REACHED: 409,
  RESERVATION_NOT_READY: 409,
  RESERVATION_EXPIRED: 409,
  CANNOT_RESERVE_HELD_COPY: 409,
  BOOK_NOT_LOANABLE: 409,
  FINE_NOT_FOUND: 404,
  FINE_ALREADY_SETTLED: 409,
  FINE_OVERPAYMENT: 422,
  FINE_NOT_WAIVABLE: 409,
  PAYMENT_INVALID: 422,
  PAYMENT_ALREADY_VOIDED: 409,
  COPY_ALREADY_RESERVED: 409,
  SETTINGS_INVALID: 422,
  IMMUTABLE_RECORD: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STALE_RESOURCE_VERSION: 409,
};

export function statusForDomainCode(code: DomainCode): number {
  return DOMAIN_STATUS[code] ?? 409;
}

export function statusForApiCode(code: ApiErrorCode): number {
  return code in ERROR_CODES
    ? ERROR_CODES[code as ErrorCode]
    : statusForDomainCode(code as DomainCode);
}
