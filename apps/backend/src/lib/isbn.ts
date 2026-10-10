/**
 * ISBN handling.
 *
 * A catalogue's whole value rests on being able to find the right book again.
 * Two mistakes make that impossible, and both come from accepting whatever the
 * client typed:
 *
 *   • Storing the same book twice under `978-0-13-110362-8` and `9780131103628`.
 *     Both are unique-index-clean, so the duplicate lands in the catalogue and the
 *     lookup splits.
 *   • Storing a mistyped digit. An ISBN is self-checking, which means a typo is
 *     detectable — but only if somebody actually checks. Rejecting is always
 *     better than storing a number that will never match a barcode.
 *
 * So: strip presentation, verify the checksum, and derive the other form from the
 * canonical one rather than trusting a client that supplies both.
 */

/** Presentation characters libraries print but do not mean: hyphens, spaces. */
const PRESENTATION = /[\s-]/g;

/** Upper-cases an ISBN and removes separators. */
export function normalizeIsbn(value: string): string {
  return value.replace(PRESENTATION, '').toUpperCase();
}

/**
 * ISBN-10 checksum.
 *
 * Weighted sum with weights 10..1, where the final character may be `X` for 10.
 * Valid when the sum is a multiple of 11.
 */
export function isValidIsbn10(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (isbn.length !== 10) return false;

  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const character = isbn[index] as string;
    // Position 9 is the only one allowed to be X, and only as 10.
    const digit = character === 'X' ? (index === 9 ? 10 : Number.NaN) : Number(character);
    if (Number.isNaN(digit)) return false;
    sum += digit * (10 - index);
  }

  return sum % 11 === 0;
}

/**
 * ISBN-13 checksum.
 *
 * Digits alternate weight 1 and 3 from the left; valid when the sum is a multiple
 * of 10.
 */
export function isValidIsbn13(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (isbn.length !== 13) return false;

  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    const character = isbn[index] as string;
    const digit = Number(character);
    if (!Number.isInteger(digit)) return false;
    sum += digit * (index % 2 === 0 ? 1 : 3);
  }

  return sum % 10 === 0;
}

/** The check digit an ISBN-13 needs for the first 12 given digits. */
export function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index] as string) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Converts an ISBN-10 to its ISBN-13.
 *
 * The Bookland prefix 978 goes in front and the check digit is recomputed.
 * Returns `null` for an input that is not a valid ISBN-10 — the conversion cannot
 * invent a correct result from a wrong one.
 */
export function isbn10To13(value: string): string | null {
  if (!isValidIsbn10(value)) return null;

  const core = `978${normalizeIsbn(value).slice(0, 9)}`;
  return `${core}${isbn13CheckDigit(core)}`;
}

/** Converts an ISBN-13 back to ISBN-10, when it is a 978-prefixed title. */
export function isbn13To10(value: string): string | null {
  const isbn = normalizeIsbn(value);
  if (!isValidIsbn13(isbn) || !isbn.startsWith('978')) return null;

  const core = isbn.slice(3, 12);
  // The tenth ISBN-10 digit is X for values that 11 would otherwise reach.
  const remainder =
    core.split('').reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;

  return check === 10 ? `${core}X` : `${core}${check}`;
}

/** The canonical ISBN-13 for either form, or `null` if the input is not valid. */
export function canonicalIsbn13(value: string): string | null {
  const isbn = normalizeIsbn(value);
  if (isValidIsbn13(isbn)) return isbn;
  if (isValidIsbn10(isbn)) return isbn10To13(isbn);
  return null;
}

/**
 * True when the two ISBNs identify the same title.
 *
 * A client may send `isbn10` and `isbn13` on the same record. If they disagree,
 * one of them is a typo — and silently keeping both would put two different
 * identifiers on one book, which is worse than refusing the write.
 */
export function isbnsAgree(isbn10?: string | null, isbn13?: string | null): boolean {
  if (!isbn10 && !isbn13) return true;
  if (!isbn10 || !isbn13) return true;

  const derived13 = canonicalIsbn13(isbn10);
  return derived13 !== null && derived13 === normalizeIsbn(isbn13);
}
