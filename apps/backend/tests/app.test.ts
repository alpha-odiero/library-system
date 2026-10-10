import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bodyOf, rawBody, type ErrorBody, type SuccessBody } from './helpers.js';

/**
 * Application-shell tests.
 *
 * These run without a database, so only `/health` (which deliberately touches no
 * dependency) is exercised here. `/ready` requires PostgreSQL and lives in the
 * integration suite.
 */

const app = createApp();

interface HealthData {
  status: string;
  uptimeSeconds: number;
  environment: string;
}

describe('GET /health', () => {
  it('reports the process is alive and needs no dependency', async () => {
    const response = await request(app).get('/health');
    const body = bodyOf<SuccessBody<HealthData>>(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(typeof body.data.uptimeSeconds).toBe('number');
  });

  it('echoes a request id so a support ticket can be traced', async () => {
    const response = await request(app).get('/health').set('x-request-id', 'trace-abcdef123456');

    expect(response.headers['x-request-id']).toBe('trace-abcdef123456');
  });

  it('generates a request id when the client does not supply a usable one', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an unsafe inbound request id instead of echoing it into logs', async () => {
    // An unsanitised id would let a client inject newlines and forge log entries.
    const response = await request(app)
      .get('/health')
      .set('x-request-id', 'bad id with spaces and <script>');

    expect(response.headers['x-request-id']).not.toContain('<script>');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers', () => {
  it('sets the hardened baseline on every response', async () => {
    const response = await request(app).get('/health');
    const headers = response.headers;

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('forbids framing at the CSP layer as well', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['content-security-policy']).toContain("frame-src 'none'");
  });

  it('does not advertise the server technology', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('marks API responses as uncacheable — they are per-principal', async () => {
    const response = await request(app).get('/api/v1');
    expect(response.headers['cache-control']).toContain('no-store');
  });
});

describe('CORS', () => {
  it('allows the configured frontend origin', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).not.toBe(403);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('refuses an unlisted origin', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    // A wildcard or reflected origin would let any site read authenticated responses.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not set Access-Control-Allow-Origin for a same-origin request', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error envelope', () => {
  it('returns the standard shape for an unmatched route', async () => {
    const response = await request(app).get('/does-not-exist');
    const body = bodyOf<ErrorBody>(response);

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.requestId).toBeDefined();
  });

  it('rejects malformed JSON without leaking a parser stack trace', async () => {
    const response = await request(app)
      .post('/api/v1')
      .set('Content-Type', 'application/json')
      .send('{"unclosed": ');

    const body = bodyOf<ErrorBody>(response);

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('MALFORMED_REQUEST');

    const serialised = rawBody(response);
    expect(serialised).not.toContain('at Object.');
    expect(serialised).not.toContain('node_modules');
    expect(serialised).not.toContain('SyntaxError:');
  });

  it('never returns a stack trace in any error body', async () => {
    const responses = await Promise.all([
      request(app).get('/nope'),
      request(app).post('/api/v1').set('Content-Type', 'application/json').send('{'),
      request(app).patch('/api/v1/nope/deep/path'),
    ]);

    for (const response of responses) {
      const serialised = rawBody(response);
      expect(serialised).not.toMatch(/\s\s\sat\s/);
      expect(serialised).not.toContain('node_modules');
    }
  });
});

describe('API surface', () => {
  it('exposes the v1 root', async () => {
    const response = await request(app).get('/api/v1');
    const body = bodyOf<SuccessBody<{ version: string }>>(response);

    expect(response.status).toBe(200);
    expect(body.data.version).toBe('v1');
  });

  it('is not versioned implicitly — /api is not the same as /api/v1', async () => {
    const response = await request(app).get('/api');
    expect(response.status).toBe(404);
  });
});
