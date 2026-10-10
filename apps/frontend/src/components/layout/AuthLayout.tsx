import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { usePublicSettings } from '../../app/usePublicSettings';
import { paths } from '../../routes/paths';
import { Button } from '../ui/Button';
import { Brand } from '../ui/Brand';
import { Icon } from '../ui/Icon';
import { LibraryArt } from '../ui/LibraryArt';

/**
 * The signed-out shell for auth screens.
 *
 * Kept separate from `AppLayout` because the two have different jobs: this one
 * centres a single task and shows the organisation's identity from
 * `GET /settings/public`, while the app shell exposes navigation and an account
 * menu. A signed-out visitor must not see a sidebar of links that would 403.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  imageStory = false,
}: {
  title: string;
  subtitle?: ReactNode | undefined;
  imageStory?: boolean;
  /**
   * Optional: some auth screens (a completed reset, a consumed verification link)
   * have nothing left to submit. The confirmation itself is the body.
   */
  children?: ReactNode | undefined;
  footer?: ReactNode | undefined;
}): ReactNode {
  const { theme, toggleTheme } = useTheme();
  // The landing-page link names the organisation, so it must not read "Learn more
  // about Soma360" on a library that has renamed itself in settings.
  const orgName = usePublicSettings()?.['org.name'] ?? 'Soma360';

  return (
    <div className={['auth', imageStory && 'auth--image-story'].filter(Boolean).join(' ')}>
      <aside className="auth__story">
        <Brand />
        <div className="auth__story-copy">
          <p className="auth__eyebrow">Your library, connected</p>
          <p className="auth__tagline">Smarter Libraries. Brighter Futures.</p>
          <p className="auth__description">
            A clearer view of your library account, wherever your reading takes you.
          </p>
          <LibraryArt />
        </div>
        <div className="auth__story-foot">
          <p className="auth__story-foot-text">A more thoughtful way to manage library life.</p>
          {/*
            The only route from the signed-out shell to the landing page. Without it
            `/welcome` exists but nothing in the app links to it, and a public page
            that cannot be reached is not public.
          */}
          <Link className="auth__story-link" to={paths.landing}>
            Learn more about {orgName}
            <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      </aside>
      <div className="auth__panel">
        <div className="auth__panel-top">
          <Brand compact />
          {/*
            A real icon rather than the `◐`/`☼` text glyphs this used to carry. The
            rest of the application draws its controls from `Icon`, and a theme toggle
            is the one control every single screen shows — a glyph that renders
            differently per platform is exactly the sort of thing that should not be
            the last holdout.
          */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
          </Button>
        </div>
        <div className="auth__form-content">
          <h1 className="auth__title">{title}</h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          <div className="auth__body">{children}</div>
          {footer && <div className="auth__footer">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
