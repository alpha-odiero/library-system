import { useEffect } from 'react';

/**
 * Per-page SEO directives for the SPA shell.
 *
 * `index.html` ships the marketing landing page's metadata (title, description,
 * canonical `/welcome`, `index, follow`) as the static default for every route,
 * because a single-page app has one HTML file. Those defaults are correct only
 * for the landing page. The sign-in flows and the signed-in application must not
 * appear in search engines, so the layouts that render them apply
 * `noindex, follow` here and restore the shell defaults when they unmount.
 */

interface Meta {
  title: string;
  robots: string;
  description: string;
  canonical: string;
}

/*
 * Captured once, at first evaluation of this module: React has not mutated the
 * DOM yet, so this is exactly what `index.html` declared — the landing page's
 * metadata. Restoring these values on unmount is what keeps the landing page
 * indexable after a visitor has been through a noindexed screen.
 */
const SHELL: Meta = {
  title: document.title,
  robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? 'index, follow',
  description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
  canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '/welcome',
};

function setMeta(name: string, content: string): void {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Applies the page's directives and restores the landing page defaults on
 * unmount, so a visitor returning to `/welcome` is always indexable again.
 * The landing page's own title carries the brand, so callers pass final titles.
 */
export function usePageMeta(meta: { robots?: string; title?: string }): void {
  const { robots, title } = meta;

  useEffect(() => {
    if (title) document.title = title;
    if (robots) setMeta('robots', robots);
    return () => {
      document.title = SHELL.title;
      setMeta('robots', SHELL.robots);
      setMeta('description', SHELL.description);
      const link = document.querySelector('link[rel="canonical"]');
      if (link) link.setAttribute('href', SHELL.canonical);
    };
  }, [robots, title]);
}