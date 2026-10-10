import { env } from '../config/env.js';

/**
 * Date arithmetic for circulation.
 *
 * Two different concepts, deliberately kept apart:
 *
 *   • Due dates and fines are CALENDAR days in the library's timezone.
 *     "14 days" means 14 calendar days in Africa/Nairobi, and a member is not
 *     overdue at 09:00 on the day after their due date until the day AFTER
 *     that — regardless of the hour.
 *
 *   • Audited instants are real timestamps (`timestamptz`).
 *
 * The trap this module exists to avoid: reading `getUTCDate()` off an instant
 * and treating that as the calendar date. For Nairobi (UTC+3) the instant
 * 2026-09-30T21:00Z *is* 2026-10-01 local, so UTC-field arithmetic is wrong by
 * a day for 3 hours out of every 24 — and wrong again by an hour across DST in
 * any zone that observes it.
 *
 * Every function resolves the zone offset for the specific instant in question.
 */

const MS_PER_DAY = 86_400_000;

/** Calendar date string (YYYY-MM-DD) in the library's timezone. */
export function toLibraryDate(instant: Date = new Date(), timeZone: string = env.TIMEZONE): string {
  // 'en-CA' formats as YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Offset of `timeZone` from UTC at `instant`, in minutes (east positive).
 *
 * Derived by formatting the instant in the zone and reinterpreting the
 * wall-clock fields as if they were UTC — the difference between the two is the
 * offset. Because it is evaluated per instant, it is correct across DST.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const wallClockAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24, // Intl can emit hour 24 for midnight
    field('minute'),
    field('second'),
  );

  // Discard sub-second precision from the instant so the result is a clean
  // minute count rather than an offset that drifts within the second.
  return Math.round((wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * A pure integer for a calendar date, suitable for day arithmetic.
 *
 * `Date.UTC` on the parsed Y-M-D is just a proleptic-calendar-to-day mapping;
 * no timezone is involved, so DST and host zone are irrelevant by construction.
 */
function dayOrdinal(dateString: string): number {
  const [year, month, day] = dateString.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / MS_PER_DAY;
}

/** The instant at which a calendar date begins in the library's timezone. */
export function startOfLibraryDay(
  date: Date | string = new Date(),
  timeZone: string = env.TIMEZONE,
): Date {
  const dateString = typeof date === 'string' ? date : toLibraryDate(date, timeZone);

  // Noon UTC on the target date is far enough from any real transition that the
  // offset it reports is the offset in force at local midnight for that date.
  const noonUtc = new Date(dayOrdinal(dateString) * MS_PER_DAY + 12 * 3_600_000);
  const offsetMinutes = zoneOffsetMinutes(noonUtc, timeZone);

  return new Date(dayOrdinal(dateString) * MS_PER_DAY - offsetMinutes * 60_000);
}

/**
 * Adds whole calendar days, returning the same wall-clock time of day in the
 * library's timezone.
 *
 * The offset is re-resolved after the shift: where a zone observes DST, adding
 * 86 400 000 ms to an instant does not necessarily advance the local date by
 * one, so a naive ms addition drifts an hour and eventually flips a due date.
 */
export function addCalendarDays(
  instant: Date,
  days: number,
  timeZone: string = env.TIMEZONE,
): Date {
  if (!Number.isInteger(days)) {
    throw new RangeError('addCalendarDays requires a whole number of days');
  }

  const offsetBefore = zoneOffsetMinutes(instant, timeZone);

  // Shift the local wall clock, which is where calendar arithmetic belongs.
  const localWallClock = new Date(instant.getTime() + offsetBefore * 60_000);
  localWallClock.setUTCDate(localWallClock.getUTCDate() + days);

  // Convert back, then correct for the offset in force at the NEW instant. One
  // re-resolution is sufficient: no zone shifts its offset by two hours.
  const provisional = new Date(localWallClock.getTime() - offsetBefore * 60_000);
  const offsetAfter = zoneOffsetMinutes(provisional, timeZone);

  return new Date(localWallClock.getTime() - offsetAfter * 60_000);
}

/**
 * Whole calendar days from `from` to `to`, counted on calendar dates.
 *
 * 2026-10-01 → 2026-10-02 is 1 even though only two minutes of real time
 * elapsed between 23:59 and 00:01 local.
 */
export function calendarDaysBetween(
  from: Date | string,
  to: Date | string,
  timeZone: string = env.TIMEZONE,
): number {
  const fromOrdinal = dayOrdinal(typeof from === 'string' ? from : toLibraryDate(from, timeZone));
  const toOrdinal = dayOrdinal(typeof to === 'string' ? to : toLibraryDate(to, timeZone));

  return toOrdinal - fromOrdinal;
}

/**
 * Overdue days for fine calculation.
 *
 * The grace period is EXCLUDED from the threshold rather than subtracted from
 * the result. Charging from day one and deducting grace later leaves a
 * partially-waived fine record against a member who did nothing wrong, and
 * "3 of 10 days waived" reads as a dispute rather than as correct behaviour.
 *
 * Returns 0 whenever `to` falls on or before the threshold.
 */
export function overdueDays(
  dueDate: Date,
  to: Date = new Date(),
  gracePeriodDays = 0,
  timeZone: string = env.TIMEZONE,
): number {
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) {
    throw new RangeError('Grace period must be a non-negative whole number of days');
  }

  // The threshold is a calendar date, so compare dates rather than instants: a
  // loan due at 15:00 is not overdue at 09:00 the following morning.
  const thresholdDate = addCalendarDays(dueDate, gracePeriodDays, timeZone);
  const days = calendarDaysBetween(thresholdDate, to, timeZone);

  return days > 0 ? days : 0;
}

/** ISO instant, for transport. */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Adds whole seconds to an instant (token lifetimes). */
export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}

/** Parses "15m" / "30d" / "2h" / "45s" into seconds. */
export function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(input.trim());
  if (!match) throw new RangeError(`Invalid duration: ${input}`);

  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  return value * { s: 1, m: 60, h: 3600, d: 86_400 }[unit];
}

/** True when `expiresAt` is in the past. The boundary instant counts as expired. */
export function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}
