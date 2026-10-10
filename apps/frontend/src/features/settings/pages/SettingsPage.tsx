import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { subscribeToRealtime } from '../../../lib/realtime';
import { getSettings, type SettingDto } from '../api';
import {
  LIBRARY_PREFERENCES,
  WORK_PREFERENCES,
  isOrgSection,
  sectionsFor,
  type SettingsSectionId,
} from '../sections';
import { AccountSection } from '../sections/AccountSection';
import { AppearanceSection } from '../sections/AppearanceSection';
import { NotificationSection } from '../sections/NotificationSection';
import { OrgSection } from '../sections/OrgSection';
import { PreferenceCard } from '../sections/PreferenceCard';
import { SecuritySection } from '../sections/SecuritySection';

/**
 * Settings.
 *
 * One route, three products. The navigation in `sections.ts` decides which
 * sections a role is offered, and the router keeps the active one in the query
 * string so a link to `?section=fines` is a link someone can send.
 *
 * What each section can DO is still decided by the server: the administrator's
 * organization forms write to `/settings`, which requires `SETTINGS_UPDATE` and
 * the administrator role, and a librarian never sees those forms at all. The
 * personal sections write to this browser and say so — they are preferences,
 * not library policy, and presenting them as anything else would be the first
 * lie the screen tells.
 */
export function SettingsPage(): ReactNode {
  const { session } = useAuth();
  const role = session?.roleCode ?? null;
  const isAdmin = role === 'ADMIN';

  const sections = useMemo(() => sectionsFor(role), [role]);
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('section') as SettingsSectionId | null;
  const active = sections.some((section) => section.id === requested)
    ? (requested as SettingsSectionId)
    : (sections[0]?.id ?? 'account');

  const [settings, setSettings] = useState<Map<string, SettingDto>>(() => new Map());
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getSettings(undefined, signal);
      const next = new Map<string, SettingDto>();
      for (const group of response.data.settings) {
        for (const setting of group.settings) next.set(setting.key, setting);
      }
      if (!signal.aborted) setSettings(next);
    } catch (caught) {
      if (!signal.aborted) setError(caught);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [isAdmin, load]);

  // A change made on another screen (or another signed-in browser) is reflected
  // without a manual refresh, exactly as the old per-row form did.
  useEffect(() => {
    if (!isAdmin) return undefined;
    return subscribeToRealtime('settings', () => void load(new AbortController().signal));
  }, [isAdmin, load]);

  /** Merge a successful save back into the loaded values, without a refetch. */
  const applyUpdates = useCallback((updates: Record<string, unknown>) => {
    setSettings((current) => {
      const next = new Map(current);
      for (const [key, value] of Object.entries(updates)) {
        const existing = next.get(key);
        next.set(
          key,
          existing
            ? { ...existing, value }
            : {
                key,
                value,
                valueType:
                  typeof value === 'boolean'
                    ? 'boolean'
                    : typeof value === 'number'
                      ? 'number'
                      : 'string',
                description: null,
                isPublic: false,
                updatedAt: new Date().toISOString(),
              },
        );
      }
      return next;
    });
  }, []);

  function selectSection(section: SettingsSectionId): void {
    setSearchParams({ section });
  }

  const current = sections.find((section) => section.id === active);

  function renderSection(section: SettingsSectionId): ReactNode {
    if (section === 'account') return <AccountSection />;
    if (section === 'appearance') return <AppearanceSection />;

    if (section === 'notifications') {
      return <NotificationSection role={role} settings={settings} onSaved={applyUpdates} />;
    }

    if (section === 'security') {
      return <SecuritySection role={role} settings={settings} onSaved={applyUpdates} />;
    }

    if (section === 'work') {
      return (
        <PreferenceCard
          title="At the desk"
          description="How much is confirmed and what is flagged while you work."
          scope="this device"
          preferences={WORK_PREFERENCES}
        />
      );
    }

    if (section === 'library') {
      return (
        <PreferenceCard
          title="Browsing the catalogue"
          description="How results are presented when you search or browse."
          scope="this device"
          preferences={LIBRARY_PREFERENCES}
        />
      );
    }

    if (isOrgSection(section)) {
      return <OrgSection section={section} settings={settings} onSaved={applyUpdates} />;
    }

    return null;
  }

  if (isAdmin && loading && settings.size === 0 && !error) {
    return <LoadingState label="Loading settings" rows={4} />;
  }

  if (isAdmin && error && settings.size === 0) {
    return <ErrorState error={error} onRetry={() => void load(new AbortController().signal)} />;
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Settings</h1>
          <p className="page-header__subtitle">{subtitleFor(role)}</p>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((section) => (
            <button
              type="button"
              key={section.id}
              className={`settings-nav__button${
                section.id === active ? ' settings-nav__button--active' : ''
              }`}
              aria-current={section.id === active ? 'page' : undefined}
              onClick={() => selectSection(section.id)}
            >
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panels">
          <section className="settings-section" aria-labelledby="settings-section-title">
            <header className="settings-section__header">
              <h2 className="settings-section__title" id="settings-section-title">
                {current?.label}
              </h2>
              <p className="settings-section__description">{current?.description}</p>
            </header>

            {renderSection(active)}
          </section>
        </div>
      </div>
    </>
  );
}

function subtitleFor(role: string | null): string {
  switch (role) {
    case 'ADMIN':
      return 'Library policy the desk honours, and the settings your account keeps for itself.';
    case 'LIBRARIAN':
      return 'Your desk, your notifications, and the security of your own account.';
    default:
      return 'Your profile, how the catalogue is shown to you, and how the library reaches you.';
  }
}
