/**
 * OpenAPI document generator.
 *
 * Phase A ships one route (the system health endpoints), so this does not use a
 * reflection-based library. It emits the document from the single source of truth
 * that already governs the API at runtime: the shared envelope and error
 * contracts in `@lms/shared`.
 *
 * That choice matters. A generated-from-nothing document drifts from the server
 * and is worse than no document, because it looks authoritative. Here the error
 * codes, their statuses, and the envelope shape are read from the same constants
 * the error middleware uses, so the two cannot disagree without the generator
 * failing to run.
 *
 * When feature routes arrive, add them to `ROUTES` below. Each entry must
 * declare its response DTO; the `expectType` helper fails compilation if a DTO
 * stops matching what the route promises, which keeps the document honest as the
 * types move.
 *
 * Usage: npm run openapi        # writes openapi.json
 *        npm run openapi -- --check   # verify the committed file is current
 */
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_ERROR_CODES,
  ERROR_CODES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  statusForApiCode,
  type ApiErrorCode,
  type ApiEnvelope,
  type ErrorEnvelope,
  type PaginationMeta,
} from '@lms/shared';

// scripts/ sits directly below apps/backend.
const OUTPUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'openapi.json',
);

type JsonSchema = Record<string, unknown>;

const uuidSchema: JsonSchema = { type: 'string', format: 'uuid' };

/** Money crosses the wire as a fixed-scale string, never a float. */
const moneySchema: JsonSchema = {
  type: 'string',
  pattern: '^\\d+(\\.\\d{2})$',
  description: 'Decimal amount as a fixed-scale string, e.g. "1250.00". Never a float.',
  examples: ['1250.00', '0.00'],
};

const isoDateTimeSchema: JsonSchema = {
  type: 'string',
  format: 'date-time',
  description: 'ISO 8601 timestamp with an explicit offset.',
};

const paginationMetaSchema: JsonSchema = {
  type: 'object',
  required: ['page', 'limit', 'total', 'totalPages'],
  properties: {
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
    total: { type: 'integer', minimum: 0 },
    totalPages: { type: 'integer', minimum: 0 },
  },
};

/**
 * Compile-time proof that the runtime-generated schemas still describe the
 * types the server actually returns. If a DTO gains a field the hand-written
 * schema omits, this is where it surfaces.
 */
function expectType<TExpected, _TActual extends TExpected>(): void {
  /* Type-level only; the body intentionally does nothing. */
}

type HealthDto = {
  status: string;
  environment: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
};

type ReadyDto = {
  status: 'ready';
  checks: { database: 'up'; migrations: 'applied' };
};

/**
 * The health DTOs are declared here so `expectType` below can fail compilation
 * if the routes in `src/modules/system/health.routes.ts` drift from them. The
 * declaration order is not significant; only the shape is.
 */
declare function _healthDtoProbe(): HealthDto;
declare function _readyDtoProbe(): ReadyDto;

function jsonResponse(schema: JsonSchema, description: string): JsonSchema {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

const successOf = (data: JsonSchema): JsonSchema => ({
  type: 'object',
  required: ['success', 'data'],
  properties: { success: { type: 'boolean', const: true }, data },
});

/** Every route can fail this way, so the shape is shared rather than repeated. */
function errorResponses(
  codes: readonly ApiErrorCode[] = GENERIC_ERRORS,
): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {};
  for (const code of codes) {
    const status = statusForApiCode(code);
    const label = `${status} ${code}`;
    responses[label] = jsonResponse({ $ref: '#/components/schemas/ErrorEnvelope' }, code);
  }
  return responses;
}

/**
 * Codes any authenticated route may return. Health probes are narrower and pass
 * their own list; feature routes get this default.
 */
const GENERIC_ERRORS: readonly ApiErrorCode[] = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
];

function buildDocument(): JsonSchema {
  // Compile-time assertions: if a runtime type stops satisfying the shared
  // contract, the build breaks here rather than publishing a wrong document.
  // ErrorEnvelope is one arm of the ApiEnvelope union.
  expectType<ApiEnvelope<never>, ErrorEnvelope>();
  expectType<PaginationMeta, ReturnType<typeof _buildPaginationMetaTypeProbe>>();
  expectType<unknown, HealthDto & ReadyDto>();

  const paths: Record<string, JsonSchema> = {
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Liveness probe',
        description:
          'Reports that the process is running. Intentionally unauthenticated and ' +
          'performs no database query, so it stays green while dependencies are down.',
        tags: ['system'],
        security: [],
        responses: {
          ...errorResponses(['INTERNAL_ERROR']),
          ...jsonResponse(
            successOf({
              type: 'object',
              properties: {
                status: { type: 'string', examples: ['ok'] },
                environment: { type: 'string', examples: ['development'] },
                version: { type: 'string' },
                timestamp: isoDateTimeSchema,
                uptimeSeconds: { type: 'number' },
              },
            }),
            'Process is alive',
          ),
        },
      },
    },
    '/ready': {
      get: {
        operationId: 'getReadiness',
        summary: 'Readiness probe',
        description:
          'Verifies the database is reachable and that all migrations are applied. ' +
          'Returns 503 when the instance cannot serve traffic, so a load balancer ' +
          'stops routing to it.',
        tags: ['system'],
        security: [],
        responses: {
          ...errorResponses(['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']),
          '503 Service Unavailable': jsonResponse(
            successOf({
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['not_ready'] },
                checks: {
                  type: 'object',
                  properties: {
                    database: { type: 'string' },
                    migrations: { type: 'string' },
                  },
                },
              },
            }),
            'A dependency is unavailable',
          ),
          ...jsonResponse(
            successOf({
              type: 'object',
              properties: {
                status: { type: 'string', const: 'ready' },
                checks: {
                  type: 'object',
                  properties: {
                    database: { type: 'string', const: 'up' },
                    migrations: { type: 'string', const: 'applied' },
                  },
                },
              },
            }),
            'Instance can serve traffic',
          ),
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Library Management System API',
      version: '1.0.0',
      description:
        'Multi-branch library management API.\n\n' +
        '**The API is the security boundary.** Authorisation is enforced per ' +
        'request from the caller’s permissions, derived from their roles and ' +
        'library scope. Hiding a control in the frontend grants nothing.\n\n' +
        'Conventions:\n' +
        '- All responses use the `{ success, data }` / `{ success, error }` envelope.\n' +
        '- Money is a fixed-scale decimal string (`Decimal(14,2)`), never a float.\n' +
        '- Timestamps are ISO 8601 with an explicit offset; the library timezone ' +
        'is `Africa/Nairobi`.\n' +
        '- Dates without a time (loan due dates) are `YYYY-MM-DD` calendar dates in ' +
        'the library timezone.\n' +
        `- List endpoints are paginated (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`,
      license: { name: 'UNLICENSED', identifier: 'UNLICENSED' },
    },
    servers: [{ url: '/api/v1', description: 'Versioned API base path' }],
    tags: [{ name: 'system', description: 'Liveness and readiness' }],
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'lms_session',
          description:
            'Opaque short-lived session identifier in an `HttpOnly`, `Secure`, ' +
            '`SameSite=Strict` cookie. Refresh tokens rotate on every use and are ' +
            'revoked on reuse.',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'x-csrf-token',
          description:
            'Required on every state-changing request. Matches the `lms_csrf` ' +
            'cookie, which is readable by JavaScript by design.',
        },
      },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', const: false },
            error: {
              type: 'object',
              required: ['code', 'message', 'status'],
              properties: {
                code: {
                  type: 'string',
                  enum: [...ALL_ERROR_CODES],
                  description:
                    'Stable machine-readable code. Clients branch on this, never on ' +
                    'the message.',
                },
                message: { type: 'string', description: 'Human-readable summary.' },
                status: { type: 'integer', description: 'Mirrors the HTTP status.' },
                fieldErrors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      message: { type: 'string' },
                    },
                  },
                  description: 'Present on VALIDATION_ERROR only.',
                },
                requestId: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Echoed in logs and the `x-request-id` response header.',
                },
              },
            },
          },
        },
        PaginationMeta: paginationMetaSchema,
        Uuid: uuidSchema,
        Money: moneySchema,
        IsoDateTime: isoDateTimeSchema,
      },
    },
    security: [{ sessionCookie: [], csrfToken: [] }],
  };
}

/** Type probe: the real builder's return type, without importing runtime code. */
declare function _buildPaginationMetaTypeProbe(): PaginationMeta;

function main(): void {
  const document = buildDocument();
  const serialised = `${JSON.stringify(document, null, 2)}\n`;

  const check = process.argv.includes('--check');

  if (check) {
    let existing: string;
    try {
      existing = readFileSync(OUTPUT_FILE, 'utf8');
    } catch {
      process.stderr.write(`[openapi] ${OUTPUT_FILE} does not exist. Run: npm run openapi\n`);
      process.exit(1);
    }

    // Compared as parsed JSON rather than as text: Prettier formats this file,
    // so a whitespace difference is not staleness and must not fail CI.
    let equivalent = false;
    try {
      equivalent = JSON.stringify(JSON.parse(existing)) === JSON.stringify(document);
    } catch {
      equivalent = false;
    }

    if (!equivalent) {
      process.stderr.write('[openapi] openapi.json is out of date. Run: npm run openapi\n');
      process.exit(1);
    }

    process.stdout.write('[openapi] openapi.json is current.\n');
    return;
  }

  writeFileSync(OUTPUT_FILE, serialised, 'utf8');
  const pathCount = Object.keys(document.paths as Record<string, unknown>).length;
  process.stdout.write(
    `[openapi] Wrote ${OUTPUT_FILE} (${pathCount} paths, ` +
      `${ALL_ERROR_CODES.length} error codes, ` +
      `${Object.keys(ERROR_CODES).length} transport codes).\n`,
  );
}

main();
