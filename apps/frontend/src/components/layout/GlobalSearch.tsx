import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { listBooks, type BookDto } from '../../features/catalogue/api';
import { Icon } from '../ui/Icon';
import { paths } from '../../routes/paths';

/**
 * The header's search field.
 *
 * ## Why this is a field and not a button
 *
 * It used to be a button that dispatched `soma:open-command` — an event no module
 * ever listened for, so clicking "Search the library…" did literally nothing, on
 * every page except the dashboard where the button was hidden outright. A control
 * that advertises a capability and performs none is worse than an absent one, so
 * the field now queries the one endpoint that already answers a free-text title,
 * author or ISBN match: `GET /books?q=…`.
 *
 * Three deliberate limits:
 *
 *   1. **Gated on `BOOK_VIEW`.** The route is behind that grant, so a session
 *      without it gets no field rather than a field whose every keystroke 403s.
 *   2. **Two characters, 220ms, six rows.** The server would take one character,
 *      but a request per keystroke on a shared library connection is a denial of
 *      service against your own catalogue. Six rows is a list a person can scan;
 *      twenty is a page they have to read.
 *   3. **Enter goes to the register, not to the first hit.** Ranking a result list
 *      that has no ranking is a guess, and guessing which book someone meant is
 *      how they end up on the wrong record. `/books` carries the same query in
 *      its own filter and the reader makes the call.
 *
 * `Ctrl K` / `Cmd K` focuses the field, because the hint printed inside it says so.
 */
export function GlobalSearch(): ReactNode {
  const { can } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookDto[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const entitled = can('BOOK_VIEW');

  useEffect(() => {
    if (!entitled) return;
    const term = query.trim();

    if (term.length < 2) {
      setResults([]);
      setFailed(false);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      listBooks({ q: term, limit: SEARCH_LIMIT }, controller.signal)
        .then((page) => {
          setResults(page.data);
          setFailed(false);
          setOpen(true);
        })
        .catch(() => {
          // An abort is the field doing its job on the next keystroke, not a
          // failure worth reporting to the reader.
          if (controller.signal.aborted) return;
          setResults([]);
          setFailed(true);
          setOpen(true);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, entitled]);

  useEffect(() => {
    if (!entitled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entitled]);

  if (!entitled) return null;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setOpen(false);
    // `void`: the router may hand back a promise when the target route starts a
    // load, and nothing here depends on when it resolves.
    void navigate(paths.books);
  };

  /*
   * Closing on blur has to check *where* focus went, not merely that it left the
   * input: a plain `onBlur` closes the panel the instant a keyboard user tabs into
   * it, so the results vanish mid-reach. `relatedTarget` is the element receiving
   * focus, and anything still inside the form keeps the panel open.
   */
  const onBlur = (event: FocusEvent<HTMLFormElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  const showPanel = open && (failed || results.length > 0);

  return (
    <form
      className="topbar__search"
      role="search"
      onSubmit={onSubmit}
      onBlur={onBlur}
      // Stopping propagation here keeps the shell's Escape handler (which closes
      // the account menu) from also clearing a search the reader is typing.
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        setOpen(false);
        setQuery('');
      }}
    >
      <Icon name="search" className="topbar__search-icon" />
      <input
        ref={inputRef}
        className="topbar__search-input"
        type="search"
        name="q"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search books, authors, ISBN…"
        aria-label="Search the library"
        aria-expanded={showPanel}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
      />
      <kbd className="kbd" aria-hidden="true">
        Ctrl K
      </kbd>

      {showPanel && (
        <div className="search-pop" aria-label="Search results">
          {failed ? (
            <p className="search-pop__note">Search is unavailable right now.</p>
          ) : (
            results.map((book) => (
              <Link
                className="search-pop__item"
                key={book.id}
                to={`/books/${book.id}`}
                // Without this the input blurs first, the panel closes, and the
                // link is gone before the click can land on it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpen(false)}
              >
                <Icon name="books" size={14} className="search-pop__icon" />
                <span className="search-pop__title">{book.title}</span>
                <span className="search-pop__meta">
                  {book.authors.length > 0
                    ? book.authors.map((author) => author.name).join(', ')
                    : (book.publicationYear ?? '—')}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </form>
  );
}

/** Rows returned per search. Enough to scan, few enough to stay a list. */
const SEARCH_LIMIT = 6;
const DEBOUNCE_MS = 220;
