import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dev proxy target is fixed rather than read from `process.env`, so the
 * config needs no Node typings. Override it by editing the constant or by
 * pointing the browser at a deployed API.
 */
const API_TARGET = 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
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
