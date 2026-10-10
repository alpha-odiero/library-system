import type { ReactNode } from 'react';

/**
 * The icon set.
 *
 * Every glyph is drawn on the same 24×24 grid with a 2px round-capped stroke, so
 * icons from different modules sit on the same optical baseline. The geometry is
 * hand-inlined rather than imported from a package for two reasons:
 *
 *   • The bundle. A full icon library is several hundred kilobytes of path data
 *     for the ~50 glyphs this product actually uses, most of it never rendered.
 *   • Consistency. One file is one grid and one stroke weight. Icons pulled from
 *     three libraries eventually disagree on both, and that reads as "template".
 *
 * Subpaths are drawn with `.01` stubs (e.g. `M3 6h.01`) to produce round dots —
 * that is how a `<circle>` becomes a path, so every glyph is one `<path>`.
 *
 * `name` is a union, not `string`. A typo is a compile error rather than an empty
 * box that ships and is noticed only by the person it hides an action behind.
 */
export type IconName =
  /* Navigation */
  | 'dashboard'
  | 'books'
  | 'copies'
  | 'authors'
  | 'categories'
  | 'publishers'
  | 'loans'
  | 'returns'
  | 'reservations'
  | 'fines'
  | 'payments'
  | 'members'
  | 'memberTypes'
  | 'reports'
  | 'analytics'
  | 'users'
  | 'roles'
  | 'branches'
  | 'locations'
  | 'auditLog'
  | 'settings'
  | 'profile'
  | 'logout'
  /* Interface */
  | 'search'
  | 'menu'
  | 'close'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'plus'
  | 'download'
  | 'upload'
  | 'scan'
  | 'refresh'
  | 'filter'
  | 'grid'
  | 'list'
  | 'arrowRight'
  | 'externalLink'
  | 'trendingUp'
  | 'calendar'
  | 'clock'
  | 'alert'
  | 'check'
  | 'megaphone'
  | 'home'
  | 'sun'
  | 'moon'
  | 'key'
  | 'mail'
  | 'eye'
  | 'eyeOff'
  | 'percent'
  | 'inbox'
  | 'layers'
  | 'fileText'
  | 'activity'
  | 'moreHorizontal'
  | 'wallet'
  | 'copy'
  | 'bookPlus'
  | 'userPlus'
  | 'arrowRightLeft';

type IconTone = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'yellow' | 'pink' | 'slate';

const ICON_TONES: Partial<Record<IconName, IconTone>> = {
  dashboard: 'blue',
  books: 'blue',
  copies: 'blue',
  authors: 'blue',
  categories: 'blue',
  publishers: 'blue',
  bookPlus: 'blue',
  loans: 'purple',
  returns: 'purple',
  reservations: 'orange',
  fines: 'red',
  payments: 'red',
  wallet: 'red',
  percent: 'red',
  members: 'green',
  memberTypes: 'green',
  users: 'green',
  userPlus: 'green',
  reports: 'yellow',
  analytics: 'yellow',
  calendar: 'pink',
  alert: 'red',
  megaphone: 'blue',
  inbox: 'blue',
  profile: 'green',
  arrowRightLeft: 'purple',
  clock: 'pink',
};

/** Path data per glyph. Several entries are separate subpaths. */
const GLYPHS: Record<IconName, readonly string[]> = {
  /* Navigation */
  dashboard: [
    'M3.5 3.5h6.5v6.5H3.5z',
    'M14 3.5h6.5v6.5H14z',
    'M14 14h6.5v6.5H14z',
    'M3.5 14h6.5v6.5H3.5z',
  ],
  books: [
    'M12 7.2v13.3',
    'M3.2 18.4a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1h4.6A4.6 4.6 0 0 1 12.4 8a4.6 4.6 0 0 1 4.6-4.6h4.8a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5.6a3 3 0 0 0-2.2.9 3 3 0 0 0-2.2-.9z',
  ],
  copies: [
    'm3.5 6.5 8.5-3.2 8.5 3.2-8.5 3.2z',
    'M3.5 12.2l8.5 3.2 8.5-3.2',
    'M3.5 17.5l8.5 3.2 8.5-3.2',
  ],
  authors: [
    'M15.5 20.5v-1.8a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8v1.8',
    'M9 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2',
    'M21.5 20.5v-1.8a3.8 3.8 0 0 0-2.9-3.7',
    'M15.6 4.5a3.6 3.6 0 0 1 0 7',
  ],
  categories: [
    'M3.5 6.2a1.7 1.7 0 0 1 1.7-1.7h3.4a1.7 1.7 0 0 1 1.3.6l1 1.3h8.5a1.7 1.7 0 0 1 1.7 1.7v9.7a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z',
  ],
  publishers: [
    'M5 21.5V4.2a1.7 1.7 0 0 1 1.7-1.7h10.6A1.7 1.7 0 0 1 19 4.2v17.3',
    'M2.5 21.5h19',
    'M9.5 6.5h5',
    'M9.5 10.5h5',
    'M9.5 14.5h5',
    'M9.5 18h3',
  ],
  loans: ['m7.5 4.5-3.5 3.5 3.5 3.5', 'M4 8h13', 'm16.5 19.5 3.5-3.5-3.5-3.5', 'M20 16H7'],
  returns: ['m4 9.5 5.5-5.5L15 9.5', 'M4 9.5h9.5a5.5 5.5 0 0 1 0 11H10'],
  reservations: ['M19 21.5 12 16l-7 5.5V5.2a1.7 1.7 0 0 1 1.7-1.7h10.6A1.7 1.7 0 0 1 19 5.2z'],
  fines: [
    'M5.5 2.5h13v19l-2.2-1.3-2.1 1.3-2.2-1.3-2.1 1.3-2.2-1.3-2.2 1.3z',
    'M9 8h6',
    'M9 12h6',
    'M9 16h4',
  ],
  payments: [
    'M2.8 7.5a1.9 1.9 0 0 1 1.9-1.9h14.6a1.9 1.9 0 0 1 1.9 1.9v9a1.9 1.9 0 0 1-1.9 1.9H4.7a1.9 1.9 0 0 1-1.9-1.9z',
    'M2.8 10.6h18.4',
    'M6.2 14.6h3.4',
  ],
  members: [
    'M19.5 20.5v-1.8a3.8 3.8 0 0 0-3.8-3.8H8.3a3.8 3.8 0 0 0-3.8 3.8v1.8',
    'M12 11.5a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6',
  ],
  memberTypes: [
    'M2.8 5.6a1.8 1.8 0 0 1 1.8-1.8h14.8a1.8 1.8 0 0 1 1.8 1.8v12.8a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8z',
    'M7 9.2h.01',
    'M11 9.2h.01',
    'M15 9.2h.01',
    'M7 14.8h8',
  ],
  reports: [
    'M14 2.8H6.5a1.9 1.9 0 0 0-1.9 1.9v14.6a1.9 1.9 0 0 0 1.9 1.9h11a1.9 1.9 0 0 0 1.9-1.9V7.3z',
    'M14 2.8v4.5h4.4',
    'M8.5 13h7',
    'M8.5 17h5',
    'M8.5 9h2',
  ],
  analytics: [
    'M4.5 3.2v15.3a1.9 1.9 0 0 0 1.9 1.9h15.1',
    'M17.5 17.4V9.8',
    'M12.7 17.4v-4.6',
    'M8 17.4v-8.2',
  ],
  users: [
    'M17.5 20.5v-1.8a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8v1.8',
    'M10 11.5a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6',
    'M21.5 20.5v-1.8a3.8 3.8 0 0 0-2.9-3.7',
    'M15.6 4.5a3.8 3.8 0 0 1 0 7.1',
  ],
  roles: ['M12 2.6 4 5.7v6c0 4.6 3.3 8.6 8 9.7 4.7-1.1 8-5.1 8-9.7v-6z', 'm9.2 11.8 2 2 3.6-3.8'],
  branches: [
    'M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2',
    'M12 2.6v4.8',
    'M12 16.6v4.8',
    'M2.6 12h4.8',
    'M16.6 12h4.8',
  ],
  locations: [
    'M20 10.4c0 5.9-8 11.9-8 11.9s-8-6-8-11.9a8 8 0 0 1 16 0',
    'M12 13.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  ],
  auditLog: [
    'M9 4.8H6.5a1.9 1.9 0 0 0-1.9 1.9v13.4a1.9 1.9 0 0 0 1.9 1.9h11a1.9 1.9 0 0 0 1.9-1.9V6.7a1.9 1.9 0 0 0-1.9-1.9H15',
    'M9.5 2.8h5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1',
    'M8.6 12.2h6.8',
    'M8.6 16.4h6.8',
  ],
  settings: [
    'M20.6 4.4h-6.8',
    'M9.6 4.4H3.4',
    'M20.6 12h-8.4',
    'M8 12H3.4',
    'M20.6 19.6h-4.6',
    'M11.8 19.6H3.4',
    'M13.8 2.6v3.6',
    'M8 10.2v3.6',
    'M16 17.8v3.6',
  ],
  profile: [
    'M19.5 20.5v-1.8a4.3 4.3 0 0 0-4.3-4.3H8.8a4.3 4.3 0 0 0-4.3 4.3v1.8',
    'M12 11.1a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2',
  ],
  logout: [
    'M9.4 20.6H5.2a1.9 1.9 0 0 1-1.9-1.9V5.3a1.9 1.9 0 0 1 1.9-1.9h4.2',
    'm15.8 16.6 4.6-4.6-4.6-4.6',
    'M20.4 12H9.2',
  ],

  /* Interface */
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.4-4.4'],
  menu: ['M3.8 6.4h16.4', 'M3.8 12h16.4', 'M3.8 17.6h16.4'],
  close: ['m18 6-12 12', 'm6 6 12 12'],
  chevronDown: ['m6.5 9.4 5.5 5.5 5.5-5.5'],
  chevronRight: ['m9.4 6.5 5.5 5.5-5.5 5.5'],
  chevronLeft: ['m14.6 6.5-5.5 5.5 5.5 5.5'],
  plus: ['M4.8 12h14.4', 'M12 4.8v14.4'],
  download: [
    'M21 15.4v3.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.8v-3.4',
    'm7.2 10.4 4.8 4.8 4.8-4.8',
    'M12 15.2V3.4',
  ],
  upload: [
    'M21 15.4v3.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.8v-3.4',
    'm16.8 7.6-4.8-4.8-4.8 4.8',
    'M12 2.8v11.8',
  ],
  scan: [
    'M3.4 7.4V5.4a2 2 0 0 1 2-2h2',
    'M16.6 3.4h2a2 2 0 0 1 2 2v2',
    'M20.6 16.6v2a2 2 0 0 1-2 2h-2',
    'M7.4 20.6h-2a2 2 0 0 1-2-2v-2',
    'M6.6 12h10.8',
  ],
  refresh: [
    'M20.4 4.4v4.9h-4.9',
    'M3.6 19.6v-4.9h4.9',
    'M5.7 9.1a7 7 0 0 1 11.6-2.6l3.1 2.8',
    'M18.3 14.9a7 7 0 0 1-11.6 2.6L3.6 14.7',
  ],
  filter: ['M21.2 3.4H2.8l7.6 9v6.5l3.2 1.8v-8.3z'],
  grid: [
    'M3.8 3.8h6.4v6.4H3.8z',
    'M13.8 3.8h6.4v6.4h-6.4z',
    'M13.8 13.8h6.4v6.4h-6.4z',
    'M3.8 13.8h6.4v6.4H3.8z',
  ],
  list: ['M8.4 6h12.2', 'M8.4 12h12.2', 'M8.4 18h12.2', 'M3.6 6h.01', 'M3.6 12h.01', 'M3.6 18h.01'],
  arrowRight: ['M4.6 12h14.8', 'm13.4 6 6 6-6 6'],
  externalLink: [
    'M17.6 13.4v5.4a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8V8.2a1.8 1.8 0 0 1 1.8-1.8h5.4',
    'M14.4 3.4h6.2v6.2',
    'M20.6 3.4 11 13',
  ],
  trendingUp: ['M16 6.6h5.4V12', 'M21.4 6.6 12.6 15.4l-4.4-4.4-5.6 5.6'],
  calendar: [
    'M8.2 2.6v4',
    'M15.8 2.6v4',
    'M3.4 10.4h17.2',
    'M5.4 4.4h13.2a2 2 0 0 1 2 2v12.2a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V6.4a2 2 0 0 1 2-2',
  ],
  clock: ['M12 6.6V12l3.4 1.8', 'M12 21.4a9.4 9.4 0 1 0 0-18.8 9.4 9.4 0 0 0 0 18.8'],
  alert: [
    'm21.3 18.4-7.7-13.6a1.9 1.9 0 0 0-3.2 0L2.7 18.4a1.9 1.9 0 0 0 1.6 2.9h15.4a1.9 1.9 0 0 0 1.6-2.9',
    'M12 9.2v4.2',
    'M12 17.2h.01',
  ],
  check: ['M21.4 11.1V12a9.4 9.4 0 1 1-5.6-8.6', 'm21.4 4.4-10 10-2.9-2.9'],
  megaphone: ['m3.2 11.2 17.6-5v11.6l-17.6-5z', 'M11.4 16.6a2.9 2.9 0 1 1-5.6-1.5'],
  home: [
    'm3.4 9.4 8.6-6.8 8.6 6.8v9.4a1.9 1.9 0 0 1-1.9 1.9H5.3a1.9 1.9 0 0 1-1.9-1.9z',
    'M9.2 21.4V12.2h5.6v9.2',
  ],
  sun: [
    'M12 2.4v2.2',
    'M12 19.4v2.2',
    'M4.6 4.6l1.6 1.6',
    'M17.8 17.8l1.6 1.6',
    'M2.4 12h2.2',
    'M19.4 12h2.2',
    'M4.6 19.4l1.6-1.6',
    'M17.8 6.2l1.6-1.6',
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  ],
  moon: ['M12.4 3.2a8.8 8.8 0 1 0 8.4 11.2A7.2 7.2 0 0 1 12.4 3.2'],
  key: [
    'M2.6 17.4A1.9 1.9 0 0 0 2 18.8v1.4a.8.8 0 0 0 .8.8h2.6a.8.8 0 0 0 .8-.8v-1a.8.8 0 0 1 .8-.8h1a.8.8 0 0 0 .8-.8v-1a.8.8 0 0 1 .8-.8h.2a1.9 1.9 0 0 0 1.3-.6l.8-.8a6.4 6.4 0 1 0-3.9-3.9',
    'm16.4 7.4h.01',
  ],
  mail: [
    'M21.2 7.2v9.6a1.9 1.9 0 0 1-1.9 1.9H4.7a1.9 1.9 0 0 1-1.9-1.9V7.2a1.9 1.9 0 0 1 1.9-1.9h14.6a1.9 1.9 0 0 1 1.9 1.9',
    'm21.2 7.4-9.6 5.8-9.6-5.8',
  ],
  eye: [
    'M2.2 12S5.2 5.4 12 5.4 21.8 12 21.8 12 18.8 18.6 12 18.6 2.2 12 2.2 12',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  ],
  percent: [
    'M19 5 5 19',
    'M6.6 9.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2',
    'M17.4 20a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2',
  ],
  inbox: [
    'M21.6 12h-5.4l-1.8 2.6H9.6L7.8 12H2.4',
    'M5.5 5.2 2.4 12v5.8a1.9 1.9 0 0 0 1.9 1.9h15.4a1.9 1.9 0 0 0 1.9-1.9V12l-3.1-6.8a1.9 1.9 0 0 0-1.7-1.1H7.2a1.9 1.9 0 0 0-1.7 1.1',
  ],
  layers: ['m12 2.9 8.9 4-8.9 4-8.9-4z', 'm3.1 11.5 8.9 4 8.9-4', 'm3.1 16.1 8.9 4 8.9-4'],
  fileText: [
    'M14 2.8H6.5a1.9 1.9 0 0 0-1.9 1.9v14.6a1.9 1.9 0 0 0 1.9 1.9h11a1.9 1.9 0 0 0 1.9-1.9V7.3z',
    'M14 2.8v4.5h4.4',
    'M8.6 13h6.8',
    'M8.6 16.6h6.8',
    'M8.6 9.4h2.6',
  ],
  activity: [
    'M21.6 12h-3.4a2 2 0 0 0-1.9 1.5l-2.4 8.3a.3.3 0 0 1-.6 0L9.6 2.9a.3.3 0 0 0-.6 0L6.7 11.2A2 2 0 0 1 4.8 12H2.4',
  ],
  moreHorizontal: ['M6.4 12h.01', 'M12 12h.01', 'M17.6 12h.01'],

  /* Actions */
  wallet: [
    'M2.8 7.5a1.9 1.9 0 0 1 1.9-1.9h14.6a1.9 1.9 0 0 1 1.9 1.9v9a1.9 1.9 0 0 1-1.9 1.9H4.7a1.9 1.9 0 0 1-1.9-1.9z',
    'M2.8 10.6h18.4',
    'M16.4 14.6h1.4',
  ],
  copy: [
    'M9.2 9.2h9.1a1.7 1.7 0 0 1 1.7 1.7v9.1a1.7 1.7 0 0 1-1.7 1.7H9.2a1.7 1.7 0 0 1-1.7-1.7v-9.1a1.7 1.7 0 0 1 1.7-1.7z',
    'M5.7 15.4h-1a1.7 1.7 0 0 1-1.7-1.7V4.6A1.7 1.7 0 0 1 4.7 2.9h9.1a1.7 1.7 0 0 1 1.7 1.7v1',
  ],
  bookPlus: [
    'M4.2 4.7a1.6 1.6 0 0 1 1.6-1.6h4a3.8 3.8 0 0 1 3.8 3.8v12.7a2.9 2.9 0 0 0-2.9-2.9H4.2z',
    'M20.6 8.4v6',
    'M17.6 11.4h6',
  ],
  userPlus: [
    'M14.6 20.5v-1.8a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8v1.8',
    'M8.5 11.5a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6',
    'M19.4 7.6v6',
    'M16.4 10.6h6',
  ],
  arrowRightLeft: [
    'M3.6 8.4h15.2',
    'm15.6 5.2 3.2 3.2-3.2 3.2',
    'M20.4 15.6H5.2',
    'm8.4 12.4-3.2 3.2 3.2 3.2',
  ],

  /*
   * The eye glyphs share a lens outline with `eye` and differ only in the strike.
   * Reusing the same path for both is what makes the toggle read as one control
   * flipping state, rather than two unrelated pictures swapping.
   */
  eyeOff: [
    'M2.2 12S5.2 5.4 12 5.4 21.8 12 21.8 12 18.8 18.6 12 18.6 2.2 12 2.2 12',
    'M9.9 6.2A8.9 8.9 0 0 1 12 5.4c6.8 0 9.8 6.6 9.8 6.6a17 17 0 0 1-2.5 3.4',
    'M6.2 8.1A16.6 16.6 0 0 0 2.2 12s3 6.6 9.8 6.6a9 9 0 0 0 3.6-.7',
    'M3.5 3.5l17 17',
  ],
};

/**
 * One icon, at one size.
 *
 * `size` is in pixels and defaults to 16 — the navigation size. Stat icons pass
 * 18, hero and empty-state illustrations larger. Sizing is set through `width` and
 * `height` attributes rather than CSS so an icon never depends on a stylesheet
 * having loaded, and never inherits a font-size by accident.
 *
 * Icons are always `aria-hidden`. An icon inside a labelled control is decoration,
 * and announcing it produces "books, Books, link" — the accessible name is the
 * text beside it. An icon that is the *only* content needs a label on its
 * control, which is the caller's job, not the icon's.
 */
export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}): ReactNode {
  return (
    <svg
      className={['icon', `icon--${ICON_TONES[name] ?? 'slate'}`, className]
        .filter(Boolean)
        .join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
