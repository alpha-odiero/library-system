import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { formatMoney } from '../../../lib/format';
import { ActiveBadge, PolicyBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { CheckboxField, SelectField, TextField } from '../../../components/ui/Field';
import { ConfirmDialog, Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/States';
import { DataTable, type Column } from '../../../components/ui/Table';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import {
  createMemberType,
  deactivateMemberType,
  updateMemberType,
  type MemberTypeDto,
  type MemberTypeInput,
} from '../api';
import { useMemberTypeList } from '../useMemberQueries';

/**
 * Borrowing policies.
 *
 * A member type is not a label — it decides how many books a person may hold, for
 * how long, how often they may renew, and what they owe per day. That is why the
 * create form asks for the money fields as text and why the table renders them
 * through `formatMoney`: these numbers decide whether a person is blocked from
 * borrowing, and a floating-point round-trip through a JSON number would move the
 * fine by a cent.
 *
 * Deactivation is the only destructive action offered, and it is deliberately not
 * a delete. Members and loans reference these rows; `onDelete: Restrict` would
 * refuse anyway, and `DELETE` that does not delete is a lie in the HTTP semantics.
 */
export function MemberTypeListPage(): ReactNode {
  const { can } = useAuth();
  const { notify } = useToast();

  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MemberTypeDto | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<MemberTypeDto | null>(null);
  const [busy, setBusy] = useState(false);

  const { memberTypes, loading, error, reload } = useMemberTypeList({
    limit: 100,
    includeInactive,
  });

  const canManage = can('MEMBER_TYPE_MANAGE');

  async function handleDeactivate(): Promise<void> {
    if (!pendingDeactivation) return;
    setBusy(true);

    try {
      await deactivateMemberType(pendingDeactivation.id);
      notify(`${pendingDeactivation.name} deactivated`, 'success');
      setPendingDeactivation(null);
      // Without this the row keeps its "Active" badge until the page is reloaded,
      // which reads as a failed action.
      await reload();
    } catch (caught) {
      notify(
        caught instanceof ApiError ? caught.message : 'Could not deactivate that type',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<MemberTypeDto>[] = [
    { key: 'name', header: 'Name', render: (type) => type.name },
    { key: 'code', header: 'Code', render: (type) => <code className="code">{type.code}</code> },
    {
      key: 'loans',
      header: 'Borrowing',
      render: (type) => `${type.maxActiveLoans} · ${type.loanDurationDays}d`,
    },
    {
      key: 'renewals',
      header: 'Renewals',
      secondary: true,
      render: (type) => `${type.maxRenewals} × ${type.renewalDurationDays}d`,
    },
    {
      key: 'fine',
      header: 'Fine per day',
      align: 'right',
      render: (type) => formatMoney(type.finePerDay),
    },
    {
      key: 'cap',
      header: 'Fine cap',
      align: 'right',
      secondary: true,
      render: (type) => (type.maxFineCap === null ? 'No cap' : formatMoney(type.maxFineCap)),
    },
    { key: 'status', header: 'Status', render: (type) => <ActiveBadge isActive={type.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (type) =>
        canManage ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(type)}>
            Edit
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Student types</h1>
          <p className="page-header__subtitle">
            Borrowing rules applied at issue time. Changing a type affects new borrowing records,
            not existing ones.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New student type
          </Button>
        )}
      </header>

      <Card>
        <div className="filters">
          <CheckboxField
            label="Include inactive types"
            checked={includeInactive}
            onChange={setIncludeInactive}
            hint="Inactive types stay on old student records and cannot be chosen for new ones."
          />
        </div>

        {error ? (
          <ErrorState error={error} />
        ) : (
          <DataTable
            caption="Student types"
            columns={columns}
            rows={memberTypes}
            rowKey={(type) => type.id}
            loading={loading}
            emptyTitle="No student types configured"
            emptyDescription="A library needs at least one type before students can be registered."
          />
        )}
      </Card>

      {canManage && (
        <Card title="Actions">
          <p className="form__note">
            Deactivating a type stops it appearing when registering a member. Existing members keep
            the type they were registered under.
          </p>
          <div className="chip-row">
            {memberTypes
              .filter((type) => type.isActive)
              .map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className="chip"
                  onClick={() => setPendingDeactivation(type)}
                >
                  Deactivate {type.name}
                </button>
              ))}
          </div>
        </Card>
      )}

      {creating && (
        <MemberTypeDialog
          onClose={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}

      {editing && (
        <MemberTypeEditDialog
          memberType={editing}
          onClose={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDeactivation !== null}
        title="Deactivate this student type?"
        message={
          <>
            <strong>{pendingDeactivation?.name}</strong> will not be offered for new students.
            Nobody loses an existing membership, and no record is deleted.
          </>
        }
        confirmLabel="Deactivate"
        busy={busy}
        onConfirm={() => void handleDeactivate()}
        onCancel={() => setPendingDeactivation(null)}
      />
    </>
  );
}

/**
 * Create a member type.
 *
 * Money is entered as text and validated here to the same shape the server
 * requires (`/^\d+(\.\d{1,2})?$/`) rather than with `type="number"`. A number input
 * reports 0.30 as 0.3 and happily accepts 0.305, which the server rejects with a
 * message about a field the user cannot see.
 */
function MemberTypeDialog({ onClose }: { onClose: () => void }): ReactNode {
  return <MemberTypeFormDialog mode="create" onClose={onClose} />;
}

/**
 * Editing an existing type.
 *
 * Three things differ from creation, and each is a trap rather than a style choice:
 *
 *   1. **No code field.** The update schema omits `code` deliberately: it appears
 *      in membership numbers and audit rows, so editing it would orphan history
 *      written against the old value. Offering the field would invite an action
 *      the server will refuse.
 *   2. **Only changed fields are sent.** The schema requires at least one change,
 *      and a PATCH carrying every field would rewrite unchanged values — which
 *      makes the audit trail lie about what the librarian actually touched.
 *   3. **The fine cap has three states, not two.** `undefined` means "leave
 *      alone", `null` means "no cap", and a string means "set this amount". A blank
 *      text box collapses the first two into one and silently caps nothing.
 */
function MemberTypeEditDialog({
  memberType,
  onClose,
}: {
  memberType: MemberTypeDto;
  onClose: () => void;
}): ReactNode {
  return <MemberTypeFormDialog mode="edit" memberType={memberType} onClose={onClose} />;
}

type CapMode = 'unchanged' | 'uncapped' | 'custom';

function MemberTypeFormDialog({
  mode,
  memberType,
  onClose,
}: {
  mode: 'create' | 'edit';
  memberType?: MemberTypeDto;
  onClose: () => void;
}): ReactNode {
  const { notify } = useToast();
  const editing = mode === 'edit' && memberType !== undefined;

  const [form, setForm] = useState({
    code: memberType?.code ?? '',
    name: memberType?.name ?? '',
    maxActiveLoans: String(memberType?.maxActiveLoans ?? 5),
    loanDurationDays: String(memberType?.loanDurationDays ?? 14),
    maxRenewals: String(memberType?.maxRenewals ?? 2),
    finePerDay: memberType?.finePerDay ?? '50.00',
    maxFineCap: memberType?.maxFineCap ?? '',
    requiresApproval: memberType?.requiresApproval ?? false,
  });
  const [capMode, setCapMode] = useState<CapMode>(
    memberType === undefined ? 'unchanged' : memberType.maxFineCap === null ? 'uncapped' : 'custom',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = (value: string): string | undefined =>
    /^\d+(\.\d{1,2})?$/.test(value.trim()) ? value.trim() : undefined;

  /** Only fields the user actually changed, so the audit trail stays truthful. */
  function changedFields(): Partial<MemberTypeInput> {
    const patch: Partial<MemberTypeInput> = {};

    if (form.name.trim() !== (memberType?.name ?? '')) patch.name = form.name.trim();
    if (Number(form.maxActiveLoans) !== (memberType?.maxActiveLoans ?? 5)) {
      patch.maxActiveLoans = Number(form.maxActiveLoans);
    }
    if (Number(form.loanDurationDays) !== (memberType?.loanDurationDays ?? 14)) {
      patch.loanDurationDays = Number(form.loanDurationDays);
    }
    if (Number(form.maxRenewals) !== (memberType?.maxRenewals ?? 2)) {
      patch.maxRenewals = Number(form.maxRenewals);
    }
    if (form.requiresApproval !== (memberType?.requiresApproval ?? false)) {
      patch.requiresApproval = form.requiresApproval;
    }

    const fine = amount(form.finePerDay);
    if (fine !== undefined && fine !== (memberType?.finePerDay ?? '')) patch.finePerDay = fine;

    if (capMode === 'uncapped' && memberType?.maxFineCap !== null) patch.maxFineCap = null;
    if (capMode === 'custom') {
      const cap = amount(form.maxFineCap);
      if (cap !== undefined && cap !== memberType?.maxFineCap) patch.maxFineCap = cap;
    }

    return patch;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // Caught before the request: an invalid amount would otherwise produce a
    // server error message on a field the user may have already scrolled past.
    if (amount(form.finePerDay) === undefined) {
      setErrors((current) => ({
        ...current,
        finePerDay: 'Enter an amount with at most 2 decimals',
      }));
      return;
    }
    if (capMode === 'custom' && amount(form.maxFineCap) === undefined) {
      setErrors((current) => ({
        ...current,
        maxFineCap: 'Enter an amount with at most 2 decimals',
      }));
      return;
    }

    const input: MemberTypeInput = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      maxActiveLoans: Number(form.maxActiveLoans),
      loanDurationDays: Number(form.loanDurationDays),
      maxRenewals: Number(form.maxRenewals),
      finePerDay: amount(form.finePerDay) ?? '0.00',
      // On create, a blank cap simply means "no cap", so it is always sent.
      ...(form.maxFineCap.trim() ? { maxFineCap: amount(form.maxFineCap) ?? null } : {}),
      requiresApproval: form.requiresApproval,
    };

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      if (editing) {
        const patch = changedFields();

        // The schema rejects an empty PATCH, and an explicit message beats a 400
        // whose only content is "at least one field".
        if (Object.keys(patch).length === 0) {
          notify('Nothing to save — no field was changed.', 'info');
          setBusy(false);
          return;
        }

        await updateMemberType(memberType.id, patch);
        notify(`${memberType.name} updated`, 'success');
      } else {
        await createMemberType(input);
        notify(`${input.name} created`, 'success');
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError(`Could not ${editing ? 'update' : 'create'} that student type.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={editing ? `Edit ${memberType.name}` : 'New member type'}
      description="Decides how many books this student may hold, for how long, and what they owe per day."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/*
            `form=` submits the form from outside it. The button lives in the dialog
            footer for visual balance, and a footer button outside the <form> would
            otherwise do nothing at all — which is the most common way a dialog's
            confirm button ends up inert.
          */}
          <Button
            type="submit"
            form="member-type-form"
            variant="primary"
            busy={busy}
            busyLabel={editing ? 'Saving…' : 'Creating…'}
          >
            {editing ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="member-type-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <div className="form__row">
          {editing ? (
            // Shown read-only rather than omitted: the librarian can see what
            // identifies this type without being able to change it.
            <div className="field">
              <span className="field__label">Code</span>
              <p className="code">
                <code className="code">{memberType.code}</code>
              </p>
              <span className="field__hint">
                Cannot be changed — it appears on membership numbers and past audit records.
              </span>
            </div>
          ) : (
            <TextField
              label="Code"
              value={form.code}
              onChange={(value) =>
                setForm((current) => ({ ...current, code: value.toUpperCase() }))
              }
              hint="Letters, digits and underscores. Appears on membership numbers."
              required
              error={errors.code}
            />
          )}
          <TextField
            label="Name"
            value={form.name}
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
            required
            error={errors.name}
          />
        </div>

        <div className="form__row">
          <TextField
            label="Maximum active borrowing"
            type="number"
            value={form.maxActiveLoans}
            onChange={(value) => setForm((current) => ({ ...current, maxActiveLoans: value }))}
            inputMode="numeric"
            min="0"
            max="100"
            error={errors.maxActiveLoans}
          />
          <TextField
            label="Borrowing duration (days)"
            type="number"
            value={form.loanDurationDays}
            onChange={(value) => setForm((current) => ({ ...current, loanDurationDays: value }))}
            inputMode="numeric"
            min="1"
            max="365"
            error={errors.loanDurationDays}
          />
        </div>

        <div className="form__row">
          <TextField
            label="Maximum renewals"
            type="number"
            value={form.maxRenewals}
            onChange={(value) => setForm((current) => ({ ...current, maxRenewals: value }))}
            inputMode="numeric"
            min="0"
            max="50"
            error={errors.maxRenewals}
          />
          <div className="field">
            <span className="field__label">Approval</span>
            <PolicyBadge required={form.requiresApproval} />
          </div>
        </div>

        <div className="form__row">
          <TextField
            label="Fine per day"
            value={form.finePerDay}
            onChange={(value) => setForm((current) => ({ ...current, finePerDay: value }))}
            inputMode="decimal"
            hint="Decimal amount, at most 2 places."
            required
            error={errors.finePerDay}
          />
          {editing ? (
            <div className="field">
              <span className="field__label">Fine cap</span>
              <SelectField
                label="Cap"
                value={capMode}
                onChange={setCapMode}
                options={[
                  { value: 'unchanged', label: 'Leave as it is' },
                  { value: 'uncapped', label: 'No cap' },
                  { value: 'custom', label: 'Set an amount' },
                ]}
              />
              {capMode === 'custom' && (
                <TextField
                  label="Cap amount"
                  value={form.maxFineCap}
                  onChange={(value) => setForm((current) => ({ ...current, maxFineCap: value }))}
                  inputMode="decimal"
                  required
                  error={errors.maxFineCap}
                />
              )}
            </div>
          ) : (
            <TextField
              label="Fine cap"
              value={form.maxFineCap}
              onChange={(value) => setForm((current) => ({ ...current, maxFineCap: value }))}
              inputMode="decimal"
              hint="Blank means no cap."
              error={errors.maxFineCap}
            />
          )}
        </div>

        <CheckboxField
          label="New students need approval"
          checked={form.requiresApproval}
          onChange={(value) => setForm((current) => ({ ...current, requiresApproval: value }))}
        />
      </form>
    </Dialog>
  );
}
