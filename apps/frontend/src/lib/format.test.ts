import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  formatCalendarDate,
  formatCount,
  formatInstant,
  formatMoney,
  fullName,
} from './format';
import { fieldErrors } from './contracts';

/**
 * Formatting is where a correct API response becomes a wrong number on screen, so
 * the cases below are the ones that actually bite.
 */

describe('formatMoney', () => {
  it('keeps a decimal string exact', () => {
    // 0.1 + 0.2 !== 0.3. The value arrives as a string precisely so it is never
    // put through an addition before being displayed.
    expect(formatMoney('0.30')).toBe('KES 0.30');
    expect(formatMoney('1250')).toBe('KES 1,250.00');
    expect(formatMoney('1999.99')).toBe('KES 1,999.99');
  });

  it('renders a dash for no value rather than a zero', () => {
    // A missing fine cap is "no cap", not "KES 0.00" — a zero would read as a cap.
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('')).toBe('—');
  });

  it('refuses to silently misreport an amount it cannot parse', () => {
    expect(formatMoney('abc')).toBe('KES abc');
    expect(formatMoney('1.234')).toBe('KES 1.234');
  });
});

describe('formatCalendarDate', () => {
  it('renders a date of record without a timezone shift', () => {
    // `new Date('2026-03-01')` is UTC midnight, which is 28 Feb in any negative
    // offset. A member's birthday must not move.
    expect(formatCalendarDate('2026-03-01')).toBe('1 Mar 2026');
    expect(formatCalendarDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('passes a non-date through rather than showing NaN', () => {
    expect(formatCalendarDate('not a date')).toBe('not a date');
    expect(formatCalendarDate(null)).toBe('—');
  });
});

describe('daysUntil', () => {
  const today = new Date(2026, 2, 15); // 15 Mar 2026, local

  it('counts whole days in both directions', () => {
    expect(daysUntil('2026-03-15', today)).toBe(0);
    expect(daysUntil('2026-03-16', today)).toBe(1);
    expect(daysUntil('2026-03-14', today)).toBe(-1);
    expect(daysUntil('2026-04-14', today)).toBe(30);
  });

  it('is null when there is no date to count to', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('garbage')).toBeNull();
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('formatInstant', () => {
  it('renders a UTC instant in the library timezone and says so', () => {
    // 09:30 UTC is 12:30 EAT. Formatting in the viewer's zone instead would make
    // a due date mean different things in two branches of the same library.
    expect(formatInstant('2026-03-15T09:30:00.000Z')).toContain('12:30');
    expect(formatInstant('2026-03-15T09:30:00.000Z')).toContain('EAT');
  });

  it('passes an unparseable value through', () => {
    expect(formatInstant('later')).toBe('later');
  });
});

describe('fullName', () => {
  it('joins what exists and degrades gracefully', () => {
    expect(fullName({ firstName: 'Amina', lastName: 'Otieno' })).toBe('Amina Otieno');
    expect(fullName({ firstName: 'Amina', lastName: null })).toBe('Amina');
    expect(fullName({ firstName: null, lastName: null })).toBe('—');
    expect(fullName(null)).toBe('—');
  });
});

describe('fieldErrors', () => {
  it('maps a validation issue array to field messages', () => {
    expect(fieldErrors([{ path: 'email', message: 'Enter a valid email address' }])).toEqual({
      email: 'Enter a valid email address',
    });
  });

  it('keeps the first message when a field has several', () => {
    expect(
      fieldErrors([
        { path: 'password', message: 'Too short' },
        { path: 'password', message: 'Missing a symbol' },
      ]),
    ).toEqual({ password: 'Too short' });
  });

  it('buckets an issue with no path under the form', () => {
    expect(fieldErrors([{ message: 'Provide at least one field to update' }])).toEqual({
      form: 'Provide at least one field to update',
    });
  });

  it('reads the plain record shape some domain errors use', () => {
    expect(fieldErrors({ membershipNumber: 'Already in use' })).toEqual({
      membershipNumber: 'Already in use',
    });
  });

  it('is empty when there is nothing to report', () => {
    expect(fieldErrors(undefined)).toEqual({});
    expect(fieldErrors(null)).toEqual({});
    expect(fieldErrors('a string')).toEqual({});
  });
});
