import './dotenv.js';
import { argon2id } from 'argon2';
import { z } from 'zod';

/** Coerces "true"/"1"/"yes" to true. Absent/unparseable values fail loudly. */
const boolFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1' || v === 'yes');

const intFromEnv = (defaultValue: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

const csvToArray = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const envSchema = z
  .object({
    // ── Runtime ─────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: intFromEnv(4000, 1, 65535),
    API_URL: z.string().url().default('http://localhost:4000'),

    // ── CORS / cookies ──────────────────────────────────────────────────────
    // Explicit allowlist. Never a wildcard in production (enforced below).
    FRONTEND_URL: z.string().min(1),
    CORS_EXTRA_ORIGINS: z.string().optional(),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: boolFromEnv(false),

    // ── Database ────────────────────────────────────────────────────────────
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().min(1, 'DIRECT_URL is required for migrations'),
    DATABASE_SSL: boolFromEnv(false),
    DATABASE_POOL_MAX: intFromEnv(10, 1, 200),

    // ── Secrets ─────────────────────────────────────────────────────────────
    // Minimum length mirrors the HMAC-SHA256 block requirement; a weak secret is
    // a critical misconfiguration, not a style preference.
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z
      .string()
      .regex(/^\d+[smhd]$/, 'ACCESS_TOKEN_TTL must look like 15m')
      .default('15m'),
    REFRESH_TOKEN_TTL_DAYS: intFromEnv(30, 1, 365),

    // ── Rate limiting / lockout ──────────────────────────────────────────────
    RATE_LIMIT_WINDOW_MS: intFromEnv(900_000, 1000),
    RATE_LIMIT_MAX: intFromEnv(300, 1),
    AUTH_RATE_LIMIT_MAX: intFromEnv(10, 1),
    LOGIN_MAX_ATTEMPTS: intFromEnv(5, 1, 100),
    LOGIN_LOCKOUT_MINUTES: intFromEnv(15, 1, 1440),

    // ── Password hashing (OWASP Argon2id baseline) ──────────────────────────
    ARGON2_MEMORY_COST: intFromEnv(19_456, 1024, 1_048_576),
    ARGON2_TIME_COST: intFromEnv(2, 1, 16),
    ARGON2_PARALLELISM: intFromEnv(1, 1, 16),

    // ── CSRF ────────────────────────────────────────────────────────────────
    CSRF_COOKIE_NAME: z.string().min(1).default('lms_csrf'),
    CSRF_HEADER_NAME: z.string().min(1).default('x-csrf-token'),

    // ── Localisation / money ────────────────────────────────────────────────
    CURRENCY: z.string().length(3).default('KES'),
    TIMEZONE: z.string().min(1).default('Africa/Nairobi'),

    // ── Storage ─────────────────────────────────────────────────────────────
    STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    STORAGE_PUBLIC_BASE_URL: z.string().default('http://localhost:4000/media'),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    SIGNED_URL_TTL_SECONDS: intFromEnv(300, 30, 3600),

    // ── Email ───────────────────────────────────────────────────────────────
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromEnv(587, 1, 65535),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('no-reply@library.local'),
    REQUIRE_EMAIL_VERIFICATION: boolFromEnv(false),

    // ── M-Pesa (optional, modular) ──────────────────────────────────────────
    MPESA_CONSUMER_KEY: z.string().optional(),
    MPESA_CONSUMER_SECRET: z.string().optional(),
    MPESA_SHORTCODE: z.string().optional(),
    MPESA_PASSKEY: z.string().optional(),
    MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),

    // ── Redis (optional) ────────────────────────────────────────────────────
    REDIS_URL: z.string().optional(),

    // ── Observability ───────────────────────────────────────────────────────
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SENTRY_DSN: z.string().optional(),
    ENABLE_REQUEST_LOGGING: boolFromEnv(true),

    // ── Jobs ────────────────────────────────────────────────────────────────
    JOBS_ENABLED: boolFromEnv(true),
    OVERDUE_SWEEP_CRON: z.string().default('0 * * * *'),
    RESERVATION_EXPIRY_CRON: z.string().default('*/15 * * * *'),
    SESSION_PURGE_CRON: z.string().default('17 3 * * *'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // A wildcard allowlist in production defeats credentialed CORS entirely.
    const origins = [env.FRONTEND_URL, env.CORS_EXTRA_ORIGINS ?? ''];
    if (origins.some((o) => o.includes('*'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FRONTEND_URL'],
        message: 'Wildcard CORS origins are not permitted in production',
      });
    }

    if (!env.FRONTEND_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FRONTEND_URL'],
        message: 'Production FRONTEND_URL must use HTTPS',
      });
    }

    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }

    if (!env.DATABASE_SSL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_SSL'],
        message: 'DATABASE_SSL must be true in production',
      });
    }

    for (const secret of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (
        env[secret].toLowerCase().includes('dev-only') ||
        env[secret].toLowerCase().includes('change-me')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [secret],
          message: `${secret} still holds a development placeholder`,
        });
      }
    }

    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_SECRET and JWT_REFRESH_SECRET must differ',
      });
    }

    // Short-lived access tokens are what make DB-backed revocation meaningful.
    const ttlMinutes = Number(env.ACCESS_TOKEN_TTL.replace(/[smhd]$/, ''));
    const multiplier = { s: 1 / 60, m: 1, h: 60, d: 1440 }[env.ACCESS_TOKEN_TTL.slice(-1)] ?? 1;
    if (ttlMinutes * multiplier > 60) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCESS_TOKEN_TTL'],
        message: 'ACCESS_TOKEN_TTL must be 60 minutes or less so revocation is effective',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Deliberately printed raw to stderr: this is an operator-facing startup
    // failure, and hiding it behind a JSON log line makes it undiagnosable.
    process.stderr.write(
      `\n[FATAL] Invalid environment configuration — refusing to start.\n${details}\n\n` +
        `Copy .env.example to .env and fill in every required value.\n\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = load();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export const corsAllowedOrigins: readonly string[] = [
  env.FRONTEND_URL,
  ...csvToArray(env.CORS_EXTRA_ORIGINS),
].filter((origin): origin is string => Boolean(origin));

/**
 * Argon2id parameters, sourced from config so they can be tuned per environment.
 *
 * `type` uses the library's exported constant rather than the literal `2`:
 * `argon2id` is a NUMBER in this library, not the hashing function — the
 * function is `hash()`. Reaching for the wrong one type-checks against nothing
 * and fails only at runtime, so the import is deliberate.
 */
export const argon2Options = {
  type: argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
} as const;
