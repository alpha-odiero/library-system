import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

/**
 * What the user chose, as opposed to what is on screen.
 *
 * `theme` is always the RESOLVED colour — a page that reads it must never have
 * to ask whether "system" means light or dark today. `preference` is the stored
 * choice, and is what the Appearance section in Settings renders as the selected
 * option.
 */
export type ThemePreference = Theme | 'system';

interface ThemeState {
  /** Resolved: `system` resolved against the OS at this moment. */
  theme: Theme;
  /** The stored choice, including `system`. */
  preference: ThemePreference;
  toggleTheme: () => void;
  /** Set explicitly, for a menu item that says "Dark mode" or "Light mode". */
  setTheme: (theme: Theme) => void;
  /** Set the stored preference, for a control that offers `system` as well. */
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const STORE_KEY = 'soma360-theme';

function matchesDark(): boolean {
  // `matchMedia` is absent in some test and embedded webviews. Falling back to
  // light is the same answer as "no OS preference", not a crash.
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function initialPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage denied (private mode, blocked cookies): fall through to light.
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const [systemDark, setSystemDark] = useState<boolean>(matchesDark);

  // `system` is a live choice: flipping the OS appearance must repaint the app,
  // or the option is a lie that only becomes true after a reload.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);

    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const theme: Theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      // The preference is persisted, not the resolved value: writing `dark`
      // while the preference is `system` would silently opt the user out.
      window.localStorage.setItem(STORE_KEY, preference);
    } catch {
      // Nothing to do — the theme still applies for this session.
    }
  }, [theme, preference]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      preference,
      setPreference,
      setTheme: (next: Theme) => setPreference(next),
      toggleTheme: () => setPreference(theme === 'light' ? 'dark' : 'light'),
    }),
    [theme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
