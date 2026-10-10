import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { usePublicSettings } from '../../app/usePublicSettings';
import { Brand } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { paths } from '../../routes/paths';
import aboutPhoto from '../../assets/about-us.webp';
import analyticsShot from '../../assets/analytics-preview.webp';
import heroShot from '../../assets/hero-sider.webp';

/**
 * The public landing page.
 *
 * ## What this page is allowed to claim
 *
 * Every capability named below is a route that exists in `routes/index.tsx` behind a
 * permission the backend enforces. Nothing is promised that the app cannot deliver,
 * and there are no invented statistics — a marketing page that says "trusted by 400
 * libraries" when nothing in the codebase knows a library count is the kind of claim
 * that survives a redesign and then haunts the product. Where a figure is shown
 * for illustration (the hero preview and the analytics screenshot), it carries the
 * caption "Interface preview — figures shown are illustrative."
 *
 * ## Structure
 *
 * Navbar → hero → value strip → about/showcase → features → how it works →
 * modules → audience → analytics → security → call to action → footer. Every
 * anchor the navigation points at (`#top`, `#about`, `#features`, `#modules`,
 * `#contact`) resolves to a section in that order, so jumping never skips past
 * the reader.
 *
 * ## Tone
 *
 * The application half of this product is dense, quiet and factual. The page that
 * sells it gets to breathe, but only here: this file is the single place in the
 * codebase where the writing is persuasive rather than descriptive, and it is
 * deliberately separated so the two never blend into each other.
 */

type Tone = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'yellow' | 'pink' | 'slate';

interface Section {
  readonly title: string;
  readonly body: string;
}

interface IconSection extends Section {
  readonly icon: IconName;
}

interface TonedSection extends IconSection {
  readonly tone: Tone;
}

interface ModuleCard extends TonedSection {
  readonly href: string;
}

interface StepCard extends Section {
  readonly step: string;
}

const NAV_LINKS: readonly { readonly label: string; readonly href: string }[] = [
  { label: 'Home', href: '#top' },
  { label: 'About', href: '#about' },
  { label: 'Features', href: '#features' },
  { label: 'Modules', href: '#modules' },
  { label: 'Contact', href: '#contact' },
];

/* Value strip: three promises, each one a thing the product demonstrably does. */
const VALUES: readonly TonedSection[] = [
  {
    title: 'One catalogue, every copy',
    body: 'Titles, copies, authors, categories and publishers held once, with availability that reflects the shelf rather than an intention.',
    icon: 'books',
    tone: 'blue',
  },
  {
    title: 'A dashboard for each role',
    body: 'Administrators, librarians and students each sign in to the dashboard built for their work — and see only what their role allows.',
    icon: 'dashboard',
    tone: 'green',
  },
  {
    title: 'Installable on any device',
    body: 'A progressive web app: add it to a desktop, a tablet or the phone at the returns desk, and it opens full-screen.',
    icon: 'download',
    tone: 'purple',
  },
];

/* The showcase's numbered roles. 01/02/03 is structure, not a statistic. */
const SHOWCASE_ROLES: readonly {
  readonly num: string;
  readonly title: string;
  readonly body: string;
}[] = [
  {
    num: '01',
    title: 'Administrator',
    body: 'Registers the library, adds librarians and students, and owns the catalogue, the permissions and the settings.',
  },
  {
    num: '02',
    title: 'Librarian',
    body: 'Runs the desk — issue, renew, take returns, work the holds queue, assess fines and send notices.',
  },
  {
    num: '03',
    title: 'Student',
    body: 'Browses the catalogue and follows their own loans, holds and fines from the same account.',
  },
];

const FEATURES: readonly TonedSection[] = [
  {
    title: 'Catalogue and copies',
    body: 'Books, copies, authors, categories and publishers, with a shelf count the circulation desk can trust.',
    icon: 'books',
    tone: 'blue',
  },
  {
    title: 'Circulation desk',
    body: 'Issue, renew and take returns in a few keystrokes. Overdue work surfaces on the dashboard instead of being hunted for.',
    icon: 'arrowRightLeft',
    tone: 'purple',
  },
  {
    title: 'Holds and reservations',
    body: 'A real queue with expiry, so a copy reserved for one reader is not quietly reissued to the next.',
    icon: 'reservations',
    tone: 'orange',
  },
  {
    title: 'Fines and payments',
    body: 'Assess, part-pay and receipt. Balances are computed from what is owed, not from what was originally charged.',
    icon: 'wallet',
    tone: 'red',
  },
  {
    title: 'People and permissions',
    body: 'Administrators, librarians and students, each with a sign-in whose access is re-checked on the server for every request.',
    icon: 'roles',
    tone: 'green',
  },
  {
    title: 'Reports, audit and settings',
    body: 'Reports, an append-only audit log and library settings — administration screens behind the same permissions as everything else.',
    icon: 'reports',
    tone: 'slate',
  },
];

const STEPS: readonly StepCard[] = [
  {
    step: '01',
    title: 'Register your library',
    body: 'Create the administrator account for your library — no card details required.',
  },
  {
    step: '02',
    title: 'Add staff and students',
    body: 'The administrator adds librarians and registers students, each with their own sign-in.',
  },
  {
    step: '03',
    title: 'Run the desk',
    body: 'Issue, renew and take returns, with holds, fines and notices recorded in the same place.',
  },
];

const MODULES: readonly ModuleCard[] = [
  {
    title: 'Catalogue',
    body: 'Titles, copies and the name authorities behind them, with availability that reflects the shelf.',
    icon: 'books',
    tone: 'blue',
    href: paths.books,
  },
  {
    title: 'Circulation',
    body: 'Issue, renew and take returns at the desk, with the loans list and the returns counter side by side.',
    icon: 'arrowRightLeft',
    tone: 'purple',
    href: paths.loans,
  },
  {
    title: 'Students',
    body: 'Registration, borrowing entitlements and borrowing history, held once and reused everywhere.',
    icon: 'members',
    tone: 'green',
    href: paths.members,
  },
  {
    title: 'Reservations',
    body: 'A holds queue with expiry, so a shelf reserved for someone is not quietly reissued.',
    icon: 'reservations',
    tone: 'orange',
    href: paths.reservations,
  },
  {
    title: 'Fines and payments',
    body: 'Assess, part-pay and receipt, with balances derived from what is actually outstanding.',
    icon: 'wallet',
    tone: 'red',
    href: paths.fines,
  },
  {
    title: 'Notices',
    body: 'Due-date reminders and overdue notices to the right reader, each one recorded against the account.',
    icon: 'megaphone',
    tone: 'blue',
    href: paths.notifications,
  },
];

const AUDIENCE: readonly IconSection[] = [
  {
    title: 'Administrators',
    body: 'Set the library up once, then keep the catalogue, the staff list and the permissions in order.',
    icon: 'roles',
  },
  {
    title: 'Librarians',
    body: 'Everything the desk needs on one screen, and nothing it does not — the queue, the counter and the day’s overdue work.',
    icon: 'arrowRightLeft',
  },
  {
    title: 'Students',
    body: 'A quieter account: what is on loan, what is on hold, what is owed, and what is on the shelf.',
    icon: 'members',
  },
];

const PANELS: readonly string[] = [
  'Recent Circulation',
  'Notice Board',
  'Library Calendar',
  'Quick Access',
  'Borrowing Performance',
  'Due Today',
];

const SECURITY: readonly IconSection[] = [
  {
    title: 'Role-based access',
    body: 'Administrators, librarians and students each sign in to the dashboard built for their work, and see only what their role allows.',
    icon: 'roles',
  },
  {
    title: 'Library isolation',
    body: 'An account can only reach its own library’s records — the scope is part of the query, not a check made after it.',
    icon: 'branches',
  },
  {
    title: 'Append-only audit log',
    body: 'Changes are written to an audit log the database will not let update or delete, with the actor recorded alongside the record.',
    icon: 'auditLog',
  },
  {
    title: 'Email verification',
    body: 'A new account confirms its email address before the first sign-in.',
    icon: 'mail',
  },
];

/**
 * Scroll reveal for the sections below the fold.
 *
 * Sections start hidden only when an IntersectionObserver can actually run, so a
 * browser without one (or a reader who asked for reduced motion) gets the page
 * immediately rather than a blank one.
 */
function useReveal(): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (reduced || typeof IntersectionObserver === 'undefined') {
      targets.forEach((target) => target.classList.add('is-in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -6% 0%', threshold: 0.08 },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return ref;
}

export function LandingPage(): ReactNode {
  const { theme, toggleTheme } = useTheme();
  const settings = usePublicSettings();
  const orgName = settings?.['org.name'] ?? 'Soma360';
  const orgEmail = settings?.['org.email'];
  const orgPhone = settings?.['org.phone'];
  const [menuOpen, setMenuOpen] = useState(false);
  const revealRef = useReveal();

  return (
    <div className="landing" ref={revealRef}>
      <header className="landing__nav">
        <div className="landing__container landing__nav-inner">
          <Link className="landing__brand" to={paths.dashboard} aria-label="Soma360 home">
            <Brand compact />
          </Link>

          <nav className="landing__links" aria-label="Sections">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="landing__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
            </Button>
            <Link className="landing__signin" to={paths.login}>
              Sign in
            </Link>
            <Link className="landing__btn landing__btn--primary" to={paths.register}>
              Register your library
            </Link>
            <button
              type="button"
              className="landing__menu-btn"
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} size={18} />
            </button>
          </div>
        </div>

        <div className={`landing__menu${menuOpen ? ' landing__menu--open' : ''}`} id="landing-menu">
          <nav className="landing__menu-links" aria-label="Sections">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
            <Link to={paths.login} onClick={() => setMenuOpen(false)}>
              Sign in
            </Link>
            <Link className="landing__btn landing__btn--primary" to={paths.register}>
              Register your library
            </Link>
          </nav>
        </div>
      </header>

      <main className="landing__main">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="landing__hero" id="top">
          <div className="landing__container landing__hero-inner">
            <div className="landing__hero-copy">
              <p className="landing__eyebrow">Library management system</p>
              <h1 className="landing__title">Smarter Libraries. Brighter Futures.</h1>
              <p className="landing__lede">
                Soma360 connects the shelf, the desk and the reader in one system — catalogue,
                circulation, holds, fines and reports, behind a dashboard shaped to whoever signs
                in.
              </p>

              <div className="landing__hero-actions">
                <Link
                  className="landing__btn landing__btn--invert landing__btn--lg"
                  to={paths.register}
                >
                  Register your library
                  <Icon name="arrowRight" size={16} />
                </Link>
                <Link
                  className="landing__btn landing__btn--outline landing__btn--lg"
                  to={paths.login}
                >
                  Staff sign in
                </Link>
              </div>

              <ul className="landing__proof">
                <li>
                  <Icon name="check" size={14} />
                  No card details required
                </li>
                <li>
                  <Icon name="check" size={14} />
                  Administrator, librarian and student roles
                </li>
                <li>
                  <Icon name="check" size={14} />
                  Email verification before first sign-in
                </li>
              </ul>
            </div>

            <div className="landing__hero-art">
              <img
                className="landing__hero-shot"
                src={heroShot}
                alt="The Soma360 dashboard"
                width={500}
                height={500}
              />
            </div>
          </div>

          <p className="landing__preview-note">
            Interface preview — figures shown are illustrative.
          </p>
        </section>

        {/* ── Value strip ──────────────────────────────────────────────────── */}
        <section className="landing__strip" data-reveal>
          <div className="landing__container landing__values">
            {VALUES.map((value) => (
              <article className="landing__value" key={value.title}>
                <span
                  className={`landing__iconbox landing__iconbox--${value.tone}`}
                  aria-hidden="true"
                >
                  <Icon name={value.icon} size={18} />
                </span>
                <div>
                  <h2 className="landing__value-title">{value.title}</h2>
                  <p className="landing__value-body">{value.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── About / product showcase ─────────────────────────────────────── */}
        <section className="landing__section" id="about" data-reveal>
          <div className="landing__container landing__showcase">
            <figure className="landing__showcase-figure">
              <img
                className="landing__showcase-shot"
                src={aboutPhoto}
                alt="About Soma360"
                loading="lazy"
              />
            </figure>

            <div className="landing__showcase-copy">
              <p className="landing__section-eyebrow">About</p>
              <h2 className="landing__section-title">One product, three jobs</h2>
              <p className="landing__section-body">
                The administrator who sets the library up, the librarian who runs the desk, and the
                student who borrows from it — each with their own sign-in and their own dashboard.
                Nobody signs in to a screen built for somebody else.
              </p>

              <ol className="landing__numbered">
                {SHOWCASE_ROLES.map((role) => (
                  <li className="landing__numbered-item" key={role.num}>
                    <span className="landing__numbered-num" aria-hidden="true">
                      {role.num}
                    </span>
                    <div>
                      <h3 className="landing__numbered-title">{role.title}</h3>
                      <p className="landing__numbered-body">{role.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section className="landing__section landing__section--paper" id="features" data-reveal>
          <div className="landing__container">
            <header className="landing__section-head landing__section-head--center">
              <p className="landing__section-eyebrow">Features</p>
              <h2 className="landing__section-title">Everything your library needs</h2>
              <p className="landing__section-body">
                Six parts of a library system nobody sees until they fail — so they are the parts
                this one is built around.
              </p>
            </header>

            <ul className="landing__features">
              {FEATURES.map((feature) => (
                <li className="landing__feature" key={feature.title}>
                  <span
                    className={`landing__iconbox landing__iconbox--${feature.tone}`}
                    aria-hidden="true"
                  >
                    <Icon name={feature.icon} size={18} />
                  </span>
                  <h3 className="landing__feature-title">{feature.title}</h3>
                  <p className="landing__feature-body">{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="landing__section" data-reveal>
          <div className="landing__container">
            <header className="landing__section-head landing__section-head--center">
              <p className="landing__section-eyebrow">How it works</p>
              <h2 className="landing__section-title">Three steps to a live library</h2>
            </header>

            <ol className="landing__steps">
              {STEPS.map((step) => (
                <li className="landing__step" key={step.step}>
                  <span className="landing__step-num" aria-hidden="true">
                    {step.step}
                  </span>
                  <h3 className="landing__step-title">{step.title}</h3>
                  <p className="landing__step-body">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Modules ──────────────────────────────────────────────────────── */}
        <section className="landing__section landing__section--paper" id="modules" data-reveal>
          <div className="landing__container">
            <header className="landing__section-head">
              <p className="landing__section-eyebrow">Modules</p>
              <h2 className="landing__section-title">Everything a library actually runs on</h2>
              <p className="landing__section-body">
                Six modules over one database, each of which opens the record behind the number you
                are looking at.
              </p>
            </header>

            <ul className="landing__modules">
              {MODULES.map((module) => (
                <li className="landing__module" key={module.title}>
                  <span
                    className={`landing__iconbox landing__iconbox--${module.tone}`}
                    aria-hidden="true"
                  >
                    <Icon name={module.icon} size={18} />
                  </span>
                  <h3 className="landing__module-title">{module.title}</h3>
                  <p className="landing__module-body">{module.body}</p>
                  <Link className="landing__module-link" to={module.href}>
                    Open {module.title.toLowerCase()}
                    <Icon name="chevronRight" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Audience ─────────────────────────────────────────────────────── */}
        <section className="landing__section" data-reveal>
          <div className="landing__container">
            <header className="landing__section-head landing__section-head--center">
              <p className="landing__section-eyebrow">Who it is for</p>
              <h2 className="landing__section-title">Built for everyone who uses it</h2>
            </header>

            <ul className="landing__audience">
              {AUDIENCE.map((person) => (
                <li className="landing__audience-card" key={person.title}>
                  <span className="landing__iconbox landing__iconbox--slate" aria-hidden="true">
                    <Icon name={person.icon} size={18} />
                  </span>
                  <h3 className="landing__audience-title">{person.title}</h3>
                  <p className="landing__audience-body">{person.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Analytics ────────────────────────────────────────────────────── */}
        <section className="landing__band" data-reveal>
          <div className="landing__container landing__analytics">
            <div className="landing__analytics-copy">
              <p className="landing__section-eyebrow landing__section-eyebrow--onDark">Analytics</p>
              <h2 className="landing__section-title">Assembled from the counts you may request</h2>
              <p className="landing__section-body landing__section-body--onDark">
                Every figure is a count the server already knows how to answer, and only for the
                panels the session is entitled to ask for. A panel you may not see is absent rather
                than faked.
              </p>

              <ul className="landing__panels">
                {PANELS.map((panel) => (
                  <li className="landing__panel-chip" key={panel}>
                    {panel}
                  </li>
                ))}
              </ul>
            </div>

            <figure className="landing__chart">
              <img
                className="landing__chart-shot"
                src={analyticsShot}
                alt="The Soma360 analytics dashboard"
                loading="lazy"
              />
              <figcaption className="landing__chart-caption">
                Interface preview — figures shown are illustrative.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── Security ─────────────────────────────────────────────────────── */}
        <section className="landing__section landing__section--paper" data-reveal>
          <div className="landing__container">
            <header className="landing__section-head">
              <p className="landing__section-eyebrow">Security</p>
              <h2 className="landing__section-title">Checked on every request</h2>
              <p className="landing__section-body">
                Access is decided on the server, per capability, for every call the browser makes.
              </p>
            </header>

            <ul className="landing__security">
              {SECURITY.map((item) => (
                <li className="landing__security-item" key={item.title}>
                  <span className="landing__iconbox landing__iconbox--slate" aria-hidden="true">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <div>
                    <h3 className="landing__security-title">{item.title}</h3>
                    <p className="landing__security-body">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Closing call to action ───────────────────────────────────────── */}
        <section className="landing__cta-band" id="get-started" data-reveal>
          <div className="landing__container landing__cta-inner">
            <div className="landing__cta-copy">
              <h2 className="landing__cta-title">Start with the library admin account</h2>
              <p className="landing__cta-body">
                Register your library to create the administrator account and begin managing books,
                members, staff and circulation in one place.
              </p>
            </div>
            <div className="landing__cta-actions">
              <Link
                className="landing__btn landing__btn--invert landing__btn--lg"
                to={paths.register}
              >
                Register your library
                <Icon name="arrowRight" size={16} />
              </Link>
              <Link
                className="landing__btn landing__btn--outline landing__btn--lg"
                to={paths.login}
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="landing__foot" id="contact" data-reveal>
        <div className="landing__container landing__foot-grid">
          <div className="landing__foot-brand">
            <Brand />
            <p className="landing__foot-legal">
              © {new Date().getFullYear()} {orgName} · Library Management System
            </p>
            <div className="landing__foot-actions">
              <Link className="landing__btn landing__btn--primary" to={paths.register}>
                Register your library
              </Link>
              <Link className="landing__btn landing__btn--ghost" to={paths.login}>
                Sign in
              </Link>
            </div>
          </div>

          <nav className="landing__foot-col" aria-label="Product">
            <h3 className="landing__foot-head">Product</h3>
            <a href="#about">About</a>
            <a href="#features">Features</a>
            <a href="#modules">Modules</a>
            <a href="#top">Back to top</a>
          </nav>

          <nav className="landing__foot-col" aria-label="Modules">
            <h3 className="landing__foot-head">Modules</h3>
            <Link to={paths.books}>Catalogue</Link>
            <Link to={paths.loans}>Circulation</Link>
            <Link to={paths.members}>Students</Link>
            <Link to={paths.reservations}>Reservations</Link>
          </nav>

          <nav className="landing__foot-col" aria-label="Account">
            <h3 className="landing__foot-head">Account</h3>
            <Link to={paths.login}>Sign in</Link>
            <Link to={paths.register}>Register your library</Link>
            <Link to={paths.forgotPassword}>Reset password</Link>
          </nav>

          {(orgEmail || orgPhone) && (
            <div className="landing__foot-col">
              <h3 className="landing__foot-head">Contact</h3>
              {orgEmail && <a href={`mailto:${orgEmail}`}>{orgEmail}</a>}
              {orgPhone && <a href={`tel:${orgPhone}`}>{orgPhone}</a>}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
