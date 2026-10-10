import { useEffect, useState } from 'react';

/** Org details from `GET /settings/public`. Only the three a signed-out visitor needs. */
interface PublicSettings {
  'org.name'?: string;
  'org.email'?: string;
  'org.phone'?: string;
}

export function usePublicSettings(): PublicSettings | null {
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Imported lazily to keep this hook out of the module graph of every page
    // that happens to render an organisation name.
    void import('../features/settings/api')
      .then(({ getPublicSettings }) => getPublicSettings(controller.signal))
      .then((response) => setSettings(response.data))
      // A missing name is cosmetic. Failing to load branding must never block
      // the sign-in form, so the error is swallowed rather than surfaced.
      .catch(() => setSettings(null));

    return () => controller.abort();
  }, []);

  return settings;
}
