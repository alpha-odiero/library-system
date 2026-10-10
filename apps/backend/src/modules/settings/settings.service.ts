import type { Prisma, SettingsValueType, Setting } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { invalidOperation } from '../../lib/errors.js';
import { publishRealtime } from '../../lib/events.js';
import { moneyFromInput, type Money } from '../../lib/money.js';

/**
 * Typed system settings.
 *
 * `settings` is a key/value table with a declared value type, and it exists so
 * borrowing policy can be tuned without a deployment. The boundary that matters:
 *
 *   • RULES an administrator should tune live here (and in `member_types`).
 *   • STRUCTURAL limits live in `config/constants.ts` and are NOT settings.
 *     Page size, body size and identifier lengths are not policy — a setting
 *     that lets an admin raise the page-size ceiling turns a convenience
 *     endpoint into a table dump.
 *
 * Reads are CACHED for a short TTL. This is measured-benefit caching, not
 * speculative: every borrow resolves four to six settings, and a busy branch
 * performs hundreds of borrows an hour against values that change perhaps
 * quarterly. The TTL bounds how long a policy change takes to take effect.
 */

const CACHE_TTL_MS = 30_000;

/** The keys the application reads. Declared here so a typo is a compile error. */
export const SETTING_KEYS = {
  ORG_NAME: 'org.name',
  ORG_EMAIL: 'org.email',
  ORG_PHONE: 'org.phone',
  ORG_ADDRESS: 'org.address',
  ORG_CURRENCY: 'org.currency',
  DEFAULT_LOAN_DAYS: 'org.default_loan_days',
  MAX_LOANS: 'org.max_loans',
  FINE_PER_DAY: 'org.fine_per_day',
  GRACE_PERIOD_DAYS: 'org.grace_period_days',
  RESERVATION_HOLD_DAYS: 'org.reservation_hold_days',
  MAX_RESERVATIONS: 'org.max_reservations',
  RENEWAL_LIMIT: 'org.renewal_limit',
  BLOCK_BORROWING_OVER: 'org.block_borrowing_over',
  MEMBERSHIP_VALIDITY_DAYS: 'org.membership_validity_days',
  REQUIRE_EMAIL_VERIFICATION: 'org.require_email_verification',
  ALLOW_MEMBER_SELF_RENEW: 'org.allow_member_self_renew',
  NOTIFY_DUE_SOON_DAYS: 'org.notify_due_soon_days',
  ALLOW_AUDIT_LOG_DELETION: 'org.allow_audit_log_deletion',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

interface CachedSetting {
  key: string;
  value: Prisma.JsonValue;
  valueType: SettingsValueType;
  category: string;
  isPublic: boolean;
  description: string | null;
}

let cache: Map<string, CachedSetting> | null = null;
let cacheLoadedAt = 0;
let inFlight: Promise<Map<string, CachedSetting>> | null = null;

/** Test hook and settings-write hook: drops the cache so the next read is live. */
export function invalidateSettingsCache(): void {
  cache = null;
  cacheLoadedAt = 0;
  inFlight = null;
}

async function loadAll(): Promise<Map<string, CachedSetting>> {
  const rows = await prisma.setting.findMany({
    select: {
      key: true,
      value: true,
      valueType: true,
      category: true,
      isPublic: true,
      description: true,
    },
  });
  return new Map(rows.map((row) => [row.key, row]));
}

async function cachedAll(): Promise<Map<string, CachedSetting>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;

  // A cold cache under concurrent load must produce ONE query, not one per
  // request; without this a busy branch stampedes the settings table on every
  // cache expiry.
  inFlight ??= loadAll()
    .then((loaded) => {
      cache = loaded;
      cacheLoadedAt = Date.now();
      return loaded;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

function readRaw(rows: Map<string, CachedSetting>, key: string): Prisma.JsonValue | undefined {
  return rows.get(key)?.value;
}

/* ── Typed readers ─────────────────────────────────────────────────────────── */

/**
 * Reads a value, falling back when the key is absent or the wrong shape.
 *
 * A missing setting must not take the circulation desk offline: the seed creates
 * all of these, but a partially-migrated database would otherwise fail every
 * borrow. The fallback is the documented default, so behaviour degrades to the
 * policy the code was written against rather than to "unusable".
 */
export async function getSetting<T>(key: SettingKey, fallback: T): Promise<T> {
  const rows = await cachedAll();
  const raw = readRaw(rows, key);
  if (raw === undefined || raw === null) return fallback;
  return coerce(raw, fallback);
}

function coerce<T>(raw: Prisma.JsonValue, fallback: T): T {
  if (typeof fallback === 'number') {
    const value = typeof raw === 'number' ? raw : Number(raw);
    return (Number.isFinite(value) ? value : fallback) as T;
  }
  if (typeof fallback === 'boolean') {
    if (typeof raw === 'boolean') return raw as T;
    if (raw === 'true') return true as T;
    if (raw === 'false') return false as T;
    return fallback;
  }
  if (typeof fallback === 'string') {
    // Only primitives stringify meaningfully. A JSON object or array reaching
    // here would render as "[object Object]" and be stored as that literal,
    // turning a config typo into a permanently wrong value.
    if (typeof raw === 'string') return raw as T;
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw) as T;
    return fallback;
  }
  return raw as T;
}

export async function getMoneySetting(key: SettingKey, fallback: string): Promise<Money> {
  const rows = await cachedAll();
  const raw = readRaw(rows, key);
  if (raw === undefined || raw === null) return moneyFromInput(fallback, key);
  try {
    return moneyFromInput(raw, key);
  } catch {
    // A corrupt settings row must not make every borrow fail. Log loudly, use
    // the documented default, and let an operator fix the row.
    logger.error(
      { event: 'setting.invalid_money', key, raw },
      'Setting is not a valid decimal amount; using fallback',
    );
    return moneyFromInput(fallback, key);
  }
}

/* ── Policy bundle ─────────────────────────────────────────────────────────── */

/**
 * The borrowing policy, resolved in one pass.
 *
 * Read once per circulation operation rather than key-by-key, so a borrow sees a
 * single consistent snapshot instead of four reads that could straddle an
 * administrator's edit.
 */
export interface BorrowingPolicy {
  defaultLoanDays: number;
  maxLoans: number;
  finePerDay: string;
  gracePeriodDays: number;
  reservationHoldDays: number;
  maxReservations: number;
  renewalLimit: number;
  /** Outstanding balance above which borrowing is blocked. */
  blockBorrowingOver: string;
  membershipValidityDays: number;
  requireEmailVerification: boolean;
  allowMemberSelfRenew: boolean;
  notifyDueSoonDays: number;
  currency: string;
}

export async function getBorrowingPolicy(): Promise<BorrowingPolicy> {
  const rows = await cachedAll();

  const num = (key: string, fallback: number): number => {
    const raw = readRaw(rows, key);
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const str = (key: string, fallback: string): string => {
    const raw = readRaw(rows, key);
    return typeof raw === 'string' && raw.length > 0 ? raw : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const raw = readRaw(rows, key);
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  };

  return {
    defaultLoanDays: num(SETTING_KEYS.DEFAULT_LOAN_DAYS, 14),
    maxLoans: num(SETTING_KEYS.MAX_LOANS, 5),
    finePerDay: str(SETTING_KEYS.FINE_PER_DAY, '50.00'),
    gracePeriodDays: num(SETTING_KEYS.GRACE_PERIOD_DAYS, 3),
    reservationHoldDays: num(SETTING_KEYS.RESERVATION_HOLD_DAYS, 3),
    maxReservations: num(SETTING_KEYS.MAX_RESERVATIONS, 5),
    renewalLimit: num(SETTING_KEYS.RENEWAL_LIMIT, 2),
    blockBorrowingOver: str(SETTING_KEYS.BLOCK_BORROWING_OVER, '2000.00'),
    membershipValidityDays: num(SETTING_KEYS.MEMBERSHIP_VALIDITY_DAYS, 365),
    requireEmailVerification: bool(SETTING_KEYS.REQUIRE_EMAIL_VERIFICATION, false),
    allowMemberSelfRenew: bool(SETTING_KEYS.ALLOW_MEMBER_SELF_RENEW, true),
    notifyDueSoonDays: num(SETTING_KEYS.NOTIFY_DUE_SOON_DAYS, 3),
    currency: str(SETTING_KEYS.ORG_CURRENCY, 'KES'),
  };
}

/* ── Public settings ───────────────────────────────────────────────────────── */

/**
 * The only settings readable before authentication.
 *
 * `GET /api/v1/settings/public` is unauthenticated (it is in `PUBLIC_ROUTES`),
 * so it returns ONLY rows flagged `is_public` in the database. The filter lives
 * in the SQL, not in a projection — selecting more and hiding it is the exact
 * pattern the docs forbid.
 */
export async function getPublicSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany({
    where: { isPublic: true },
    select: { key: true, value: true, valueType: true },
    orderBy: { key: 'asc' },
  });

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Every setting, grouped by category. `SETTINGS_VIEW` only. */
export async function listSettings(
  category?: string,
): Promise<{ category: string; settings: Array<Record<string, unknown>> }[]> {
  const rows = await prisma.setting.findMany({
    where: category ? { category } : undefined,
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });

  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const bucket = grouped.get(row.category) ?? [];
    bucket.push({
      key: row.key,
      value: row.value,
      valueType: row.valueType,
      description: row.description,
      isPublic: row.isPublic,
      updatedAt: row.updatedAt.toISOString(),
    });
    grouped.set(row.category, bucket);
  }

  return [...grouped.entries()].map(([name, settings]) => ({ category: name, settings }));
}

export async function getSettingRow(key: string) {
  return prisma.setting.findUnique({ where: { key } });
}

/**
 * Updates one setting and invalidates the cache in the same call.
 *
 * Writes are validated against the row's declared `valueType`. Without that, a
 * typo turns `max_loans` into the string `"5"` and every later comparison
 * silently coerces — a policy that looks configured but is not.
 */
export async function updateSetting(
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<Setting> {
  const existing = await prisma.setting.findUnique({ where: { key } });
  if (!existing) {
    throw invalidOperation('SETTINGS_INVALID', `Unknown setting: ${key}`);
  }

  const validated = validateSettingValue(existing.valueType, value, key);
  if (validated === undefined) {
    throw invalidOperation('SETTINGS_INVALID', `${key} cannot be null`);
  }

  const updated = await prisma.setting.update({
    where: { key },
    data: { value: validated, updatedBy },
  });

  invalidateSettingsCache();
  publishRealtime({
    channel: 'settings',
    action: 'Setting.updated',
    entityId: key,
    occurredAt: new Date().toISOString(),
  });
  return updated;
}

function validateSettingValue(
  type: SettingsValueType,
  value: unknown,
  key: string,
): Prisma.InputJsonValue | undefined {
  switch (type) {
    case 'string':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      throw invalidOperation('SETTINGS_INVALID', `${key} must be a string value`);
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) {
        throw invalidOperation('SETTINGS_INVALID', 'Value must be a finite number');
      }
      // A setting that must never go negative: a negative loan duration would
      // produce a due date before the issue date, which `ck_loan_dates` then
      // rejects with an opaque constraint error instead of a useful message.
      if (parsed < 0) {
        throw invalidOperation('SETTINGS_INVALID', 'Value cannot be negative');
      }
      return parsed;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw invalidOperation('SETTINGS_INVALID', 'Value must be true or false');
    case 'json':
      return value as Prisma.InputJsonValue;
    default: {
      // Unknown declared type: refuse rather than guess. Silently keeping the
      // previous value would hide a typo in the settings table.
      logger.error(
        { event: 'setting.unknown_type', key, type },
        'Setting declares an unknown value type',
      );
      throw invalidOperation('SETTINGS_INVALID', 'Setting has an unsupported type');
    }
  }
}
