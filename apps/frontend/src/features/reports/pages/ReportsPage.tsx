import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatCount, formatMoney } from '../../../lib/format';
import { Card, Stat, StatGrid } from '../../../components/ui/Card';
import { DescriptionList, DescriptionItem } from '../../../components/ui/Table';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import {
  getCirculationReport,
  getFinancialReport,
  getLibrarySummary,
  type CirculationReport,
  type FinancialReport,
  type LibrarySummaryReport,
} from '../api';

const COPY_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Available',
  BORROWED: 'Borrowed',
  RESERVED: 'Reserved',
  LOST: 'Lost',
  DAMAGED: 'Damaged',
  MAINTENANCE: 'In maintenance',
  REMOVED: 'Removed from shelf',
};

const CONSTRAINT_ORDER = ['AVAILABLE', 'BORROWED', 'RESERVED', 'MAINTENANCE', 'LOST', 'DAMAGED'];

/**
 * Reports.
 *
 * Pure, read-only aggregates: every figure comes from `GET /reports/*` with the
 * scope the server chose for the caller. The route is gated by `REPORT_VIEW`, so
 * the page does not re-check permissions; the financial panel below is.
 *
 * The page shows no charts and no exports — the numbers that exist today are the
 * numbers worth reporting, and a chart library would be payload for that.
 */
export function ReportsPage(): ReactNode {
  const { can } = useAuth();
  const canFinance = can('REPORT_VIEW_FINANCIAL');

  const [summary, setSummary] = useState<LibrarySummaryReport | null>(null);
  const [circulation, setCirculation] = useState<CirculationReport | null>(null);
  const [financial, setFinancial] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const [summaryResponse, circulationResponse, financialResponse] = await Promise.all([
          getLibrarySummary(signal),
          getCirculationReport(signal),
          // Only requested when the session may see it. A member of a desk who
          // cannot call the endpoint never has its 403 land in the log.
          canFinance ? getFinancialReport(signal) : Promise.resolve(null),
        ]);
        setSummary(summaryResponse.data.report);
        setCirculation(circulationResponse.data.report);
        setFinancial(financialResponse?.data.report ?? null);
      } catch (caught) {
        if (!signal.aborted) setError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [canFinance],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !summary) return <LoadingState label="Loading reports" rows={6} />;
  if (error && !summary)
    return <ErrorState error={error} onRetry={() => void load(new AbortController().signal)} />;
  if (!summary || !circulation) return null;

  const memberTotal = Object.values(summary.members).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Reports</h1>
          <p className="page-header__subtitle">
            Live figures for your scope — recomputed from the database, never a snapshot.
          </p>
        </div>
      </header>

      <StatGrid>
        <Stat label="Catalogue titles" value={formatCount(summary.titles)} />
        <Stat label="Copies on shelf" value={formatCount(summary.copyTotal)} />
        <Stat label="Currently out" value={formatCount(circulation.onLoan)} tone="warn" />
        <Stat label="Overdue" value={formatCount(circulation.overdue)} tone="bad" />
        <Stat label="Members registered" value={formatCount(memberTotal)} tone="ok" />
        <Stat label="Active borrowers" value={formatCount(circulation.activeBorrowers)} />
        <Stat label="Open requests" value={formatCount(summary.requestsPending)} />
      </StatGrid>

      <div className="grid grid--two">
        <Card
          title="Copy & loan status"
          description="Current status of every copy and loan in scope."
        >
          <DescriptionList>
            {CONSTRAINT_ORDER.map((status) => (
              <DescriptionItem key={status} term={COPY_STATUS_LABELS[status] ?? status}>
                {formatCount(summary.copies[status] ?? 0)}
              </DescriptionItem>
            ))}
          </DescriptionList>
        </Card>

        <Card
          title="Top borrowed titles"
          description="The five titles that have been out the most."
        >
          {circulation.topBorrowed.length > 0 ? (
            <DescriptionList>
              {circulation.topBorrowed.map((entry, index) => (
                <DescriptionItem key={entry.bookId} term={`${index + 1}. ${entry.title}`}>
                  {formatCount(entry.loans)} loan{entry.loans === 1 ? '' : 's'}
                </DescriptionItem>
              ))}
            </DescriptionList>
          ) : (
            <p className="form__note">No loans recorded in this scope yet.</p>
          )}
        </Card>
      </div>

      {canFinance && financial && (
        <Card
          title="Finance"
          description="Fines assessed, waived and settled — the part of the picture only an administrator sees."
        >
          <DescriptionList>
            <DescriptionItem term="Assessed">{formatMoney(financial.assessed)}</DescriptionItem>
            <DescriptionItem term="Waived">{formatMoney(financial.waived)}</DescriptionItem>
            <DescriptionItem term="Collected">{formatMoney(financial.collected)}</DescriptionItem>
            <DescriptionItem term="Outstanding">
              {formatMoney(financial.outstanding)}
            </DescriptionItem>
            <DescriptionItem term="Open fines">
              {formatCount(financial.openFines)} still due
            </DescriptionItem>
          </DescriptionList>
        </Card>
      )}

      {canFinance && financial && (
        <p className="form__note">
          Fine amounts are library currency and may be waived or paid off in part. Outstanding is
          assessed minus waived minus settled, floored at zero.
        </p>
      )}
    </>
  );
}
