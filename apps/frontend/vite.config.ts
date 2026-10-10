import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dev proxy target is fixed rather than read from `process.env`, so the
 * config needs no Node typings. Override it by editing the constant or by
 * pointing the browser at a deployed API.
 */
const API_TARGET = 'http://localhost:4000';

/**
 * The deployed API origin the production build talks to cross-site. Matching
 * `apps/frontend/.env.production`; a preconnect here lets the browser warm the
 * DNS + TLS handshake for the sign-in API calls while the bundle still loads.
 */
const API_ORIGIN = 'https://library-system-jdge.onrender.com';

/**
 * Prod-only hint that every page makes its first requests to the API origin.
 * Skipped in dev, where the proxy keeps everything on `localhost`.
 */
function apiPreconnect(): Plugin {
  return {
    name: 'lms-api-preconnect',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html;
      return {
        html,
        tags: [
          { tag: 'link', attrs: { rel: 'dns-prefetch', href: API_ORIGIN } },
          { tag: 'link', attrs: { rel: 'preconnect', href: API_ORIGIN, crossorigin: '' } },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPreconnect()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxied in development so the browser sees a single origin. That keeps
      // auth cookies first-party, avoids a CORS preflight on every request, and
      // lets the Secure-only cookie policy switch on in production without a
      // second code path.
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
      '/ready': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    // Production sourcemaps are disabled: the 1.6MB `.js.map` doubled the
    // shipped payload until a client opened DevTools, and the repo never
    // consumes them in prod. Vite still maps development by Eval anyway.
    sourcemap: false,
    // Split vendor chunks so a copy-only app-shell change does not invalidate
    // the React bundle on every release. `@lms/shared` is deliberately absent:
    // it is currently imported for types only, which tree-shakes to nothing and
    // would emit an empty chunk.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
