import { describe, expect, it } from 'vitest';
import {
  canonicalIsbn13,
  isValidIsbn10,
  isValidIsbn13,
  isbnsAgree,
  isbn10To13,
  isbn13CheckDigit,
  isbn13To10,
  normalizeIsbn,
} from './isbn.js';

/**
 * ISBN tests.
 *
 * The property under test throughout is that a wrong digit cannot survive:
 * either the number checks out or the catalogue refuses it. Pure arithmetic, no
 * database.
 */

describe('normalisation', () => {
  it('strips the hyphens a library would print', () => {
    expect(normalizeIsbn('978-0-13-110362-7')).toBe('9780131103627');
  });

  it('strips spaces and upper-cases the X check digit', () => {
    expect(normalizeIsbn(' 0 8044 2957 x ')).toBe('080442957X');
  });
});

describe('ISBN-10', () => {
  it('accepts a real number', () => {
    expect(isValidIsbn10('0-8044-2957-X')).toBe(true);
  });

  it('accepts the one whose check digit is X', () => {
    // The X is what makes this famous; without the special case every such
    // number would be rejected.
    expect(isValidIsbn10('080442957X')).toBe(true);
  });

  it('rejects a mistyped digit in the middle', () => {
    expect(isValidIsbn10('080442957X'.replace('4', '5'))).toBe(false);
  });

  it('rejects a mistyped check digit', () => {
    expect(isValidIsbn10('0804429571')).toBe(false);
  });

  it('rejects X anywhere but the last position', () => {
    expect(isValidIsbn10('0X0442957X')).toBe(false);
  });

  it('rejects a letter', () => {
    expect(isValidIsbn10('080442957A')).toBe(false);
  });

  it('rejects an 11-character number', () => {
    expect(isValidIsbn10('080442957XX')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidIsbn10('')).toBe(false);
  });
});

describe('ISBN-13', () => {
  it('accepts a real number', () => {
    expect(isValidIsbn13('978-0-13-110362-7')).toBe(true);
  });

  it('rejects a number whose check digit is off by one', () => {
    // The printed check digit is the last digit, and it is the one most often
    // transcribed wrong. 8 is exactly one digit from the correct 7.
    expect(isValidIsbn13('9780131103628')).toBe(false);
  });

  it('rejects a single mistyped digit', () => {
    expect(isValidIsbn13('9780131103629')).toBe(false);
  });

  it('rejects a 10-character number', () => {
    expect(isValidIsbn13('080442957X')).toBe(false);
  });

  it('rejects a non-digit', () => {
    expect(isValidIsbn13('978013110362X')).toBe(false);
  });

  it('computes the check digit that makes a prefix valid', () => {
    const prefix = '978013110362';
    const withDigit = `${prefix}${isbn13CheckDigit(prefix)}`;

    expect(isValidIsbn13(withDigit)).toBe(true);
  });
});

describe('conversion', () => {
  it('converts ISBN-10 to ISBN-13', () => {
    expect(isbn10To13('080442957X')).toBe('9780804429573');
  });

  it('refuses to convert an invalid ISBN-10', () => {
    // Guessing a check digit for a mistyped number would produce a plausible
    // identifier that matches nothing in any registry.
    expect(isbn10To13('0804429571')).toBeNull();
  });

  it('round-trips back to the original ISBN-10', () => {
    expect(isbn13To10(isbn10To13('080442957X') as string)).toBe('080442957X');
  });

  it('round-trips a number with a numeric check digit', () => {
    const original = '0306406152';
    expect(isbn13To10(isbn10To13(original) as string)).toBe(original);
  });

  it('cannot represent an ISBN-13 outside the 978 Bookland prefix', () => {
    // 979 titles exist and have no ISBN-10 form at all.
    expect(isbn13To10('9791234567896')).toBeNull();
  });
});

describe('canonicalIsbn13', () => {
  it('normalises an ISBN-13 to its digit form', () => {
    expect(canonicalIsbn13('978-0-13-110362-7')).toBe('9780131103627');
  });

  it('upgrades an ISBN-10', () => {
    expect(canonicalIsbn13('0-8044-2957-X')).toBe('9780804429573');
  });

  it('returns null rather than repairing a bad checksum', () => {
    expect(canonicalIsbn13('978-0-13-110362-8')).toBeNull();
  });
});

describe('agreement between the two forms', () => {
  it('accepts a matching pair', () => {
    expect(isbnsAgree('080442957X', '9780804429573')).toBe(true);
  });

  it('accepts a pair supplied only in one form', () => {
    expect(isbnsAgree('080442957X', null)).toBe(true);
    expect(isbnsAgree(null, '9780804429573')).toBe(true);
    expect(isbnsAgree(null, null)).toBe(true);
  });

  it('rejects a pair that disagrees, which means one is a typo', () => {
    // Storing both anyway would give one book two identifiers and break every
    // lookup that used the wrong one.
    expect(isbnsAgree('080442957X', '9780131103628')).toBe(false);
  });

  it('rejects a pair where the ISBN-10 is itself invalid', () => {
    expect(isbnsAgree('0804429571', '9780804429573')).toBe(false);
  });
});
