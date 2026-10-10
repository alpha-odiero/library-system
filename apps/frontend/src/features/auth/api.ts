import type { RoleCode } from '@lms/shared';
import { api, resetCsrfToken } from '../../lib/api';
import type { MeResponse, LoginResult, RegisterResult } from '../../lib/contracts';

/**
 * Auth endpoints, typed.
 *
 * Every call here sends no CSRF header of its own — the API client attaches the
 * cookie value on any unsafe method — and none of them are retried after a
 * refresh, because a 401 from these endpoints means the credential was rejected.
 */

/**
 * `loginAs` is the account type picked on the login screen's selector. It is a
 * hint the server CHECKS against the account's real role — a mismatch is a 422
 * with a message naming the right one — never something the server believes.
 * Omitted (`undefined`) it drops out of the JSON body entirely, which is what
 * non-browser callers and a selector at rest both send.
 */
export function login(email: string, password: string, loginAs?: RoleCode) {
  return api.post<LoginResult>('/auth/login', { email, password, loginAs });
}

export function register(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  /** The tenant to create alongside the administrator account. */
  libraryName?: string;
}) {
  return api.post<RegisterResult>('/auth/register', input);
}

export async function logout() {
  // The server clears the CSRF cookie on the way out, so the cached,
  // body-supplied token must be dropped with it or the next write would present
  // a value the server no longer has a cookie to match.
  try {
    return await api.post<void>('/auth/logout', {});
  } finally {
    resetCsrfToken();
  }
}

/** Revokes every session for the account, including this one. */
export async function logoutAll() {
  try {
    return await api.post<void>('/auth/logout-all', {});
  } finally {
    resetCsrfToken();
  }
}

export function me() {
  return api.get<MeResponse>('/auth/me');
}

export function forgotPassword(email: string) {
  return api.post<void>('/auth/forgot-password', { email });
}

export function resetPassword(token: string, newPassword: string) {
  return api.post<void>('/auth/reset-password', { token, newPassword });
}

export function verifyEmail(token: string) {
  return api.post<void>('/auth/verify-email', { token });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api.post<void>('/auth/change-password', { currentPassword, newPassword });
}

export interface OwnProfile {
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
}

/**
 * `PATCH /auth/me` — the account holder's own name and phone.
 *
 * The server fixes which fields are writable; anything else in this object is
 * rejected by a strict schema rather than stripped, so a typo here is a 400 and
 * not a silently dropped edit.
 */
export function updateProfile(patch: ProfilePatch) {
  return api.patch<OwnProfile>('/auth/me', patch);
}

export interface SessionSummary {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  issuedAt: string;
  lastUsedAt: string;
}

export function listSessions() {
  return api.get<{ sessions: SessionSummary[] }>('/auth/sessions');
}

export function revokeSession(sessionId: string) {
  return api.delete<void>(`/auth/sessions/${sessionId}`);
}
