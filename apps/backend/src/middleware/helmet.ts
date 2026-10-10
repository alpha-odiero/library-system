import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { corsAllowedOrigins, isProduction } from '../config/env.js';

/**
 * Security headers.
 *
 * The CSP is deliberately strict: `script-src 'self'` with no `unsafe-inline`,
 * because React does not require inline scripts and permitting them would void
 * the XSS protection. Nonces are added later in Phase 2 only if a rendering
 * path genuinely needs one.
 */
export function securityHeaders(): RequestHandler[] {
  const csp = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'"],
    // Tailwind injects a style element at runtime, so styles need inline
    // allowance. Scripts never do — that is where XSS actually executes.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...corsAllowedOrigins],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", ...corsAllowedOrigins],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    frameSrc: ["'none'"],
    mediaSrc: ["'self'"],
    ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
  };

  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: csp,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      // `noSniff` + a strict policy blocks MIME-confusion attacks against the API.
      xContentTypeOptions: true,
      xFrameOptions: { action: 'deny' },
      hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
    }),
    (_req, res, next) => {
      res.removeHeader('X-Powered-By');
      // API responses must never be cached by intermediaries: they are
      // per-principal, and a shared cache would serve one member's data to another.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      next();
    },
  ];
}
