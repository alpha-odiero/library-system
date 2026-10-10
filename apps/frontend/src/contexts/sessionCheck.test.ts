import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../lib/api';
import { classifySessionCheck } from './sessionCheck';

/**
 * The rule under test: a 401 is the only answer that may end a session.
 *
 * These cases pin the regression that made an unreachable API look exactly like a
 * wrong password. A caller that cleared the session on every failure produced a
 * login prompt while the user's cookie was still valid, which was reported as
 * "admin and librarian cannot log in" when all three roles were authenticating
 * correctly the whole time.
 */

function envelope(message: string) {
  return {
    success: false as const,
    error: { code: 'FORBIDDEN', message },
  };
}

describe('classifySessionCheck', () => {
  it('treats 401 as a genuine signed-out state', () => {
    expect(classifySessionCheck(new ApiError(envelope('Unauthorized'), 401))).toEqual({
      outcome: 'anonymous',
    });
  });

  it('does not sign the user out when the API is unreachable', () => {
    const result = classifySessionCheck(new NetworkError('Failed to fetch'));

    expect(result.outcome).toBe('unreachable');
    if (result.outcome === 'unreachable') {
      expect(result.reason).toMatch(/Cannot reach the server/);
    }
  });

  it('does not sign the user out on a server error', () => {
    // A 500 says nothing about the session. Clearing it here is the original bug.
    expect(classifySessionCheck(new ApiError(envelope('Boom'), 500)).outcome).toBe('unreachable');
  });

  it('does not sign the user out on a permission error', () => {
    // 403 would mean "signed in but not allowed". Reporting that as signed-out would
    // log staff out for the wrong reason.
    expect(classifySessionCheck(new ApiError(envelope('Forbidden'), 403)).outcome).toBe(
      'unreachable',
    );
  });

  it('surfaces the server message for an unexplained failure', () => {
    const result = classifySessionCheck(new ApiError(envelope('Rate limited'), 429));
    if (result.outcome === 'unreachable') expect(result.reason).toContain('Rate limited');
  });

  it('does not throw on an unrecognised error shape', () => {
    expect(classifySessionCheck('something odd').outcome).toBe('unreachable');
  });

  it('always carries a human-readable reason when unreachable', () => {
    const cases = [
      new NetworkError('Failed to fetch'),
      new ApiError(envelope('Internal error'), 500),
      null,
      undefined,
    ];

    for (const error of cases) {
      const result = classifySessionCheck(error);
      if (result.outcome !== 'unreachable') continue;
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
