import { z } from 'zod';
import { ROLE_CODES } from '@lms/shared';
import { PASSWORD_POLICY } from '../../config/constants.js';

/**
 * Auth request schemas.
 *
 * Every schema is `.strict()`. Without it Zod silently DROPS unknown keys, which
 * means a request carrying `roleCode: 'ADMIN'` or `status: 'ACTIVE'` arrives at
 * the handler looking innocent rather than rejected. Failing loudly on an
 * unexpected field is what makes a mass-assignment attempt visible.
 *
 * Password STRENGTH is deliberately not enforced here. `validatePasswordStrength`
 * owns it, because the policy lives in one place and the failure has to be
 * returned as the standard field-issue shape. Re-implementing the rules as a Zod
 * regex would create a second definition that drifts.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  // Deliberately permissive: RFC 5322 allows forms no real mail provider issues.
  // An over-strict pattern here blocks legitimate addresses and teaches staff to
  // enter addresses that do not work.
  .email('Enter a valid email address');

/** The password field itself — any string; policy is checked by the service. */
const password = z.string().min(1).max(PASSWORD_POLICY.MAX_LENGTH);

export const loginSchema = z
  .object({
    email,
    password,
    /**
     * The account type chosen on the login screen's role selector.
     *
     * A UX hint, never an authority: the service compares it against the role the
     * account ACTUALLY holds, after the password has verified, and refuses the
     * sign-in on a mismatch. It is validated as an enum so a stray value fails as
     * a 400 at the edge instead of silently reaching (and being ignored by) the
     * comparison.
     */
    loginAs: z.enum(ROLE_CODES).optional(),
  })
  .strict();

export const registerSchema = z
  .object({
    email,
    password,
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z
      .string()
      .trim()
      .max(32)
      .optional()
      .transform((value) => value || null),
    /**
     * The tenant this new administrator will operate.
     *
     * Optional: when present the registration creates the library (and its
     * default branch) alongside the account, so a new library can onboard
     * itself. When absent the account is attached to the first active library,
     * which keeps existing API callers working unchanged.
     */
    libraryName: z.string().trim().min(2, 'Enter the name of your library').max(150).optional(),
  })
  .strict();

/**
 * The self-service profile edit — name and phone.
 *
 * Deliberately narrow. Email is the sign-in credential (changing it is a
 * verify-new-address flow of its own), and role, status, branch and library are
 * authorities no account may grant itself. `.strict()` is what turns an attempt
 * to smuggle `roleCode` past that rule into a 400 rather than a stripped field.
 *
 * At least one field must be present: an empty object is a write that changes
 * nothing but still costs an audit row.
 */
export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .trim()
      .max(32)
      // Empty means "no phone number", not "an empty string". The transform sits
      // INSIDE the optional so an absent key stays absent — otherwise omitting
      // `phone` from a name-only edit would quietly erase it.
      .transform((value) => value || null)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.firstName !== undefined || value.lastName !== undefined || value.phone !== undefined,
    { message: 'Provide at least one field to update' },
  );

export const forgotPasswordSchema = z
  .object({
    email,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10).max(200),
    newPassword: password,
  })
  .strict();

export const verifyEmailSchema = z
  .object({
    token: z.string().min(10).max(200),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: password,
    newPassword: password,
  })
  .strict()
  // A form that submits a confirmation field is common; requiring it here and
  // ignoring it in the service keeps the client contract honest without ever
  // trusting it as a substitute for the real password.
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });

export const refreshSchema = z
  .object({
    // The refresh credential normally arrives in a scoped cookie. It is accepted
    // in the body as well for non-browser clients, where a cookie jar does not
    // exist. Both paths feed the identical rotation logic.
    refreshToken: z.string().min(20).max(400).optional(),
  })
  .strict();

export type LoginBody = z.infer<typeof loginSchema>;
export type RegisterBody = z.infer<typeof registerSchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailBody = z.infer<typeof verifyEmailSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
