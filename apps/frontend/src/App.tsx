import type { JSX } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { AppRouter } from './routes';

/**
 * Provider composition.
 *
 * Order matters and is not arbitrary:
 *
 *   `ToastProvider` is outermost so any provider or route below can report
 *   without holding a reference to it.
 *   `AuthProvider` sits above the router because the guards read the session, and
 *   `RequireAuth` must render a splash rather than bounce to /login while
 *   `GET /auth/me` is still in flight — otherwise every full page load flashes
 *   the sign-in screen at an already-signed-in user.
 */
export function App(): JSX.Element {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>
  );
}
