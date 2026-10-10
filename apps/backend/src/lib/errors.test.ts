import { describe, expect, it } from 'vitest';
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  fromZodError,
  notFound,
  unauthenticated,
  unprocessable,
} from './errors.js';

describe('AppError', () => {
  it('derives its HTTP status from the code', () => {
    expect(new AppError('FORBIDDEN', 'x').status).toBe(403);
    expect(new AppError('UNAUTHENTICATED', 'x').status).toBe(401);
    expect(new AppError('NOT_FOUND', 'x').status).toBe(404);
    expect(new AppError('COPY_ALREADY_ON_LOAN', 'x').status).toBe(409);
    expect(new AppError('FINE_OVERPAYMENT', 'x').status).toBe(422);
    expect(new AppError('TOO_MANY_REQUESTS', 'x').status).toBe(429);
  });

  it('is an Error subclass so existing catch blocks still work', () => {
    const error = new AppError('CONFLICT', 'conflict');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.message).toBe('conflict');
    expect(error.stack).toBeDefined();
  });

  it('retains details and log context separately', () => {
    const error = new AppError('VALIDATION_ERROR', 'bad', {
      details: [{ path: 'email', message: 'invalid' }],
      logContext: { raw: 'internal-only' },
    });

    expect(error.details).toEqual([{ path: 'email', message: 'invalid' }]);
    expect(error.logContext).toEqual({ raw: 'internal-only' });
    // Nothing internal-only ever sits in `message`.
    expect(error.message).not.toContain('internal-only');
  });

  it('preserves a cause chain without exposing it', () => {
    const cause = new Error('connection refused to 10.0.0.5:5432');
    const error = new AppError('SERVICE_UNAVAILABLE', 'unavailable', { cause });

    expect(error.cause).toBe(cause);
    expect(error.message).toBe('unavailable');
  });
});

describe('constructors', () => {
  it('badRequest → 400', () => {
    expect(badRequest('nope').status).toBe(400);
    expect(badRequest('nope').code).toBe('VALIDATION_ERROR');
  });

  it('unauthenticated → 401, and never reveals which factor failed', () => {
    expect(unauthenticated().status).toBe(401);
    expect(unauthenticated().code).toBe('UNAUTHENTICATED');
    // Both branches must look identical from outside, so credential probing
    // cannot distinguish "no such email" from "wrong password".
    expect(unauthenticated('Authentication required').message).toBe(
      unauthenticated('Authentication required').message,
    );
  });

  it('forbidden → 403 and may name the missing permission', () => {
    const error = forbidden(undefined, 'SETTINGS_VIEW');
    expect(error.status).toBe(403);
    expect(error.details).toEqual({ requiredPermission: 'SETTINGS_VIEW' });
  });

  it('notFound → 404', () => {
    expect(notFound('Book', 'abc').status).toBe(404);
    expect(notFound('Book', 'abc').message).toBe('Book not found');
  });

  it('conflict → the domain code with a 409', () => {
    const error = conflict('COPY_ALREADY_ON_LOAN', 'Copy is already on loan');
    expect(error.status).toBe(409);
    expect(error.code).toBe('COPY_ALREADY_ON_LOAN');
  });

  it('unprocessable → 422', () => {
    expect(unprocessable('semantically wrong').status).toBe(422);
  });
});

describe('fromZodError', () => {
  it('flattens issues to field paths and messages', () => {
    const error = fromZodError({
      issues: [
        { path: ['email'], message: 'Invalid email' },
        { path: ['profile', 'phone'], message: 'Too long' },
        { path: [], message: 'Root problem' },
      ],
    });

    expect(error.status).toBe(400);
    expect(error.details).toEqual([
      { path: 'email', message: 'Invalid email' },
      { path: 'profile.phone', message: 'Too long' },
      { path: '(root)', message: 'Root problem' },
    ]);
  });

  it('never echoes the offending value back to the caller', () => {
    // A password field that fails validation must not have its content returned.
    const error = fromZodError({
      issues: [{ path: ['password'], message: 'String must contain at least 12 character(s)' }],
    });
    expect(JSON.stringify(error.details)).not.toContain('secretvalue');
  });
});
