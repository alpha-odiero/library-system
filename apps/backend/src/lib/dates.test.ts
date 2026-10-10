import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  addSeconds,
  calendarDaysBetween,
  isExpired,
  overdueDays,
  parseDurationToSeconds,
  startOfLibraryDay,
  toLibraryDate,
} from './dates.js';

/**
 * Due dates and fines are CALENDAR concepts. These tests pin the two failure
 * modes that produce off-by-one-day fines:
 *   • mixing UTC with a local timezone
 *   • letting the grace period shift a fine rather than exclude it
 *
 * The suite runs in Africa/Nairobi (UTC+3), so a 23:00 local instant is 20:00
 * UTC the same day — a boundary that catches naive implementations.
 */

describe('toLibraryDate', () => {
  it('renders the calendar date in the library timezone', () => {
    // 22:00 UTC on 1 Oct is 01:00 on 2 Oct in Nairobi (UTC+3).
    expect(toLibraryDate(new Date('2026-10-01T22:00:00Z'))).toBe('2026-10-02');
  });

  it('does not shift a date that is already midday local', () => {
    expect(toLibraryDate(new Date('2026-10-01T09:00:00Z'))).toBe('2026-10-01');
  });
});

describe('calendarDaysBetween', () => {
  it('counts calendar days, not elapsed hours', () => {
    // 23:59 local on the 1st to 00:01 local on the 2nd is ONE day overdue,
    // even though only two minutes elapsed.
    expect(calendarDaysBetween('2026-10-01', '2026-10-02')).toBe(1);
    expect(calendarDaysBetween('2026-10-01', '2026-10-01')).toBe(0);
    expect(calendarDaysBetween('2026-10-01', '2026-10-11')).toBe(10);
  });

  it('handles month and year boundaries', () => {
    expect(calendarDaysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(calendarDaysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(calendarDaysBetween('2026-02-27', '2026-03-01')).toBe(2); // 2026 is not a leap year
    expect(calendarDaysBetween('2024-02-28', '2024-03-01')).toBe(2); // 2024 is
  });

  it('returns a negative count when the range is inverted', () => {
    expect(calendarDaysBetween('2026-10-10', '2026-10-01')).toBe(-9);
  });

  it('crosses a daylight-saving boundary without drift', () => {
    // Northern-hemisphere zones shift in late March; the calendar arithmetic
    // must be immune because it works on dates, not on 86.4e5 ms multiples of
    // local time.
    expect(calendarDaysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(calendarDaysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('addCalendarDays', () => {
  it('adds whole days', () => {
    expect(
      calendarDaysBetween('2026-10-01', addCalendarDays(new Date('2026-10-01T09:00:00Z'), 14)),
    ).toBe(14);
  });

  it('rolls over month ends', () => {
    const result = addCalendarDays(new Date('2026-01-25T09:00:00Z'), 14);
    expect(toLibraryDate(result)).toBe('2026-02-08');
  });

  it('handles a leap day', () => {
    expect(toLibraryDate(addCalendarDays(new Date('2024-02-25T09:00:00Z'), 5))).toBe('2024-03-01');
  });

  it('accepts zero and rejects fractional days', () => {
    expect(() => addCalendarDays(new Date(), 0)).not.toThrow();
    expect(() => addCalendarDays(new Date(), 1.5)).toThrow(RangeError);
  });
});

describe('overdueDays', () => {
  const due = new Date('2026-10-01T12:00:00Z'); // due 15:00 local

  it('charges nothing on the due date itself', () => {
    expect(overdueDays(due, new Date('2026-10-01T20:00:00Z'), 0)).toBe(0);
  });

  it('charges one day the next calendar day', () => {
    expect(overdueDays(due, new Date('2026-10-02T09:00:00Z'), 0)).toBe(1);
  });

  it('counts elapsed calendar days, not 24-hour periods', () => {
    // One minute past the due time, but the same calendar day.
    expect(overdueDays(due, new Date('2026-10-01T15:01:00Z'), 0)).toBe(0);
  });

  it('excludes the grace period entirely rather than subtracting it', () => {
    // Grace of 3 days: nothing is owed on the 4th, even though the due date
    // has passed. Charging from day 1 and subtracting later would produce a
    // partially-waived fine record for a member who did nothing wrong.
    const grace = 3;
    expect(overdueDays(due, new Date('2026-10-03T12:00:00Z'), grace)).toBe(0); // 2 days past due
    expect(overdueDays(due, new Date('2026-10-04T12:00:00Z'), grace)).toBe(0); // 3 days past due
    expect(overdueDays(due, new Date('2026-10-05T12:00:00Z'), grace)).toBe(1); // first chargeable day
    expect(overdueDays(due, new Date('2026-10-08T12:00:00Z'), grace)).toBe(4);
  });

  it('never returns a negative count', () => {
    expect(overdueDays(due, new Date('2026-09-01T12:00:00Z'), 0)).toBe(0);
    expect(overdueDays(due, new Date('2026-09-01T12:00:00Z'), 7)).toBe(0);
  });
});

describe('startOfLibraryDay', () => {
  it('returns the instant at which the library day begins', () => {
    const start = startOfLibraryDay('2026-10-01');
    expect(start.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // 00:00 Nairobi
  });

  it('accepts a Date and yields the same boundary', () => {
    expect(startOfLibraryDay(new Date('2026-10-01T15:00:00Z')).toISOString()).toBe(
      startOfLibraryDay('2026-10-01').toISOString(),
    );
  });
});

describe('parseDurationToSeconds', () => {
  it('parses each unit', () => {
    expect(parseDurationToSeconds('15m')).toBe(900);
    expect(parseDurationToSeconds('2h')).toBe(7200);
    expect(parseDurationToSeconds('30d')).toBe(2_592_000);
    expect(parseDurationToSeconds('45s')).toBe(45);
  });

  it('rejects malformed input', () => {
    for (const bad of ['15', 'm', '15x', 'abc', '']) {
      expect(() => parseDurationToSeconds(bad)).toThrow(RangeError);
    }
  });
});

describe('addSeconds and isExpired', () => {
  it('adds seconds', () => {
    expect(addSeconds(new Date('2026-01-01T00:00:00Z'), 60).toISOString()).toBe(
      '2026-01-01T00:01:00.000Z',
    );
  });

  it('detects expiry, treating the boundary as expired', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(isExpired(new Date('2025-12-31T23:59:59Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-01-01T00:00:00Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-01-01T00:00:01Z'), now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
});
