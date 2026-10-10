/// <reference types="vite/client" />

/**
 * Typed Vite environment variables.
 *
 * Without this interface `import.meta.env` is `any` at every access, which lets
 * a typo (`VITE_API_BASE_URL` vs `VITE_API_BASEURL`) become an `undefined` that
 * silently degrades every request to a relative URL at runtime.
 */
interface ImportMetaEnv {
  /** Overrides the API base path. Defaults to the same-origin `/api/v1`. */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_VERSION?: string;
  /** Only ever set for local development against a non-proxy backend. */
  readonly VITE_DEV_API_URL?: string;
  /**
   * Must match the backend's CSRF_COOKIE_NAME. Readable by JavaScript by
   * design — the backend compares the header against this cookie.
   */
  readonly VITE_CSRF_COOKIE_NAME?: string;
  /** Must match the backend's CSRF_HEADER_NAME. */
  readonly VITE_CSRF_HEADER_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
