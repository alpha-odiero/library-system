/**
 * Test bootstrap.
 *
 * Environment comes from `vitest.config.ts` so it is applied before any module
 * that reads `process.env` at import time — notably `config/env.ts`, which
 * exits the process on invalid configuration.
 */

// Unhandled rejections should fail a test, not be swallowed.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection during tests:', reason);
  process.exitCode = 1;
});

export {};
