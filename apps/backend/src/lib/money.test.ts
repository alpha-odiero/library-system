import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  assertNonNegativeAmount,
  assertPositiveAmount,
  compareMoney,
  isNegativeMoney,
  isZeroMoney,
  maxMoney,
  minMoney,
  money,
  moneyFromInput,
  multiplyMoneyByDays,
  subtractMoney,
  sumMoney,
  toMoneyString,
  zero,
} from './money.js';
import { AppError } from './errors.js';

/**
 * Money is the highest-consequence area in this system: a rounding error here
 * is a financial defect, and a float here corrupts silently. These tests treat
 * exactness as the specification.
 */

describe('moneyFromInput', () => {
  it('accepts decimal strings and preserves both decimal places', () => {
    expect(toMoneyString(moneyFromInput('200.50'))).toBe('200.50');
    expect(toMoneyString(moneyFromInput('0.01'))).toBe('0.01');
    expect(toMoneyString(moneyFromInput('1000'))).toBe('1000.00');
  });

  it('accepts numbers without routing through float arithmetic', () => {
    expect(toMoneyString(moneyFromInput(200.1))).toBe('200.10');
    expect(toMoneyString(moneyFromInput(0.07))).toBe('0.07');
  });

  it('trims surrounding whitespace', () => {
    expect(toMoneyString(moneyFromInput('  99.99  '))).toBe('99.99');
  });

  it('rejects more than two decimal places', () => {
    // Silently rounding here would lose money without telling anyone.
    expect(() => moneyFromInput('10.005')).toThrow(AppError);
    expect(() => moneyFromInput('10.999')).toThrow(/decimal places/);
  });

  it('rejects non-numeric and non-finite input', () => {
    for (const bad of [
      '',
      'abc',
      '12abc',
      '1,000.00',
      '1e5',
      '$5',
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => moneyFromInput(bad), `expected "${String(bad)}" to be rejected`).toThrow(
        AppError,
      );
    }
  });

  it('rejects non-string non-number types', () => {
    expect(() => moneyFromInput(null)).toThrow(AppError);
    expect(() => moneyFromInput({})).toThrow(AppError);
    expect(() => moneyFromInput([])).toThrow(AppError);
    expect(() => moneyFromInput(true)).toThrow(AppError);
  });

  it('handles negatives (needed for ledger adjustments)', () => {
    expect(toMoneyString(moneyFromInput('-50.25'))).toBe('-50.25');
  });

  it('is idempotent for an existing Decimal', () => {
    const once = moneyFromInput('42.42');
    expect(moneyFromInput(once).toString()).toBe(once.toString());
  });
});

describe('arithmetic exactness', () => {
  it('adds without losing precision on large sums', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. This is the whole reason
    // money never touches `number`.
    const total = addMoney('0.10', '0.20');
    expect(toMoneyString(total)).toBe('0.30');
    expect(toMoneyString(total)).not.toBe('0.3');
  });

  it('survives a hundred one-cent additions', () => {
    let total = zero();
    for (let i = 0; i < 100; i += 1) total = total.plus(new Prisma.Decimal('0.01'));
    expect(toMoneyString(total)).toBe('1.00');
  });

  it('subtracts exactly', () => {
    expect(toMoneyString(subtractMoney('500.00', '200.00'))).toBe('300.00');
    expect(toMoneyString(subtractMoney('500.00', '500.00'))).toBe('0.00');
  });

  it('multiplies a daily rate by whole days for fine calculation', () => {
    expect(toMoneyString(multiplyMoneyByDays('50.00', 7))).toBe('350.00');
    expect(toMoneyString(multiplyMoneyByDays('33.33', 3))).toBe('99.99');
    expect(toMoneyString(multiplyMoneyByDays('50.00', 0))).toBe('0.00');
  });

  it('rejects fractional day counts — fines are charged per whole day', () => {
    expect(() => multiplyMoneyByDays('50.00', 1.5)).toThrow(AppError);
    expect(() => multiplyMoneyByDays('50.00', -1)).toThrow(AppError);
  });

  it('sums a collection', () => {
    expect(toMoneyString(sumMoney(['100.10', '200.20', '0.70']))).toBe('301.00');
    expect(toMoneyString(sumMoney([]))).toBe('0.00');
  });
});

describe('comparison helpers', () => {
  it('compares', () => {
    expect(compareMoney('100.00', '100.00')).toBe(0);
    expect(compareMoney('99.99', '100.00')).toBe(-1);
    expect(compareMoney('100.01', '100.00')).toBe(1);
  });

  it('detects zero and negative', () => {
    expect(isZeroMoney('0.00')).toBe(true);
    expect(isZeroMoney('0.01')).toBe(false);
    expect(isNegativeMoney('-0.01')).toBe(true);
    expect(isNegativeMoney('0.00')).toBe(false);
  });

  it('selects min and max — used for fine caps', () => {
    expect(toMoneyString(minMoney('500.00', '300.00'))).toBe('300.00');
    expect(toMoneyString(maxMoney('500.00', '300.00'))).toBe('500.00');
  });
});

describe('assertions', () => {
  it('requires a strictly positive payment', () => {
    expect(() => assertPositiveAmount(zero())).toThrow(/greater than zero/);
    expect(() => assertPositiveAmount(moneyFromInput('-1.00'))).toThrow(/greater than zero/);
    expect(toMoneyString(assertPositiveAmount(moneyFromInput('0.01')))).toBe('0.01');
  });

  it('permits zero for a fine but rejects negative', () => {
    expect(toMoneyString(assertNonNegativeAmount(zero()))).toBe('0.00');
    expect(() => assertNonNegativeAmount(moneyFromInput('-0.01'))).toThrow(/cannot be negative/);
  });

  it('rejects amounts beyond the structural ceiling', () => {
    expect(() => assertPositiveAmount(moneyFromInput('1000000000.00'))).toThrow(/maximum/);
  });
});

describe('serialisation', () => {
  it('always emits exactly two decimal places', () => {
    expect(toMoneyString('5')).toBe('5.00');
    expect(toMoneyString('5.1')).toBe('5.10');
    expect(toMoneyString('5.005')).toBe('5.01'); // Prisma's own rounding, applied once
  });

  it('emits a string, never a number — a JSON number cannot hold 0.01 exactly', () => {
    const serialised = toMoneyString('0.07');
    expect(typeof serialised).toBe('string');
    // Proof that the alternative is lossy at this magnitude:
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });
});

describe('money()', () => {
  it('passes a Decimal through unchanged', () => {
    const decimal = new Prisma.Decimal('10.00');
    expect(money(decimal).equals(decimal)).toBe(true);
  });

  it('converts strings and numbers', () => {
    expect(toMoneyString(money('7.77'))).toBe('7.77');
  });
});
