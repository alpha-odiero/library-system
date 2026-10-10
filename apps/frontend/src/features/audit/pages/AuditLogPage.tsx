import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { PaginationMeta } from '@lms/shared';
import { formatInstant } from '../../../lib/format';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { PasswordField, SelectField, TextField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { getSettings } from '../../settings/api';
import {
  AUDIT_ACTIONS,
  exportAuditLogs,
  getAuditLogs,
  purgeAuditLogs,
  type AuditAction,
  type AuditLogEntry,
} from '../api';

const PAGE_SIZE = 20;
const AUDIT_DELETION_SETTING = 'org.allow_audit_log_deletion';

/**
 * The audit log.
 *
 * A read-only table over `GET /audit-logs`. Every row is already redacted
 * server-side — `before` / `after` are stored as JSON and only rendered as
 * part of the description, never diffed into the table — so the page is a list
 * plus filters plus an export, nothing that rebuilds the trail.
 */
export function AuditLogPage(): ReactNode {
  const { can } = useAuth();
  const { notify } = useToast();
  const canPurge = can('AUDIT_DELETE');

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [page, setPage] = useState(1);

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);

  /* ── Purge, when the holder of AUDIT_DELETE may offer it ── */
  const [auditDeletionEnabled, setAuditDeletionEnabled] = useState(false);
  const [purgePassword, setPurgePassword] = useState('');
  const [purgeOlderThan, setPurgeOlderThan] = useState('');
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [confirmingPurge, setConfirmingPurge] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);

  useEffect(() => {
    if (!canPurge) return undefined;
    const controller = new AbortController();
    void getSettings('security', controller.signal)
      .then((response) => {
        let allowed = false;
        for (const group of response.data.settings) {
          for (const setting of group.settings) {
            if (setting.key === AUDIT_DELETION_SETTING) {
              allowed = setting.value === true;
            }
          }
        }
        if (!controller.signal.aborted) setAuditDeletionEnabled(allowed);
      })
      .catch(() => {
        // Leave the gate closed rather than guess: a settings read failure must
        // not let a purge be offered off the back of an unreliable answer.
        if (!controller.signal.aborted) setAuditDeletionEnabled(false);
      });
    return () => controller.abort();
  }, [canPurge]);

  const filters = {
    page,
    limit: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...(action ? { action } : {}),
  };
  const key = JSON.stringify(filters);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const response = await getAuditLogs(JSON.parse(key) as typeof filters, signal);
        setEntries(response.data);
        setMeta(response.meta);
      } catch (caught) {
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    const controller = new AbortController();
    setEntries([]);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function reload(): void {
    void load(new AbortController().signal);
  }

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      const response = await exportAuditLogs(filters);
      const url = URL.createObjectURL(
        new Blob([response.data.csv], { type: 'text/csv;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify('Audit log exported', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not export the audit log', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handlePurge(): Promise<void> {
    setPurgeError(null);
    setPurgeBusy(true);
    try {
      const response = await purgeAuditLogs({
        confirmationPassword: purgePassword,
        ...(purgeOlderThan
          ? { olderThan: new Date(`${purgeOlderThan}T00:00:00.000Z`).toISOString() }
          : {}),
      });
      notify(
        `${response.data.deleted} audit ${response.data.deleted === 1 ? 'entry' : 'entries'} purged. The row recording this purge is kept.`,
        'success',
      );
      setPurgePassword('');
      setPurgeOlderThan('');
      setConfirmingPurge(false);
      reload();
    } catch (caught) {
      setPurgeError(caught instanceof Error ? caught.message : 'Could not purge the audit log.');
      setConfirmingPurge(false);
    } finally {
      setPurgeBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'time',
      header: 'When',
      render: (entry) => <span className="cell-muted">{formatInstant(entry.createdAt)}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (entry) => (
        <span>
          <span className="person__name">{entry.actorEmail}</span>
          {entry.actorRole && <span className="person__meta">{entry.actorRole}</span>}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (entry) => <Badge tone="info">{entry.action.replaceAll('_', ' ')}</Badge>,
    },
    {
      key: 'entity',
      header: 'Entity',
      secondary: true,
      render: (entry) => (
        <span>
          <span className="person__name">{entry.entityType}</span>
          {entry.entityId && <span className="person__meta">{entry.entityId}</span>}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Detail',
      render: (entry) => entry.description,
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Audit log</h1>
          <p className="page-header__subtitle">
            Every significant change, appended and never edited.
            {!loading && ` ${meta.total} ${meta.total === 1 ? 'entry' : 'entries'} in this view.`}
          </p>
        </div>
        {can('AUDIT_EXPORT') && (
          <Button variant="secondary" onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        )}
      </header>

      <Card>
        <form className="filters" onSubmit={handleSearch} role="search">
          <div className="field filters__grow">
            <label className="field__label" htmlFor="audit-search">
              Search
            </label>
            <input
              id="audit-search"
              className="input"
              type="search"
              value={query}
              placeholder="Description, entity or request id"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <SelectField
            label="Action"
            value={action}
            onChange={(value) => {
              setAction(value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All actions' },
              ...AUDIT_ACTIONS.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
            ]}
          />

          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <>
            <DataTable
              caption="Audit log"
              columns={columns}
              rows={entries}
              rowKey={(entry) => entry.id}
              loading={loading}
              emptyTitle={
                meta.total === 0 && !search && !action
                  ? 'No audit activity yet'
                  : 'No audit entries match those filters'
              }
              emptyDescription={
                meta.total === 0 && !search && !action
                  ? 'Sign-ins and library changes will appear here as they are recorded.'
                  : 'Try a different action, search term or page.'
              }
            />

            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>

      {canPurge && (
        <Card title="Purge the audit log" description="Removes entries the library has agreed to let go of.">
          {!auditDeletionEnabled ? (
            <EmptyState
              icon="settings"
              title="Audit log deletion is disabled"
              description="Enable “Allow audit log deletion” under Settings › Security & Access before a purge can run. A purge still requires your password, and one row recording the purge always survives."
            />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (purgePassword.trim()) setConfirmingPurge(true);
              }}
              noValidate
            >
              {purgeError && (
                <p className="form__error" role="alert">
                  {purgeError}
                </p>
              )}

              <div className="form__row">
                <PasswordField
                  label="Your password"
                  value={purgePassword}
                  onChange={setPurgePassword}
                  hint="Confirmed by the server immediately before anything is deleted."
                  autoComplete="current-password"
                  required
                />
                <TextField
                  label="Purge entries before"
                  type="date"
                  value={purgeOlderThan}
                  onChange={setPurgeOlderThan}
                  hint="Blank purges everything except the marker row that records this purge."
                  max={today}
                />
              </div>

              <div className="form__actions">
                <Button
                  type="button"
                  variant="danger"
                  disabled={purgeBusy || !purgePassword.trim()}
                  onClick={() => setConfirmingPurge(true)}
                >
                  Purge the audit log
                </Button>
                <p className="form__note">
                  Irreversible. Only entries older than the date above (or all of them) are removed.
                </p>
              </div>
            </form>
          )}

          <ConfirmDialog
            open={confirmingPurge}
            title="Purge the audit log?"
            message={
              <>
                This permanently deletes
                {purgeOlderThan
                  ? ` every audit entry recorded on or before ${purgeOlderThan}, `
                  : ' every audit entry except the surviving purge marker, '}
                and cannot be undone. Your password has already been entered and will be re-checked
                by the server before anything is removed.
              </>
            }
            confirmLabel="Purge permanently"
            busy={purgeBusy}
            onConfirm={() => void handlePurge()}
            onCancel={() => setConfirmingPurge(false)}
          />
        </Card>
      )}
    </>
  );
}
