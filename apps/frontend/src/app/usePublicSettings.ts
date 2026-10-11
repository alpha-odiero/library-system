import { useEffect, useState } from 'react';
import { cachedReference } from '../lib/referenceCache';

/** Org details from `GET /settings/public`. Only the three a signed-out visitor needs. */
interface PublicSettings {
  'org.name'?: string;
  'org.email'?: string;
  'org.phone'?: string;
}

const CACHE_KEY = 'settings:public';
const TTL_MS = 5 * 60_000;

export function usePublicSettings(): PublicSettings | null {
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    let active = true;

    // Imported lazily to keep this hook out of the module graph of every page
    // that happens to render an organisation name. The request itself is shared
    // and cached: the sign-in shell, the landing hero, and the dashboard all ask
    // for the same public settings, and only one of them should ever hit the
    // network within the TTL.
    void import('../features/settings/api')
      .then(({ getPublicSettings }) =>
        cachedReference(CACHE_KEY, TTL_MS, () => getPublicSettings()),
      )
      .then((response) => {
        if (active) setSettings(response.data);
      })
      // A missing name is cosmetic. Failing to load branding must never block
      // the sign-in form, so the error is swallowed rather than surfaced.
      .catch(() => {
        if (active) setSettings(null);
      });

    return () => {
      active = false;
    };
  }, []);

  return settings;
}
