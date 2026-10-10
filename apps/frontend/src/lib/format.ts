/**
 * Presentation helpers.
 *
 * Two rules shape this module:
 *
 *   1. **Money is a string until it is formatted.** `Decimal(14,2)` arrives as a
 *      string because a JSON number cannot hold 0.01 exactly. `Intl.NumberFormat`
 *      is given the string, never `parseFloat` of it, so no rounding happens on the
 *      way to the screen.
 *
 *   2. **A calendar date is not an instant.** `dateOfBirth` is `YYYY-MM-DD` and
 *      has no timezone. Passing it to `new Date()` and formatting it in the
 *      browser's zone shifts a birthday by a day for anyone west of UTC. Dates of
 *      record are formatted from their parts; instants are formatted with a fixed
 *      zone so a screenshot in Nairobi and one in Lagos agree.
 */

const MONEY_FORMAT = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `KES 1,250.00`. Rejects a malformed amount by rendering it verbatim. */
export function formatMoney(amount: string | null | undefined, currency = 'KES'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) return `${currency} ${amount}`;
  return `${currency} ${MONEY_FORMAT.format(Number(amount))}`;
}

/** A plain grouped number, for counts that are not money. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-KE').format(value);
}

/**
 * A calendar date, rendered from its parts.
 *
 * `2026-03-01` stays `1 Mar 2026` everywhere. Deliberately not `new Date()`: that
 * parses the string as UTC midnight and renders it in local time, so a member in
 * Lagos sees 28 Feb.
 */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * An instant, rendered in the library's timezone.
 *
 * Fixed to Africa/Nairobi rather than the viewer's zone: a due date is a fact
 * about the library, not about the browser that happens to display it.
 */
const INSTANT_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Africa/Nairobi',
});

export function formatInstant(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${INSTANT_FORMAT.format(parsed)} EAT`;
}

/** Whole days between today and a calendar date. Negative means overdue. */
export function daysUntil(value: string | null | undefined, today = new Date()): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const target = new Date(Number(year), Number(month) - 1, Number(day));
  // Midnight on both sides, so a partial day never rounds down to zero.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000);
}

/** `in 3 days`, `today`, `4 days overdue`. Used for due dates. */
export function formatRelativeDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return '1 day overdue';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days overdue`;
}

/** `Amina Otieno`, or a single name, or a dash when there is nobody. */
export function fullName(
  person: { firstName?: string | null; lastName?: string | null } | null,
): string {
  if (!person) return '—';
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  return name || '—';
}

/** `A. Otieno` for a table cell that must stay narrow. */
export function initials(
  person: { firstName?: string | null; lastName?: string | null } | null,
): string {
  if (!person) return '—';
  const first = person.firstName?.trim()?.[0] ?? '';
  const last = person.lastName?.trim()?.[0] ?? '';
  return `${first}${last}`.toUpperCase() || '—';
}
