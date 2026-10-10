/**
 * Sample catalogue.
 *
 * Modest size by design: enough to exercise search, multi-author joins,
 * category hierarchy, multi-copy inventory, and every circulation state, without
 * making a developer's first `migrate reset` slow. Load generators for realistic
 * volume live in `prisma/seed/load-generator.ts`.
 */

export interface AuthorSeed {
  name: string;
  sortName: string;
  nationality?: string;
  birthYear?: number;
}

export const AUTHORS: readonly AuthorSeed[] = [
  {
    name: 'Robert C. Martin',
    sortName: 'Martin, Robert C.',
    nationality: 'American',
    birthYear: 1956,
  },
  { name: 'Martin Fowler', sortName: 'Fowler, Martin', nationality: 'British', birthYear: 1963 },
  { name: 'Erich Gamma', sortName: 'Gamma, Erich', nationality: 'Swiss', birthYear: 1961 },
  { name: 'Richard Helm', sortName: 'Helm, Richard', nationality: 'American' },
  { name: 'Ralph Johnson', sortName: 'Johnson, Ralph', nationality: 'American' },
  { name: 'John V. Guttag', sortName: 'Guttag, John V.', nationality: 'American', birthYear: 1949 },
  { name: 'Donald Knuth', sortName: 'Knuth, Donald E.', nationality: 'American', birthYear: 1938 },
  {
    name: 'Bjarne Stroustrup',
    sortName: 'Stroustrup, Bjarne',
    nationality: 'Danish',
    birthYear: 1950,
  },
  {
    name: 'George R. R. Martin',
    sortName: 'Martin, George R. R.',
    nationality: 'American',
    birthYear: 1948,
  },
  {
    name: "Ngũgĩ wa Thiong'o",
    sortName: "Thiong'o, Ngũgĩ wa",
    nationality: 'Kenyan',
    birthYear: 1938,
  },
  { name: 'Chinua Achebe', sortName: 'Achebe, Chinua', nationality: 'Nigerian', birthYear: 1930 },
  { name: 'Wole Soyinka', sortName: 'Soyinka, Wole', nationality: 'Nigerian', birthYear: 1934 },
  { name: 'J. K. Rowling', sortName: 'Rowling, J. K.', nationality: 'British', birthYear: 1965 },
  { name: 'Ibrahim al-Koni', sortName: 'al-Koni, Ibrahim', nationality: 'Libyan', birthYear: 1948 },
  { name: 'Paulo Coelho', sortName: 'Coelho, Paulo', nationality: 'Brazilian', birthYear: 1947 },
  { name: 'Thomas H. Cormen', sortName: 'Cormen, Thomas H.', nationality: 'American' },
  { name: 'Charles E. Leiserson', sortName: 'Leiserson, Charles E.', nationality: 'American' },
];

export const PUBLISHERS: readonly {
  name: string;
  country?: string;
  website?: string;
}[] = [
  { name: 'Prentice Hall', country: 'United States', website: 'https://www.pearson.com' },
  { name: 'Addison-Wesley', country: 'United States', website: 'https://www.pearson.com' },
  { name: "O'Reilly Media", country: 'United States', website: 'https://www.oreilly.com' },
  { name: 'MIT Press', country: 'United States', website: 'https://mitpress.mit.edu' },
  { name: 'Cambridge University Press', country: 'United Kingdom' },
  { name: 'Faber & Faber', country: 'United Kingdom' },
  { name: 'Heinemann', country: 'United Kingdom' },
  { name: 'Hamish Hamilton', country: 'United Kingdom' },
  { name: 'Anchor Books', country: 'United States' },
  { name: 'Penguin Modern Classics', country: 'United Kingdom' },
  { name: 'Bloomsbury', country: 'United Kingdom' },
  { name: 'HarperTorch', country: 'United States' },
  { name: 'East African Educational Publishers', country: 'Kenya' },
];

export interface CategorySeed {
  name: string;
  slug: string;
  parentSlug?: string;
  description?: string;
}

export const CATEGORIES: readonly CategorySeed[] = [
  {
    name: 'Computing',
    slug: 'computing',
    description: 'Computer science, software engineering, and computing theory',
  },
  { name: 'Software Engineering', slug: 'software-engineering', parentSlug: 'computing' },
  { name: 'Programming Languages', slug: 'programming-languages', parentSlug: 'computing' },
  { name: 'Algorithms', slug: 'algorithms', parentSlug: 'computing' },
  { name: 'Databases', slug: 'databases', parentSlug: 'computing' },
  { name: 'Operating Systems', slug: 'operating-systems', parentSlug: 'computing' },
  { name: 'Security', slug: 'security', parentSlug: 'computing' },

  { name: 'Literature', slug: 'literature', description: 'Literary works and criticism' },
  { name: 'Fiction', slug: 'fiction', parentSlug: 'literature' },
  { name: 'Science Fiction & Fantasy', slug: 'science-fiction-fantasy', parentSlug: 'fiction' },
  { name: 'African Literature', slug: 'african-literature', parentSlug: 'fiction' },

  { name: 'History', slug: 'history', description: 'Historical scholarship' },
  { name: 'Technology', slug: 'technology', parentSlug: 'history' },

  { name: 'Science', slug: 'science' },
  { name: 'Mathematics', slug: 'mathematics', parentSlug: 'science' },
  {
    name: 'Reference',
    slug: 'reference',
    description: 'Dictionaries, encyclopaedias, and indexes — reference only',
  },
];

export interface BookSeed {
  title: string;
  subtitle?: string;
  isbn13: string;
  isbn10?: string;
  publisher: string;
  publicationYear: number;
  edition?: string;
  language?: string;
  pageCount?: number;
  callNumber: string;
  /** Author references by exact name. */
  authors: readonly string[];
  categorySlugs: readonly string[];
  tags?: readonly string[];
  description: string;
  summary: string;
  isReferenceOnly?: boolean;
}

export const BOOKS: readonly BookSeed[] = [
  {
    title: 'Clean Code',
    subtitle: 'A Handbook of Agile Software Craftsmanship',
    isbn13: '9780132350884',
    isbn10: '0132350882',
    publisher: 'Prentice Hall',
    publicationYear: 2008,
    edition: '1st',
    pageCount: 464,
    callNumber: '005.7 MAR',
    authors: ['Robert C. Martin'],
    categorySlugs: ['software-engineering'],
    tags: ['best-seller', 'clean-code'],
    description:
      "A craftsman's guide to writing readable, maintainable code, organised around the principle that code is the most expensive thing a team ever produces.",
    summary: 'Guidance on writing software that other humans can read and change.',
  },
  {
    title: 'Refactoring',
    subtitle: 'Improving the Design of Existing Code',
    isbn13: '9780134757599',
    isbn10: '0134757599',
    publisher: 'Addison-Wesley',
    publicationYear: 2018,
    edition: '2nd',
    pageCount: 448,
    callNumber: '005.7 FOW',
    authors: ['Martin Fowler'],
    categorySlugs: ['software-engineering'],
    tags: ['refactoring'],
    description:
      'A catalogue of refactorings with the behaviour-preserving transformations that make restructuring safe.',
    summary: 'Techniques for improving the design of code you did not write.',
  },
  {
    title: 'Design Patterns',
    subtitle: 'Elements of Reusable Object-Oriented Software',
    isbn13: '9780201633610',
    isbn10: '0201633612',
    publisher: 'Addison-Wesley',
    publicationYear: 1994,
    pageCount: 395,
    callNumber: '005.7 GAM',
    authors: ['Erich Gamma', 'Richard Helm', 'Ralph Johnson', 'John V. Guttag'],
    categorySlugs: ['software-engineering'],
    tags: ['gof', 'patterns'],
    description:
      'The Gang of Four catalogue that established the vocabulary of object-oriented design.',
    summary: 'Twenty-three foundational patterns and the forces they resolve.',
  },
  {
    title: 'The Art of Computer Programming',
    subtitle: 'Volume 1: Fundamental Algorithms',
    isbn13: '9780201895411',
    isbn10: '0201895416',
    publisher: 'Addison-Wesley',
    publicationYear: 1997,
    edition: '3rd',
    pageCount: 672,
    callNumber: '005.7 KNU',
    authors: ['Donald Knuth'],
    categorySlugs: ['algorithms'],
    tags: ['reference', 'knuth'],
    description:
      'The foundational volume of the multi-volume compendium on algorithm construction and analysis.',
    summary: "Volume 1 of Knuth's compendium on fundamental algorithms.",
  },
  {
    title: 'The C++ Programming Language',
    subtitle: 'Special Edition',
    isbn13: '9780321563842',
    isbn10: '0321563844',
    publisher: 'Addison-Wesley',
    publicationYear: 2004,
    edition: '3rd',
    pageCount: 976,
    callNumber: '005.7 STR',
    authors: ['Bjarne Stroustrup'],
    categorySlugs: ['programming-languages'],
    tags: ['cpp'],
    description: 'The definitive description of the language by its designer.',
    summary: 'The reference work for the C++ programming language.',
  },
  {
    title: 'A Game of Thrones',
    subtitle: 'A Song of Ice and Fire, Book One',
    isbn13: '9780441013593',
    isbn10: '0441013595',
    publisher: 'Faber & Faber',
    publicationYear: 1996,
    pageCount: 639,
    callNumber: '823.912 MAR',
    authors: ['George R. R. Martin'],
    categorySlugs: ['science-fiction-fantasy'],
    tags: ['fantasy', 'series'],
    description:
      'The first volume of the Song of Ice and Fire, depicting the contest for the Iron Throne.',
    summary: 'Noble families vie for power while an ancient threat stirs in the far North.',
  },
  {
    title: 'A Clash of Kings',
    subtitle: 'A Song of Ice and Fire, Book Two',
    isbn13: '9780570804977',
    isbn10: '0570804970',
    publisher: 'Faber & Faber',
    publicationYear: 1998,
    pageCount: 662,
    callNumber: '823.912 MAR',
    authors: ['George R. R. Martin'],
    categorySlugs: ['science-fiction-fantasy'],
    tags: ['fantasy', 'series'],
    description: 'The second volume of the Song of Ice and Fire.',
    summary: 'Several houses contest the throne as the Long Summer ends.',
  },
  {
    title: 'Wizard, Wizard',
    subtitle: 'The Nigger Wizard of Wook',
    isbn13: '9781400033136',
    isbn10: '1400033130',
    publisher: 'Hamish Hamilton',
    publicationYear: 2013,
    pageCount: 500,
    callNumber: '823.914 KON',
    authors: ['Ibrahim al-Koni'],
    categorySlugs: ['fiction'],
    tags: ['desert', 'lyrical'],
    description: 'A lyrical novella about a Tuareg hero and the mythopoetic world of the Sahara.',
    summary: 'A lyrical Saharan fable of myth, exile, and the desert.',
  },
  {
    title: 'The Alchemist',
    isbn13: '9780062315007',
    isbn10: '0062315005',
    publisher: 'HarperTorch',
    publicationYear: 2002,
    pageCount: 197,
    callNumber: '823.912 COE',
    authors: ['Paulo Coelho'],
    categorySlugs: ['fiction'],
    tags: ['bestseller'],
    description: 'A young Andalusian shepherd pursues a treasure and finds his destiny.',
    summary: 'A journey-based fable about pursuing a personal legend.',
  },
  {
    title: 'Petals of Blood',
    isbn13: '9780906895878',
    isbn10: '0906895878',
    publisher: 'Heinemann',
    publicationYear: 1996,
    pageCount: 364,
    callNumber: '823.914 THI',
    authors: ["Ngũgĩ wa Thiong'o"],
    categorySlugs: ['african-literature'],
    tags: ['kenyan', 'classic'],
    description:
      'Three generations of an idealist family in colonial Kenya, told in interwoven verse and narrative.',
    summary: 'A landmark postcolonial novel of Kenyan history.',
  },
  {
    title: 'Things Fall Apart',
    isbn13: '9780385474542',
    isbn10: '0385474548',
    publisher: 'Anchor Books',
    publicationYear: 1994,
    pageCount: 209,
    callNumber: '823.914 ACH',
    authors: ['Chinua Achebe'],
    categorySlugs: ['african-literature'],
    tags: ['classic', 'colonialism'],
    description:
      'The story of Okonkwo, a prosperous Igbo leader whose life is upended by the British colonial arrival.',
    summary: 'A defining portrayal of colonial disruption in Igbo society.',
  },
  {
    title: "Death and the King's Horseman",
    isbn13: '9780141183260',
    isbn10: '0141183265',
    publisher: 'Penguin Modern Classics',
    publicationYear: 2002,
    pageCount: 240,
    callNumber: '822.912 SOY',
    authors: ['Wole Soyinka'],
    categorySlugs: ['african-literature'],
    tags: ['drama', 'classic'],
    description: 'A play set on the day the British prepare to depose an African king.',
    summary: 'A tragic collision of tradition and colonial power.',
  },
  {
    title: "Harry Potter and the Philosopher's Stone",
    isbn13: '9780747532699',
    isbn10: '0747532699',
    publisher: 'Bloomsbury',
    publicationYear: 1997,
    pageCount: 223,
    callNumber: '823.912 ROW',
    authors: ['J. K. Rowling'],
    categorySlugs: ['science-fiction-fantasy'],
    tags: ['fantasy', 'series'],
    description: 'A boy discovers he is a wizard and begins his first year at Hogwarts.',
    summary: 'The first instalment of the Harry Potter series.',
  },
  {
    title: 'Introduction to Algorithms',
    isbn13: '9780262046305',
    isbn10: '0262046307',
    publisher: 'MIT Press',
    publicationYear: 2022,
    edition: '4th',
    pageCount: 1312,
    callNumber: '005.7 COR',
    authors: ['Thomas H. Cormen', 'Charles E. Leiserson'],
    categorySlugs: ['algorithms', 'reference'],
    tags: ['reference', 'classic'],
    description:
      'The standard comprehensive algorithms reference used across undergraduate and graduate curricula.',
    summary: 'A comprehensive treatment of modern algorithms and data structures.',
    isReferenceOnly: true,
  },
  {
    title: 'The Art of Computer Programming',
    subtitle: 'Volume 3: Sorting and Searching',
    isbn13: '9780201898531',
    isbn10: '0201898530',
    publisher: 'Addison-Wesley',
    publicationYear: 1998,
    edition: '2nd',
    pageCount: 920,
    callNumber: '005.7 KNU',
    authors: ['Donald Knuth'],
    categorySlugs: ['algorithms', 'reference'],
    tags: ['reference'],
    description: 'The volume on sorting and searching.',
    summary: "Volume 3 of Knuth's compendium, covering sorting and searching.",
    isReferenceOnly: true,
  },
];

export interface BranchSeed {
  code: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Deactivated branches are excluded from the shared catalogue. */
  isActive?: boolean;
}

export const BRANCHES: readonly BranchSeed[] = [
  {
    code: 'MAIN',
    name: 'Main Branch',
    email: 'main.library@example.org',
    phone: '+254700010000',
    address: 'Library Road, Central Campus',
    isActive: true,
  },
  {
    code: 'WEST',
    name: 'West Branch',
    email: 'west.library@example.org',
    phone: '+254700020000',
    address: '12 Western Avenue',
    isActive: false,
  },
  {
    code: 'RESEARCH',
    name: 'Research Branch',
    email: 'research.library@example.org',
    phone: '+254700030000',
    address: 'Research Park Building 4',
    isActive: false,
  },
];

export interface LocationSeed {
  branchCode: string;
  code: string;
  name: string;
  floor?: string;
  shelves: readonly { code: string; capacity?: number }[];
}

export const LOCATIONS: readonly LocationSeed[] = [
  {
    branchCode: 'MAIN',
    code: 'GROUND',
    name: 'Ground Floor Stacks',
    floor: 'Ground',
    shelves: [
      { code: 'G-A01', capacity: 150 },
      { code: 'G-A02', capacity: 150 },
      { code: 'G-B01', capacity: 200 },
    ],
  },
  {
    branchCode: 'MAIN',
    code: 'FIRST',
    name: 'First Floor Stacks',
    floor: 'First',
    shelves: [
      { code: 'F-A01', capacity: 150 },
      { code: 'F-L01', capacity: 120 },
    ],
  },
  {
    branchCode: 'WEST',
    code: 'MAINHALL',
    name: 'Main Hall',
    floor: 'Ground',
    shelves: [
      { code: 'W-A01', capacity: 100 },
      { code: 'W-C01', capacity: 100 },
    ],
  },
  {
    branchCode: 'RESEARCH',
    code: 'STACKS',
    name: 'Research Stacks',
    floor: 'Second',
    shelves: [{ code: 'R-R01', capacity: 300 }],
  },
];

/**
 * Copy allocation per book: `[count, branchCode]`.
 *
 * Deliberately includes a book with zero available copies so the reservation
 * flow can be exercised, and a branch where a book exists only as a reference
 * copy so availability filtering has something real to filter.
 */
export const COPY_ALLOCATION: readonly {
  matchIsbn13: string;
  copies: readonly { branchCode: string; count: number; shelfCode?: string; condition?: string }[];
}[] = [
  {
    matchIsbn13: '9780132350884',
    copies: [
      { branchCode: 'MAIN', count: 4, shelfCode: 'G-A01' },
      { branchCode: 'WEST', count: 2, shelfCode: 'W-A01' },
    ],
  },
  { matchIsbn13: '9780134757599', copies: [{ branchCode: 'MAIN', count: 3, shelfCode: 'G-A01' }] },
  {
    matchIsbn13: '9780201633610',
    copies: [
      { branchCode: 'MAIN', count: 6, shelfCode: 'G-A01' },
      { branchCode: 'RESEARCH', count: 2, shelfCode: 'R-R01' },
    ],
  },
  { matchIsbn13: '9780201895411', copies: [{ branchCode: 'MAIN', count: 1, shelfCode: 'G-B01' }] },
  { matchIsbn13: '9780321563842', copies: [{ branchCode: 'MAIN', count: 2, shelfCode: 'G-A01' }] },
  {
    matchIsbn13: '9780441013593',
    copies: [
      { branchCode: 'MAIN', count: 5, shelfCode: 'F-L01' },
      { branchCode: 'WEST', count: 3, shelfCode: 'W-A01' },
    ],
  },
  { matchIsbn13: '9780570804977', copies: [{ branchCode: 'MAIN', count: 4, shelfCode: 'F-L01' }] },
  // Zero copies: reservations are the only way to obtain this title.
  { matchIsbn13: '9781400033136', copies: [] },
  { matchIsbn13: '9780062315007', copies: [{ branchCode: 'MAIN', count: 2, shelfCode: 'F-L01' }] },
  { matchIsbn13: '9780906895878', copies: [{ branchCode: 'MAIN', count: 3, shelfCode: 'F-L01' }] },
  { matchIsbn13: '9780385474542', copies: [{ branchCode: 'MAIN', count: 8, shelfCode: 'F-L01' }] },
  { matchIsbn13: '9780141183260', copies: [{ branchCode: 'MAIN', count: 2, shelfCode: 'F-L01' }] },
  {
    matchIsbn13: '9780747532699',
    copies: [
      { branchCode: 'MAIN', count: 6, shelfCode: 'F-L01' },
      { branchCode: 'WEST', count: 2, shelfCode: 'W-A01' },
    ],
  },
  // Reference only: holds the copies but cannot circulate them.
  {
    matchIsbn13: '9780262046305',
    copies: [
      { branchCode: 'MAIN', count: 1, shelfCode: 'G-B01' },
      { branchCode: 'RESEARCH', count: 1, shelfCode: 'R-R01' },
    ],
  },
  { matchIsbn13: '9780201898531', copies: [{ branchCode: 'MAIN', count: 1, shelfCode: 'G-B01' }] },
];
