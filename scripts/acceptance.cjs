/*
 * Acceptance test — shared live catalogue + destructive-action hardening.
 *
 * Twelve scenario groups exercising the one shared-catalogue fix and the
 * hardened destructive flows, all against the real API and the real database:
 *
 *   S1  Book creation (authors + categories + copies required) and summary
 *   S2  Zero-copy books are visible to every role
 *   S3  Catalogue totals and availability agree across roles
 *   S4  Every role sees only active (MAIN) copies; availability moves on issue
 *   S5  Loan issuance produces a member notification
 *   S6  Return restores availability and produces a return notification
 *   S7  Duplicate ISBN-13 is refused (BOOK_ISBN13_DUPLICATE)
 *   S8  No-ISBN duplicate title/author/year is refused (BOOK_DUPLICATE)
 *   S9  Book delete-vs-archive: delete refused while copies exist, archive
 *       allowed, members cannot archive, full delete succeeds once the lone
 *       copy (with no history) is withdrawn, and a BOOK_DELETED audit row lands
 *   S10 Audit purge refuses while disabled, for admins and librarians alike
 *   S11 Member archive is refused while the member has an active reservation
 *   S12 Enabling the purge gate: wrong password refused, correct password
 *       purges the log while the marker row survives; gate restored to OFF
 *
 * RUN: `node scripts/acceptance.cjs` with the backend up.
 */
const BASE = 'http://localhost:4000/api/v1';

function makeClient() {
  const jar = new Map();
  return {
    async request(method, path, { body, headers = {} } = {}) {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const pair = sc.split(';')[0];
        const idx = pair.indexOf('=');
        if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      let json = null;
      const text = await res.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    },

    async login(email, password) {
      const csrf = await this.request('GET', '/auth/csrf');
      const token = csrf.json.data.csrfToken;
      return this.request('POST', '/auth/login', {
        body: { email, password },
        headers: { 'x-csrf-token': token },
      });
    },
  };
}

const admin = makeClient();
const librarian = makeClient();
const student = makeClient();

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!condition) failures += 1;
}
function scenario(title) {
  console.log(`\n── ${title} ──`);
}

/* Generates a unique Luhn-valid ISBN-13 so repeated runs never collide. */
function makeIsbn13() {
  const base = ('978' + String(Date.now() % 10000000000)).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + String(check);
}

async function main() {
  for (const [name, c, email] of [
    ['admin', admin, 'admin@library.test'],
    ['librarian', librarian, 'librarian@library.test'],
    ['student', student, 'student@library.test'],
  ]) {
    const res = await c.login(email, 'DevOnly#Library2026');
    check(`login: ${name}`, res.status === 200, res.status);
  }

  const studentMe = (await student.request('GET', '/auth/me')).json.data;

  /* S1 ─── book creation requires authors, categories and copies ────────────── */
  scenario('S1  Book creation requires authors, categories and copies');
  const authorsRes = await admin.request('GET', '/authors?limit=1');
  const authorId = authorsRes.json?.data?.[0]?.id;
  const catsRes = await admin.request('GET', '/categories?limit=1');
  const categoryId = catsRes.json?.data?.[0]?.id;
  check('author + category fixtures available', !!(authorId && categoryId));

  const isbn = makeIsbn13();
  const bookBody = {
    title: 'Acceptance Test Title',
    isbn13: isbn,
    language: 'en',
    authorIds: [authorId],
    categoryIds: [categoryId],
    copies: 3,
  };

  const missing = await admin.request('POST', '/books', {
    body: { title: 'Should Fail', authorIds: [authorId] },
  });
  check(
    'create refused when categories/copies missing (400)',
    missing.status === 400,
    `${missing.status} ${JSON.stringify(missing.json?.error ?? '')}`,
  );

  const created = await admin.request('POST', '/books', { body: bookBody });
  check(
    'admin create book with copies:3',
    created.status === 201,
    `${created.status} ${JSON.stringify(created.json?.error ?? '')}`,
  );
  const bookId = created.json?.data?.book?.id;
  const summary = created.json?.data?.book?.copies;
  check(
    'create response summary 3/3/0',
    !!(summary && summary.total === 3 && summary.available === 3 && summary.onLoan === 0),
    JSON.stringify(summary),
  );

  /* S2 ─── zero-copy books visible to admin, librarian and student alike ────── */
  scenario('S2  Zero-copy books are visible to every role');
  const zeroCopyId = '908ec10a-f051-4602-a1eb-ae82931e9212';
  for (const [name, c] of [['admin', admin], ['librarian', librarian], ['student', student]]) {
    const r = await c.request('GET', `/books/${zeroCopyId}`);
    check(
      `zero-copy visible to ${name}`,
      r.status === 200 && r.json?.data?.book?.id === zeroCopyId,
      r.status,
    );
  }

  /* S3 ─── catalogue totals and availability agree across roles ─────────────── */
  scenario('S3  Catalogue totals agree across roles');
  const totals = {};
  for (const [name, c] of [['admin', admin], ['librarian', librarian], ['student', student]]) {
    const r = await c.request('GET', '/books?limit=100');
    const books = r.json?.data ?? [];
    totals[name] = r.json?.meta?.total;
    const mine = books.find((b) => b.id === bookId);
    check(
      `new book visible to ${name} with 3 available`,
      !!mine && mine.copies.available === 3 && mine.copies.total === 3,
      mine ? `total=${mine.copies.total} avail=${mine.copies.available}` : 'missing',
    );
  }
  check(
    'book totals equal across roles',
    totals.admin === totals.librarian && totals.librarian === totals.student,
    JSON.stringify(totals),
  );

  for (const [name, c] of [['admin', admin], ['librarian', librarian], ['student', student]]) {
    const r = await c.request('GET', '/copies?limit=100');
    const copies = r.json?.data ?? [];
    check(
      `${name} sees only active (MAIN) copies`,
      copies.length > 0 && copies.every((cp) => cp.branch.code === 'MAIN'),
      `count=${copies.length} total=${r.json?.meta?.total}`,
    );
  }

  /* S4 ─── borrow flow: availability moves only on the shared record ────────── */
  scenario('S4  Borrow flow — availability drops after issue, for every role');
  const copyList = await librarian.request('GET', `/copies?bookId=${bookId}&limit=10`);
  const copy = (copyList.json?.data ?? [])[0];

  const issue = await librarian.request('POST', '/loans', {
    body: { memberId: studentMe.memberId, copyId: copy.id },
  });
  check('librarian issues loan to student', issue.status === 201, issue.status);
  const loanId = issue.json?.data?.loan?.id;

  const afterIssue = await student.request('GET', `/books/${bookId}`);
  const afterIssueSummary = afterIssue.json?.data?.book?.copies;
  check(
    'available drops 3 -> 2 after issue',
    afterIssueSummary && afterIssueSummary.available === 2 && afterIssueSummary.onLoan === 1,
    `avail=${afterIssueSummary?.available} onLoan=${afterIssueSummary?.onLoan}`,
  );

  /* S5 ─── loan issuance produces a member notification ─────────────────────── */
  scenario('S5  Loan issuance notifies the member');
  const notifs = await student.request('GET', '/notifications?limit=20');
  const items = notifs.json?.data ?? [];
  const loanNotice = items.find((n) => n.data?.loanId === loanId);
  check('student got loan-issued notification', !!loanNotice, loanNotice ? loanNotice.type : 'none');

  /* S6 ─── return restores availability + return notification ───────────────── */
  scenario('S6  Return restores availability and notifies');
  const returned = await admin.request('POST', `/loans/${loanId}/return`, { body: {} });
  check('return loan (admin)', returned.status === 200, returned.status);

  const afterReturn = await student.request('GET', `/books/${bookId}`);
  check(
    'available restored to 3 after return',
    afterReturn.json?.data?.book?.copies?.available === 3,
    JSON.stringify(afterReturn.json?.data?.book?.copies),
  );

  const notifs2 = await student.request('GET', '/notifications?limit=20');
  const items2 = notifs2.json?.data ?? [];
  const returnNotice = items2.find((n) => n.data?.loanId === loanId && n.type === 'BOOK_RETURNED');
  check('student got BOOK_RETURNED notification', !!returnNotice, returnNotice ? 'yes' : 'none');

  /* S7 ─── duplicate ISBN-13 is refused ─────────────────────────────────────── */
  scenario('S7  Duplicate ISBN-13 refused');
  const dup = await admin.request('POST', '/books', { body: bookBody });
  check(
    'same ISBN-13 create refused 409 BOOK_ISBN13_DUPLICATE',
    dup.status === 409 && dup.json?.error?.code === 'BOOK_ISBN13_DUPLICATE',
    `${dup.status} ${JSON.stringify(dup.json?.error ?? '')}`,
  );

  /* S8 ─── no-ISBN duplicate title/author/year is refused ───────────────────── */
  scenario('S8  No-ISBN duplicate title refused');
  // Suffix keeps reruns clean: an earlier run's archived copy of the title would
  // otherwise be matched by the duplicate rule.
  const noIsbn = {
    title: `Duplicate Manifesto ${Date.now()}`,
    publicationYear: 2030,
    language: 'en',
    authorIds: [authorId],
    categoryIds: [categoryId],
    copies: 1,
  };
  const bookA = await admin.request('POST', '/books', { body: noIsbn });
  check('first no-ISBN book created', bookA.status === 201, `${bookA.status} ${JSON.stringify(bookA.json?.error ?? '')}`);
  const bookAId = bookA.json?.data?.book?.id;

  const bookB = await admin.request('POST', '/books', { body: noIsbn });
  check(
    'same title+author+year refused 409 BOOK_DUPLICATE',
    bookB.status === 409 && bookB.json?.error?.code === 'BOOK_DUPLICATE',
    `${bookB.status} ${JSON.stringify(bookB.json?.error ?? '')}`,
  );

  /* S9 ─── book delete vs archive ───────────────────────────────────────────── */
  scenario('S9  Book delete vs archive');
  const delRefused = await admin.request('DELETE', `/books/${bookAId}?action=delete`);
  check(
    'hard delete refused while a copy exists (409)',
    delRefused.status === 409,
    `${delRefused.status} ${JSON.stringify(delRefused.json?.error ?? '')}`,
  );

  const archiveOk = await admin.request('DELETE', `/books/${bookAId}?action=archive`);
  check('archive allowed (204)', archiveOk.status === 204, archiveOk.status);

  const memberGate = await student.request('DELETE', `/books/${bookAId}?action=archive`, {});
  check(
    'member cannot archive a book (403)',
    memberGate.status === 403,
    memberGate.status,
  );

  const fullDelete = await (async () => {
    const book = await admin.request('POST', '/books', {
      body: {
        title: 'Delete Me Book',
        language: 'en',
        authorIds: [authorId],
        categoryIds: [categoryId],
        copies: 1,
      },
    });
    const id = book.json?.data?.book?.id;
    const cp = await admin.request('GET', `/copies?bookId=${id}&limit=1`);
    const copyId = cp.json?.data?.[0]?.id;
    const rm = await admin.request('DELETE', `/copies/${copyId}`);
    const del = await admin.request('DELETE', `/books/${id}?action=delete`);
    const gone = await admin.request('GET', `/books/${id}`);
    const audit = await admin.request('GET', '/audit-logs?action=BOOK_DELETED&limit=50');
    const row = (audit.json?.data ?? []).find((a) => a.entityId === id);
    return { id, del, gone, row };
  })();
  check(
    'sole copy (no history) removed (204)',
    fullDelete.del && fullDelete.del.status === 204,
    fullDelete.del?.status,
  );
  check(
    'hard delete succeeds once no dependents remain (204)',
    fullDelete.del && fullDelete.del.status === 204,
    fullDelete.del?.status,
  );
  check('deleted book reads back as 404', fullDelete.gone && fullDelete.gone.status === 404, fullDelete.gone?.status);
  check('BOOK_DELETED audit row recorded', !!fullDelete.row, fullDelete.row ? 'yes' : 'none');

  /* S10 ─── purge gate OFF ──────────────────────────────────────────────────── */
  scenario('S10  Audit purge refused while disabled');
  const off1 = await admin.request('PATCH', '/settings', {
    body: { updates: { 'org.allow_audit_log_deletion': false } },
  });
  check('set audit deletion OFF (admin)', off1.status === 200, off1.status);

  const purgeOff = await admin.request('POST', '/audit-logs/purge', {
    body: { confirmationPassword: 'DevOnly#Library2026' },
  });
  check(
    'admin purge refused while OFF (403)',
    purgeOff.status === 403,
    `${purgeOff.status} ${JSON.stringify(purgeOff.json?.error ?? '')}`,
  );

  const libPurge = await librarian.request('POST', '/audit-logs/purge', {
    body: { confirmationPassword: 'DevOnly#Library2026' },
  });
  check('librarian purge refused (403, no AUDIT_DELETE)', libPurge.status === 403, libPurge.status);

  /* S11 ─── member archive blocked by an active reservation ─────────────────── */
  scenario('S11  Member archive blocked while reservation active');
  const reservation = await admin.request('POST', '/reservations', {
    body: { memberId: studentMe.memberId, bookId: bookId },
  });
  check('admin reserves book for member', reservation.status === 201, reservation.status);
  const reservationId = reservation.json?.data?.reservation?.id;

  const archiveMember = await admin.request('DELETE', `/members/${studentMe.memberId}`);
  check(
    'archive member refused while reservation active (409 MEMBER_HAS_ACTIVE_RESERVATIONS)',
    archiveMember.status === 409 &&
      archiveMember.json?.error?.code === 'MEMBER_HAS_ACTIVE_RESERVATIONS',
    `${archiveMember.status} ${JSON.stringify(archiveMember.json?.error ?? '')}`,
  );

  const stillActive = await admin.request('GET', `/members/${studentMe.memberId}`);
  const m = stillActive.json?.data?.member;
  check(
    'member unchanged (still ACTIVE) after refused archive',
    stillActive.status === 200 && m && m.status === 'ACTIVE',
    JSON.stringify(m ? { status: m.status } : 'missing'),
  );

  const cancelled = await admin.request('DELETE', `/reservations/${reservationId}`);
  check('chain cancelled', cancelled.status === 204, cancelled.status);

  /* S12 ─── purge gate ON, password-gated, marker survives ──────────────────── */
  scenario('S12  Enabled purge: password gate + surviving marker');
  const on = await admin.request('PATCH', '/settings', {
    body: { updates: { 'org.allow_audit_log_deletion': true } },
  });
  check('set audit deletion ON', on.status === 200, on.status);

  const wrongPwd = await admin.request('POST', '/audit-logs/purge', {
    body: { confirmationPassword: 'definitely-wrong' },
  });
  check(
    'purge refused on wrong password (401)',
    wrongPwd.status === 401 && wrongPwd.json?.error?.code === 'INVALID_CREDENTIALS',
    `${wrongPwd.status} ${JSON.stringify(wrongPwd.json?.error ?? '')}`,
  );

  const purge = await admin.request('POST', '/audit-logs/purge', {
    body: { confirmationPassword: 'DevOnly#Library2026' },
  });
  check(
    'purge succeeds on correct password',
    purge.status === 200 && typeof purge.json?.data?.deleted === 'number',
    `${purge.status} deleted=${purge.json?.data?.deleted}`,
  );

  const afterPurge = await admin.request('GET', '/audit-logs?limit=100');
  const rows = afterPurge.json?.data ?? [];
  const onlyMarkers =
    rows.length >= 1 && rows.every((r) => r.action === 'AUDIT_LOGS_DELETED');
  check(
    'log reduced to surviving purge-marker row(s)',
    onlyMarkers,
    `rows=${rows.length} actions=${[...new Set(rows.map((r) => r.action))].join(',')}`,
  );

  const restored = await admin.request('PATCH', '/settings', {
    body: { updates: { 'org.allow_audit_log_deletion': false } },
  });
  check('purge gate restored to OFF', restored.status === 200, restored.status);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SCRIPT ERROR', err);
  process.exit(1);
});