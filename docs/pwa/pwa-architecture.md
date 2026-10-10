# PWA Architecture

Installability, the service worker, and the cache strategy. The offline
_behaviour_ — what happens to a loan recorded without a network — is in
[Offline strategy](./offline-strategy.md).

Current state: the app shell, the manifest, and the service worker are
implemented. Feature routes are not, so the PWA currently proves installability
and connectivity rather than delivering a working catalogue.

## Files

```
apps/frontend/
├── public/
│   ├── manifest.webmanifest     installability metadata
│   ├── sw.js                    app-shell cache
│   ├── icon.svg                 any-purpose icon
│   └── icon-maskable.svg        maskable icon (adaptive icon safe zone)
├── index.html                   theme-color, manifest link, apple meta tags
└── src/
    ├── main.tsx                 entry
    ├── App.tsx                  providers; router mounted
    └── lib/api.ts               typed client, envelope, CSRF, refresh-and-retry
```

The service worker is a **plain `.js` file in `public/`**, not a bundled module.
That is a deliberate choice: a hand-written file is reviewable in a diff, and the
caching rules in it are security-relevant behaviour that a build step should not
be able to transform out from under review.

## The manifest

```json
{
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#fbfaf7",
  "theme_color": "#1f4d3f",
  "categories": ["education", "productivity"],
  "icons": [ …, "purpose": "maskable" … ]
}
```

| Field                 | Why                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id: "/"`             | The stable identity. Without it, a change to `start_url` makes the browser treat the app as a _different_ app and reinstall it alongside the old one. |
| `display: standalone` | No browser chrome; this is the point of installing                                                                                                    |
| `start_url: "/"`      | Root, which is the dashboard route                                                                                                                    |
| `scope: "/"`          | Matches `start_url`; the whole origin is in scope                                                                                                     |
| `theme_color`         | The browser UI colour. Matches `<meta name="theme-color">` in `index.html`, so the address bar does not flash on install                              |
| `background_color`    | The splash colour, visible while the bundle loads                                                                                                     |
| `categories`          | Store classification                                                                                                                                  |

`index.html` additionally carries `viewport-fit=cover` for notched devices, and
the `apple-mobile-web-app-*` and `apple-touch-icon` meta tags for iOS, which
still needs them.

**One caveat on those tags.** `apple-touch-icon` points at `icon.svg`, and iOS
does not render an SVG there — it expects a PNG. On iOS the home-screen icon
therefore falls back to a screenshot of the page. The PNG fallbacks are listed
under [Roadmap](../roadmap.md#named-gaps); the tags themselves are correct and
should stay.

### `orientation: portrait-primary`, and a known conflict

The manifest pins portrait. Circulation desks are frequently tablets mounted in
landscape or a laptop, and a forced portrait on a staff device is a real
usability problem.

It is left as-is because this document records the design, and changing
orientation is a product decision rather than an architecture one. Flagged for
that decision in [Roadmap](../roadmap.md).

### A known inconsistency: shortcut targets

```json
"shortcuts": [
  { "name": "Catalogue search", "url": "/catalogue" },
  { "name": "My loans",          "url": "/loans" }
]
```

**Neither `/catalogue` nor `/loans` is an implemented route.** Both fall through to the router's `*` catch-all, which renders the in-app 404 page inside the signed-in shell.

The shortcuts are not harmful — a member tapping "My loans" gets a real 404 page with working navigation rather than a blank screen — but they are misleading: the launcher offers a promise the app cannot keep.

This is recorded rather than silently removed, because the shortcuts are correct
for the target application and the routes are simply not built yet. They become
accurate when the catalogue and loan modules land; removing them now would mean
re-adding them later. Tracked in [Roadmap](../roadmap.md).

## The service worker

`public/sw.js`, cache name `lms-shell-v1`.

### The rule it exists to enforce

> **`/api/**` is NEVER cached.\*\*

Not cached-first, not stale-while-revalidate. Never.

The reasoning, from the file header: member balances, loan records, and fines are
personal and branch-scoped. A stale cache entry on a shared device at a
circulation desk would show one member another's state, or resurrect a loan that
has already been returned. Money and circulation state are fetched live or not at
all.

This is a security property as much as a correctness one, which is why the worker
is a reviewable plain file rather than a bundled one.

`fetch` returns early — no `respondWith` — for `/api/`, `/health`, and `/ready`.
No strategy is applied, so the browser's normal network path handles them.

### What is cached

| Request                          | Strategy                                            | Reason                                                                                  |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Navigations (`mode: 'navigate'`) | **network-first**, falling back to the cached shell | A new deploy is picked up immediately; the fallback only applies when genuinely offline |
| `/assets/**` (content-hashed)    | **cache-first**                                     | Immutable by construction, so the cache can never be stale                              |
| Everything else                  | not intercepted                                     | No catch-all                                                                            |

`APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']`

Only same-origin `GET` is considered. A cross-origin request or any non-`GET`
returns immediately.

### Why only `/assets/` is cache-first

Vite emits content-hashed filenames, so `/assets/index-a1b2c3.js` can never
change meaning. Caching it forever is safe, and a new deploy produces new
filenames that miss the cache automatically.

A cache-first strategy on anything _not_ content-hashed would pin an old bundle
indefinitely — the classic stale-PWA bug, and the reason the path is checked
rather than assuming.

### Why navigation is network-first

A librarian at a branch desk with flaky connectivity needs the app to open. But
pinning the shell to a cached version means a security fix or a bug fix never
reaches anyone who already installed the app.

Network-first with a cache fallback gets both: current whenever there is a
network, openable when there is not.

### Lifecycle

| Event      | Behaviour                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`  | Precache the shell. A failed cache is swallowed — `.catch(() => undefined)` — so one unreachable asset cannot block activation forever. Then `skipWaiting()`. |
| `activate` | Delete every cache whose name is not `CACHE_VERSION`, then `clients.claim()`.                                                                                 |
| `message`  | `SKIP_WAITING` for an in-app "update available" prompt.                                                                                                       |

Bumping `CACHE_VERSION` is the deploy mechanism: `activate` deletes the old
cache on the next load. Without `skipWaiting`, a new worker would sit waiting
until every tab closed, and a long-lived circulation desk tab might never pick
it up.

## Update handling

The `SKIP_WAITING` message exists so the app can offer an explicit
"a new version is available — reload" prompt. The alternative — reloading
underneath someone mid-transaction — is worse; a librarian who loses a
half-completed form because the page reloaded will blame the software.

The notification belongs in the app shell, driven by `registration.onupdatefound`.

## Installability requirements

| Requirement                         | Status                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| HTTPS (or localhost)                | Deployment responsibility — see [Deployment](../operations/deployment.md) |
| `manifest.webmanifest` linked       | yes                                                                       |
| `name` and `short_name`             | yes                                                                       |
| `start_url`                         | `/`                                                                       |
| `display: standalone`               | yes                                                                       |
| Icon 192px or larger                | `icon.svg` with `sizes: "any"`                                            |
| Maskable icon                       | `icon-maskable.svg`                                                       |
| Service worker with a fetch handler | yes                                                                       |

SVG with `sizes: "any"` satisfies the icon requirement. PNG fallbacks are listed
in the roadmap: some older Android launchers and enterprise MDM policies do not
render SVG icons reliably.

## Registration

The service worker registers from `main.tsx` in production only — a worker
caching assets in development produces confusing stale-bundle behaviour that
looks like a build problem.

`vite.config.ts` proxies `/api` to the backend in development, so the frontend is
same-origin in dev too and cookies behave exactly as they will in production.
This matters: a split-origin development setup exercises a different cookie and
CORS path from the real deployment, and that difference is where "works locally,
fails in production" bugs come from.

## Accessibility

Installability is not accessibility, and a PWA that is only usable on a phone is
not a PWA for a library. Circulation is prioritised for touch, but:

- the app works from 360 px to ultrawide;
- every interactive target is at least 44 × 44 px;
- status is never conveyed by colour alone — the connectivity indicator in
  Every status badge pairs a colour with a word, and loading regions announce themselves;
- focus is visible, and focus order follows the DOM;
- forms have real `<label>` elements;
- motion respects `prefers-reduced-motion`.

See [Testing strategy](../engineering/testing-strategy.md#accessibility-testing).

## What the PWA does not do

| Not implemented             | Why                                                   | Status                                                     |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| Offline data caching        | The danger above                                      | Deliberate — see [Offline strategy](./offline-strategy.md) |
| Background sync             | No offline writes to sync yet                         | Schema exists; no client ships against it in V1            |
| Push notifications          | Notification table exists; `channel` carries the enum | Provider registration is additive                          |
| Install prompt UI           | The browser's own prompt is adequate                  | Deferred                                                   |
| Periodic background refresh | Nothing to refresh offline                            | Deferred                                                   |

The app shell exists so that installability and offline-open are proven now,
without committing to an offline data model that would have to be revised the
moment the circulation rules were written.

## Related

- [Offline strategy](./offline-strategy.md)
- [Frontend structure](../architecture.md#frontend-folder-structure)
- [Deployment](../operations/deployment.md) — HTTPS and static hosting
