import { useState, type FormEvent, type ReactNode } from 'react';
import type { FineStatusDto } from '@lms/shared';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card, Stat, StatGrid } from '../../../components/ui/Card';
import { Dialog } from '../../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { formatCalendarDate, formatMoney, fullName, initials } from '../../../lib/format';
import {
  FINE_STATUS_FILTERS,
  fineBalance,
  sumMoney,
  updateFine,
  waiveFine,
  type FineDto,
  type FineUpdateInput,
} from '../api';
import { FINE_TYPE_LABELS, useFineList, useFineTotals } from '../useFinanceQueries';

/**
 * The fine register.
 *
 * Two things this screen is careful about:
 *
 *   1. **It never claims a figure it cannot support.** The previous version of this
 *      page rendered a hardcoded "KES 0.00 outstanding". On a live system that reads
 *      as good news. The outstanding total now comes from the API, and when it is a
 *      partial sum it is marked with a `+` rather than presented as the whole debt.
 *   2. **Balance is computed from the payment records, not the status field.** A
 *      fine marked PARTIAL is still money owed, and showing the assessed amount as
 *      the balance would overstate what a member needs to pay.
 */
export function FinesPage(): ReactNode {
  const { session, can } = useAuth();
  const [status, setStatus] = useState<FineStatusDto | ''>('OUTSTANDING');
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<FineDto | null>(null);
  const [waiving, setWaiving] = useState<FineDto | null>(null);

  const ownView = !can('FINE_VIEW') && can('FINE_VIEW_OWN');

  const { fines, meta, loading, error, reload } = useFineList({
    page,
    limit: 20,
    ...(status ? { status } : {}),
    ...(ownView && session?.memberId ? { memberId: session.memberId } : {}),
  });

  const { totals, loading: totalsLoading } = useFineTotals(!ownView);

  const columns: Column<FineDto>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (fine) => (
        <div className="cell-stack">
          <span className="cell-stack__primary">{fine.reference}</span>
          <span className="cell-stack__secondary">
            {FINE_TYPE_LABELS[fine.type] ?? fine.type.replace(/_/g, ' ')}
          </span>
        </div>
      ),
    },
    ...(ownView
      ? []
      : [
          {
            key: 'member',
            header: 'Student',
            render: (fine: FineDto) => (
              <div className="person">
                <span className="person__avatar" aria-hidden="true">
                  {initials(fine.member.user)}
                </span>
                <span>
                  <span className="person__name">{fullName(fine.member.user)}</span>
                  <span className="person__meta">{fine.member.membershipNumber}</span>
                </span>
              </div>
            ),
          },
        ]),
    {
      key: 'book',
      header: 'About',
      secondary: true,
      render: (fine) => fine.loan?.book.title ?? fine.description ?? '—',
    },
    {
      key: 'assessed',
      header: 'Assessed',
      align: 'right',
      render: (fine) => formatMoney(fine.amount),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      secondary: true,
      render: (fine) => {
        const valid = fine.payments.filter((payment) => payment.voidedAt === null);
        return valid.length > 0
          ? formatMoney(sumMoney(valid.map((payment) => payment.amount)))
          : '—';
      },
    },
    {
      key: 'assessed_on',
      header: 'Assessed',
      secondary: true,
      render: (fine) => formatCalendarDate(fine.assessedAt),
    },
    {
      key: 'status',
      header: 'Status',
      render: (fine) => <Badge tone={toneFor(fine.status)}>{labelFor(fine.status)}</Badge>,
    },
    ...(!ownView
      ? [
          {
            key: 'actions',
            header: 'Manage',
            align: 'right' as const,
            secondary: true,
            render: (fine: FineDto) => {
              const live = fine.status === 'OUTSTANDING' || fine.status === 'PARTIAL';
              const waivable = live && can('FINE_WAIVE') && Number(fineBalance(fine)) > 0;

              if (!live || (!can('FINE_UPDATE') && !waivable)) return '—';
              return (
                <div className="row-actions">
                  {can('FINE_UPDATE') && (
                    <Button variant="ghost" size="sm" onClick={() => setAdjusting(fine)}>
                      Adjust
                    </Button>
                  )}
                  {waivable && (
                    <Button variant="ghost" size="sm" onClick={() => setWaiving(fine)}>
                      Waive
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">{ownView ? 'Fines Owed' : 'Fines'}</h1>
          <p className="page-header__subtitle">
            {ownView
              ? 'Outstanding charges on your account, and what you have already paid.'
              : 'Outstanding balances and adjustments across the branches your role covers.'}
          </p>
        </div>
      </header>

      {ownView ? null : (
        <StatGrid>
          <Stat
            label="Outstanding"
            // `null` renders as an em dash through `formatMoney`, which is the honest
            // answer when the request failed. Zero would be a claim.
            value={totalsLoading ? '…' : totals ? formatMoney(totals.outstanding) : '—'}
            hint={
              totals && !totals.complete
                ? `From the first ${totals.count} of ${totals.count}+ — a lower bound`
                : totals
                  ? `${totals.count} fine${totals.count === 1 ? '' : 's'}`
                  : undefined
            }
            tone={totals && Number(totals.outstanding) > 0 ? 'warn' : 'neutral'}
          />
          <Stat label="Shown" value={String(fines.length)} hint={`of ${meta.total}`} />
          <Stat label="Filters" value={status ? labelFor(status) : 'All statuses'} />
        </StatGrid>
      )}

      <Card>
        <div className="filters">
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All statuses' },
              ...FINE_STATUS_FILTERS.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
          />
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption={ownView ? 'Fines on your account' : 'Fine register'}
              columns={columns}
              rows={fines}
              rowKey={(fine) => fine.id}
              loading={loading}
              emptyTitle={ownView ? 'You have no fines' : 'No fines match that filter'}
              emptyDescription={
                ownView ? 'Nothing is owed on your account.' : 'Try a different status.'
              }
            />
            {meta.total > 0 && <Pagination meta={meta} onPageChange={setPage} />}
          </>
        )}
      </Card>

      {adjusting && (
        <AdjustFineDialog
          fine={adjusting}
          onClose={() => {
            setAdjusting(null);
            void reload();
          }}
        />
      )}

      {waiving && (
        <WaiveFineDialog
          fine={waiving}
          onClose={() => {
            setWaiving(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function labelFor(status: FineStatusDto): string {
  return (
    {
      OUTSTANDING: 'Outstanding',
      PARTIAL: 'Partially paid',
      PAID: 'Paid',
      WAIVED: 'Waived',
      VOID: 'Void',
    } satisfies Record<FineStatusDto, string>
  )[status];
}

function toneFor(status: FineStatusDto): BadgeTone {
  switch (status) {
    case 'OUTSTANDING':
      return 'bad';
    case 'PARTIAL':
      return 'warn';
    case 'PAID':
    case 'WAIVED':
      return 'ok';
    default:
      return 'neutral';
  }
}

/** Matches the server's `moneySchema`, minus the minus sign the schema allows. */
const POSITIVE_MONEY = /^\d+(\.\d{1,2})?$/;

function positiveMoney(value: string): boolean {
  return POSITIVE_MONEY.test(value.trim()) && Number(value.trim()) > 0;
}

/* ── Adjust dialog ─────────────────────────────────────────────────────────── */

function AdjustFineDialog({ fine, onClose }: { fine: FineDto; onClose: () => void }): ReactNode {
  const { notify } = useToast();
  const [amount, setAmount] = useState(fine.amount);
  const [description, setDescription] = useState(fine.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The assessed amount can never drop below what has already been paid or waived:
  // a fine's balance is `amount − waived − payments`, and a negative balance is a
  // real state the register does not model. Show it so the floor is not a mystery.
  const alreadySettled = sumMoney([
    fine.waivedAmount,
    ...fine.payments
      .filter((payment) => payment.voidedAt === null)
      .map((payment) => payment.amount),
  ]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!positiveMoney(amount)) {
      setErrors({ amount: 'Enter a positive amount, e.g. 50 or 50.00.' });
      return;
    }
    if (Number(amount) < Number(alreadySettled)) {
      setErrors({
        amount: `Cannot be less than the ${formatMoney(alreadySettled)} already settled against it.`,
      });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    const patch: FineUpdateInput = {};
    if (amount.trim() !== fine.amount) patch.amount = amount.trim();
    if (description.trim() !== (fine.description ?? '')) {
      // The schema has no way to clear a description (`min(1)`, not nullable), so a
      // blank box means "keep the current text" —
      if (description.trim()) patch.description = description.trim();
    }

    if (Object.keys(patch).length === 0) {
      notify('Nothing to change — the fine already matches.', 'info');
      setBusy(false);
      return;
    }

    try {
      await updateFine(fine.id, patch);
      notify(`Fine ${fine.reference} updated`, 'success');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not update that fine.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`Adjust ${fine.reference}`}
      description="Change the assessed amount or the description on the fine. Payments and waivers stay as they are."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="adjust-fine-form"
            variant="primary"
            busy={busy}
            busyLabel="Saving…"
          >
            Save changes
          </Button>
        </>
      }
    >
      <form id="adjust-fine-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}
        <TextField
          label="Assessed amount (KES)"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setErrors((current) => ({ ...current, amount: '' }));
          }}
          inputMode="decimal"
          hint={`${formatMoney(alreadySettled)} is already settled against this fine.`}
          error={errors.amount}
          required
        />
        <TextAreaField
          label="Description"
          value={description}
          onChange={(value) => {
            setDescription(value);
            setErrors((current) => ({ ...current, description: '' }));
          }}
          rows={2}
          maxLength={500}
          hint="Clearing keeps the current text — the schema has no way to blank it."
          error={errors.description}
        />
      </form>
    </Dialog>
  );
}

/* ── Waive dialog ──────────────────────────────────────────────────────────── */

function WaiveFineDialog({ fine, onClose }: { fine: FineDto; onClose: () => void }): ReactNode {
  const { notify } = useToast();
  const [amount, setAmount] = useState(fineBalance(fine));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const balance = fineBalance(fine);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!positiveMoney(amount)) {
      setErrors({ amount: 'Enter a positive amount, e.g. 50 or 50.00.' });
      return;
    }
    if (Number(amount) > Number(balance)) {
      setErrors({ amount: `Cannot waive more than the ${formatMoney(balance)} still owed.` });
      return;
    }
    if (!reason.trim()) {
      setErrors({ reason: 'A reason is required and recorded on the fine.' });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await waiveFine(fine.id, { amount: amount.trim(), reason: reason.trim() });
      notify(`${formatMoney(amount.trim())} waived on ${fine.reference}`, 'success');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not waive that amount.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`Waive part of ${fine.reference}`}
      description="Writes off an amount without taking a payment. The reason is recorded on the fine for audit."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="waive-fine-form"
            variant="danger"
            busy={busy}
            busyLabel="Waiving…"
          >
            Waive amount
          </Button>
        </>
      }
    >
      <form id="waive-fine-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}
        <TextField
          label="Amount to waive (KES)"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setErrors((current) => ({ ...current, amount: '' }));
          }}
          inputMode="decimal"
          hint={`${formatMoney(balance)} still owed on this fine.`}
          error={errors.amount}
          required
        />
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            setErrors((current) => ({ ...current, reason: '' }));
          }}
          rows={2}
          maxLength={500}
          hint="e.g. 'Damage was disputed and withdrawn' — shown on the audit trail."
          error={errors.reason}
          required
        />
      </form>
    </Dialog>
  );
}
