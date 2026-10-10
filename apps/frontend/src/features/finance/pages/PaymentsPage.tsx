import { useState, type FormEvent, type ReactNode } from 'react';
import type { PaymentMethodDto } from '@lms/shared';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Dialog } from '../../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { DataTable, type Column } from '../../../components/ui/Table';
import { ErrorState } from '../../../components/ui/States';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { formatInstant, formatMoney, fullName } from '../../../lib/format';
import {
  PAYMENT_METHOD_LABELS,
  createPayment,
  fineBalance,
  voidPayment,
  type PaymentDto,
} from '../api';
import { useFineList, usePaymentList } from '../useFinanceQueries';

/**
 * The receipts register.
 *
 * A voided payment is shown, greyed, and never removed. This is the whole reason a
 * payment is voided rather than deleted: an audit needs to see that money was taken
 * and then given back, not to find a hole where a transaction used to be. The
 * receipt number is therefore still visible on a voided row — it is the reference a
 * member would quote.
 */
export function PaymentsPage(): ReactNode {
  const { session, can } = useAuth();
  const ownView = !can('PAYMENT_VIEW') && can('PAYMENT_VIEW_OWN');
  const [page, setPage] = useState(1);
  const [recording, setRecording] = useState(false);
  const [pendingVoid, setPendingVoid] = useState<PaymentDto | null>(null);

  const { payments, meta, loading, error, reload } = usePaymentList({
    page,
    limit: 20,
    ...(ownView && session?.memberId ? { memberId: session.memberId } : {}),
  });

  const columns: Column<PaymentDto>[] = [
    {
      key: 'receipt',
      header: 'Receipt',
      render: (payment) => (
        <div className="cell-stack">
          <span className="cell-stack__primary">{payment.receiptNumber}</span>
          {payment.reference && (
            <span className="cell-stack__secondary">Ref {payment.reference}</span>
          )}
        </div>
      ),
    },
    ...(ownView
      ? []
      : [
          {
            key: 'member',
            header: 'Student',
            render: (payment: PaymentDto) => (
              <div className="cell-stack">
                <span className="cell-stack__primary">{fullName(payment.member.user)}</span>
                <span className="cell-stack__secondary">{payment.member.membershipNumber}</span>
              </div>
            ),
          },
        ]),
    {
      key: 'fine',
      header: 'Against',
      secondary: true,
      render: (payment) =>
        payment.fine ? `${payment.fine.reference} · ${payment.fine.type.replace(/_/g, ' ')}` : '—',
    },
    { key: 'branch', header: 'Branch', secondary: true, render: (payment) => payment.branch.name },
    { key: 'method', header: 'Method', render: (payment) => PAYMENT_METHOD_LABELS[payment.method] },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (payment) => (
        <span className={payment.voidedAt === null ? '' : 'cell-muted'}>
          {formatMoney(payment.amount)}
        </span>
      ),
    },
    {
      key: 'paid_at',
      header: 'Paid',
      secondary: true,
      render: (payment) => formatInstant(payment.paidAt),
    },
    {
      key: 'status',
      header: 'Status',
      render: (payment) =>
        payment.voidedAt === null ? (
          <Badge tone="ok">Recorded</Badge>
        ) : (
          <Badge tone="bad">Voided</Badge>
        ),
    },
    ...(!ownView && can('PAYMENT_VOID')
      ? [
          {
            key: 'actions',
            header: 'Manage',
            align: 'right' as const,
            secondary: true,
            render: (payment: PaymentDto) =>
              payment.voidedAt === null ? (
                <Button variant="danger" size="sm" onClick={() => setPendingVoid(payment)}>
                  Void
                </Button>
              ) : (
                '—'
              ),
          },
        ]
      : []),
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">{ownView ? 'My Receipts' : 'Payments'}</h1>
          <p className="page-header__subtitle">
            {ownView
              ? 'Every payment recorded against your fines, including any that were voided.'
              : 'Receipts across the branches your role covers. Voided payments are retained for audit.'}
          </p>
        </div>
        {!ownView && can('PAYMENT_CREATE') && (
          <Button variant="primary" onClick={() => setRecording(true)}>
            Record payment
          </Button>
        )}
      </header>

      <Card>
        {error ? (
          <ErrorState error={error} onRetry={() => void reload()} />
        ) : (
          <>
            <DataTable
              caption={ownView ? 'Your receipts' : 'Payment register'}
              columns={columns}
              rows={payments}
              rowKey={(payment) => payment.id}
              loading={loading}
              emptyTitle={ownView ? 'You have no receipts' : 'No payments recorded yet'}
              emptyDescription={
                ownView ? 'Payments appear here once a fine is settled at the desk.' : undefined
              }
            />
            {meta.total > 0 && meta.totalPages > 1 && (
              <Pagination meta={meta} onPageChange={(next) => setPage(next)} />
            )}
          </>
        )}
      </Card>

      {recording && (
        <RecordPaymentDialog
          onClose={() => {
            setRecording(false);
            void reload();
          }}
        />
      )}

      {pendingVoid && (
        <VoidPaymentDialog
          payment={pendingVoid}
          onClose={() => {
            setPendingVoid(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

const PAYMENT_METHOD_OPTIONS: readonly { value: PaymentMethodDto; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];

/** Matches the server's `moneySchema`, minus the minus sign the schema allows. */
const POSITIVE_MONEY = /^\d+(\.\d{1,2})?$/;

function positiveMoney(value: string): boolean {
  return POSITIVE_MONEY.test(value.trim()) && Number(value.trim()) > 0;
}

/* ── Record payment dialog ─────────────────────────────────────────────────── */

function RecordPaymentDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { notify } = useToast();
  // Every fine still owed, so the attendant never has to guess a fine number.
  const fineSource = useFineList({ limit: 100 });

  const payable = fineSource.fines
    .filter(
      (fine) =>
        (fine.status === 'OUTSTANDING' || fine.status === 'PARTIAL') &&
        Number(fineBalance(fine)) > 0,
    )
    .sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));

  const [fineId, setFineId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethodDto>('CASH');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = payable.find((fine) => fine.id === fineId);

  function selectFine(id: string): void {
    setFineId(id);
    const fine = payable.find((candidate) => candidate.id === id);
    if (fine) {
      // A desk attendant taking a settlement is recording the balance, not
      // inventing a figure. Prefill it; they can still take a partial payment.
      setAmount(fineBalance(fine));
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!selected) {
      setErrors({ fineId: 'Choose the fine this payment settles.' });
      return;
    }
    if (!positiveMoney(amount)) {
      setErrors({ amount: 'Enter a positive amount, e.g. 50 or 50.00.' });
      return;
    }
    if (Number(amount) > Number(fineBalance(selected))) {
      setErrors({
        amount: `Cannot take more than the ${formatMoney(fineBalance(selected))} still owed.`,
      });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await createPayment({
        fineId: selected.id,
        amount: amount.trim(),
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      notify(`Payment of ${formatMoney(amount.trim())} recorded`, 'success');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not record that payment.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Record a payment"
      description="Takes money off a fine at the desk. The receipt stays on the register even if this payment is later voided."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="record-payment-form"
            variant="primary"
            busy={busy}
            busyLabel="Recording…"
          >
            Record payment
          </Button>
        </>
      }
    >
      <form id="record-payment-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}
        <SelectField
          label="Fine"
          value={fineId}
          onChange={selectFine}
          options={[
            {
              value: '',
              label: fineSource.loading ? 'Loading fines…' : 'Choose a fine…',
            },
            ...payable.map((fine) => ({
              value: fine.id,
              label: `${fine.reference} · ${fullName(fine.member.user)} — ${formatMoney(fineBalance(fine))} owing`,
            })),
          ]}
          disabled={fineSource.loading}
          error={errors.fineId}
        />
        <div className="form__row">
          <TextField
            label="Amount (KES)"
            value={amount}
            onChange={(value) => {
              setAmount(value);
              setErrors((current) => ({ ...current, amount: '' }));
            }}
            inputMode="decimal"
            hint={selected ? `${formatMoney(fineBalance(selected))} still owed here.` : undefined}
            error={errors.amount}
            required
          />
          <SelectField
            label="Method"
            value={method}
            onChange={setMethod}
            options={PAYMENT_METHOD_OPTIONS}
          />
        </div>
        <TextField
          label="Reference"
          value={reference}
          onChange={(value) => {
            setReference(value);
            setErrors((current) => ({ ...current, reference: '' }));
          }}
          hint="Optional — e.g. a mobile money transaction id or bank transfer reference."
          error={errors.reference}
        />
      </form>
    </Dialog>
  );
}

/* ── Void payment dialog ───────────────────────────────────────────────────── */

function VoidPaymentDialog({
  payment,
  onClose,
}: {
  payment: PaymentDto;
  onClose: () => void;
}): ReactNode {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!reason.trim()) {
      setErrors({ reason: 'A reason is required and stays on the record.' });
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await voidPayment(payment.id, reason.trim());
      notify(`Receipt ${payment.receiptNumber} voided`, 'success');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not void that payment.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`Void receipt ${payment.receiptNumber}`}
      description="Reverses the payment: the money is returned and the fine reopens for the amount. The row stays visible here for audit — it is never deleted."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="void-payment-form"
            variant="danger"
            busy={busy}
            busyLabel="Voiding…"
          >
            Void payment
          </Button>
        </>
      }
    >
      <form id="void-payment-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            setErrors((current) => ({ ...current, reason: '' }));
          }}
          rows={2}
          maxLength={255}
          hint="e.g. 'Duplicate charge', 'Refunded at the desk' — recorded on the void."
          error={errors.reason}
          required
        />
      </form>
    </Dialog>
  );
}
