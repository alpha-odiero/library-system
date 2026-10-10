import { Prisma } from '@prisma/client';
import { LIMITS } from '../config/constants.js';
import { invalidOperation } from './errors.js';

/**
 * Money handling.
 *
 * Rules, without exception:
 *   • Values are Prisma.Decimal or integer minor units internally.
 *   • They cross the wire as decimal STRINGS. A JSON number is an IEEE-754
 *     double and cannot represent 0.01; sending money as a number silently
 *     corrupts currency values on the client and in the database.
 *   • No arithmetic is ever performed on `number`.
 *
 * `number` is accepted at the validation boundary (a JSON body may send
 * `200.50`) and converted immediately via `moneyFromInput`, which routes
 * through a string so no intermediate float is created.
 */

export const MONEY_SCALE = 2;
export const ZERO = new Prisma.Decimal(0);

export type Money = Prisma.Decimal;

export function money(value: Prisma.Decimal | string | number): Money {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function zero(): Money {
  return new Prisma.Decimal(0);
}

/**
 * Coerces untrusted input into a Decimal without passing through a float.
 *
 * Accepts `"200.50"`, `200.5`, `"  200.50 "`. Rejects `NaN`, `Infinity`,
 * scientific notation that loses precision, and anything with more than two
 * decimal places.
 */
export function moneyFromInput(input: unknown, field = 'amount'): Money {
  if (input instanceof Prisma.Decimal) return input;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw invalidOperation('PAYMENT_INVALID', `${field} must be a finite amount`);
    }
    // Route through a string: `200.10` → "200.1" keeps the value exact.
    return moneyFromInput(input.toString(), field);
  }

  if (typeof input !== 'string') {
    throw invalidOperation('PAYMENT_INVALID', `${field} must be a decimal string or number`);
  }

  const normalised = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) {
    throw invalidOperation('PAYMENT_INVALID', `${field} must be a plain decimal amount`);
  }

  const [whole = '0', fraction = ''] = normalised.replace('-', '').split('.');
  if (fraction.length > MONEY_SCALE) {
    throw invalidOperation(
      'PAYMENT_INVALID',
      `${field} must not have more than ${MONEY_SCALE} decimal places`,
    );
  }

  const sign = normalised.startsWith('-') ? '-' : '';
  const value = new Prisma.Decimal(`${sign}${whole}.${fraction.padEnd(MONEY_SCALE, '0')}`);

  if (!value.isFinite()) {
    throw invalidOperation('PAYMENT_INVALID', `${field} must be a finite amount`);
  }

  return value;
}

export function addMoney(a: Money | string | number, b: Money | string | number): Money {
  return money(a).plus(money(b));
}

export function subtractMoney(a: Money | string | number, b: Money | string | number): Money {
  return money(a).minus(money(b));
}

/**
 * Multiplies by a whole number only.
 *
 * A fractional multiplier would silently introduce sub-cent precision that the
 * schema's 2-decimal scale cannot represent, so it is rejected rather than
 * rounded.
 */
export function multiplyMoney(a: Money | string | number, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw invalidOperation('PAYMENT_INVALID', 'Money may only be multiplied by a whole number');
  }
  return money(a).times(factor);
}

/** `days × rate`, where rate is per-day and days is a whole number. */
export function multiplyMoneyByDays(ratePerDay: Money | string | number, days: number): Money {
  if (!Number.isInteger(days) || days < 0) {
    throw invalidOperation('PAYMENT_INVALID', 'Days must be a non-negative whole number');
  }
  return money(ratePerDay).times(days);
}

export function isZeroMoney(value: Money | string | number): boolean {
  return money(value).isZero();
}

export function isNegativeMoney(value: Money | string | number): boolean {
  return money(value).isNegative();
}

export function compareMoney(a: Money | string | number, b: Money | string | number): -1 | 0 | 1 {
  return money(a).cmp(money(b)) as -1 | 0 | 1;
}

export function minMoney(a: Money | string | number, b: Money | string | number): Money {
  return money(a).lt(money(b)) ? money(a) : money(b);
}

export function maxMoney(a: Money | string | number, b: Money | string | number): Money {
  return money(a).gt(money(b)) ? money(a) : money(b);
}

/** Enforces a positive amount within the structural ceiling. */
export function assertPositiveAmount(value: Money, field = 'amount'): Money {
  if (value.lte(0)) {
    throw invalidOperation('PAYMENT_INVALID', `${field} must be greater than zero`);
  }
  if (value.abs().gt(LIMITS.MAX_PAYMENT_AMOUNT)) {
    throw invalidOperation('PAYMENT_INVALID', `${field} exceeds the maximum permitted amount`);
  }
  return value;
}

/** Enforces a non-negative amount within the structural ceiling. */
export function assertNonNegativeAmount(value: Money, field = 'amount'): Money {
  if (value.isNegative()) {
    throw invalidOperation('PAYMENT_INVALID', `${field} cannot be negative`);
  }
  if (value.abs().gt(LIMITS.MAX_FINE_AMOUNT)) {
    throw invalidOperation('PAYMENT_INVALID', `${field} exceeds the maximum permitted amount`);
  }
  return value;
}

/**
 * Serialises for transport. Always a fixed-2dp string — `100.00`, never `100`
 * or `1e+2` — so clients can display and re-parse without assumptions.
 */
export function toMoneyString(value: Money | string | number): string {
  return money(value).toFixed(MONEY_SCALE);
}

export function sumMoney(values: readonly (Money | string | number)[]): Money {
  return values.reduce<Money>((total, value) => total.plus(money(value)), zero());
}
