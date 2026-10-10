import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MemberStatusDto } from '@lms/shared';
import { ApiError } from '../../../lib/api';
import { fieldErrors } from '../../../lib/contracts';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field';
import { useToast } from '../../../contexts/ToastContext';
import { paths } from '../../../routes/paths';
import { useBranchOptions } from '../../branches/useBranchOptions';
import { MEMBER_STATUS_FILTERS, useMemberTypeList } from '../useMemberQueries';
import { getMember, updateMember, type MemberDto, type MemberUpdateInput } from '../api';

/**
 * Edit a member.
 *
 * The form sends only what changed, and that is not an optimisation:
 *
 *   • The update schema is `.strict()` and rejects an entirely empty PATCH, so a
 *     submit-with-no-edits must be caught before it costs a round trip and an
 *     audit row.
 *   • The schema distinguishes `null` (clear a field) from absent (leave it). The
 *     form tracks which text inputs the user actually touched, so clearing a field
 *     sends `null` deliberately while an untouched field is omitted entirely. A
 *     form that sent every field would blank the address of anyone coming here to
 *     fix a phone number.
 *
 * Membership number and account creation are not editable here. The number is
 * embedded in printed material and audit rows, and accounts are managed with the
 * credential, not with the member.
 */
export function MemberEditPage(): ReactNode {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [member, setMember] = useState<MemberDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    address: '',
    city: '',
    occupation: '',
    notes: '',
    memberTypeId: '',
    homeBranchId: '',
    status: 'ACTIVE' as MemberStatusDto,
    expiresAt: '',
  });
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { branches, loading: branchesLoading } = useBranchOptions();
  const { memberTypes, loading: typesLoading } = useMemberTypeList({ limit: 100 });

  // One branch → home branch is not something to change here. The select is
  // dropped and the current branch is left as it is (the value still lives in
  // `form.homeBranchId`, it just stops being offered for editing).
  const singleBranch = branches.length === 1 ? branches[0] : null;

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setLoadError(null);

      try {
        const { data } = await getMember(id, signal);
        setMember(data.member);
        setForm({
          firstName: data.member.account?.firstName ?? '',
          lastName: data.member.account?.lastName ?? '',
          email: data.member.account?.email ?? '',
          // Phone is on `User` and is not projected by the member DTO, so it is
          // left untouched rather than pre-filled with a guess.
          phone: '',
          dateOfBirth: data.member.dateOfBirth ?? '',
          gender: data.member.gender ?? '',
          address: data.member.address ?? '',
          city: data.member.city ?? '',
          occupation: data.member.occupation ?? '',
          notes: data.member.notes ?? '',
          memberTypeId: data.member.memberType.id,
          homeBranchId: data.member.homeBranch.id,
          status: data.member.status,
          expiresAt: data.member.expiresAt ?? '',
        });
        setTouched(new Set());
      } catch (caught) {
        if (!signal.aborted) setLoadError(caught);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function update(field: keyof typeof form, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const input: MemberUpdateInput = {};
    const text = (field: string, value: string): void => {
      if (!touched.has(field)) return;
      const trimmed = value.trim();
      // Cleared fields are sent as `null`, which the server reads as "erase this".
      // Untouched fields are omitted entirely — see the note above.
      (input as Record<string, unknown>)[field] = trimmed === '' ? null : trimmed;
    };

    text('firstName', form.firstName);
    text('lastName', form.lastName);
    text('email', form.email);
    text('dateOfBirth', form.dateOfBirth);
    text('gender', form.gender);
    text('address', form.address);
    text('city', form.city);
    text('occupation', form.occupation);
    text('notes', form.notes);
    text('expiresAt', form.expiresAt);

    if (touched.has('phone')) input.phone = form.phone.trim() === '' ? null : form.phone.trim();
    if (touched.has('memberTypeId')) input.memberTypeId = form.memberTypeId;
    if (touched.has('homeBranchId')) input.homeBranchId = form.homeBranchId;
    if (touched.has('status')) input.status = form.status;

    if (Object.keys(input).length === 0) {
      setFormError('Nothing has changed yet.');
      return;
    }

    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      await updateMember(id, input);
      notify('Student updated', 'success');
      void navigate(paths.member(id), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrors(error.details));
        setFormError(error.message);
      } else {
        setFormError('Could not save those changes.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading student" rows={6} />;
  if (loadError)
    return <ErrorState error={loadError} onRetry={() => void load(new AbortController().signal)} />;
  if (!member) return null;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">
            <button type="button" className="link" onClick={() => void navigate(paths.member(id))}>
              {member.membershipNumber}
            </button>
          </p>
          <h1 className="page-header__title">Edit student</h1>
          <p className="page-header__subtitle">Only the fields you change are sent.</p>
        </div>
      </header>

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <Card title="Identity">
          <div className="form__row">
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(value) => update('firstName', value)}
              required
              error={errors.firstName}
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(value) => update('lastName', value)}
              required
              error={errors.lastName}
            />
          </div>

          <div className="form__row">
            <TextField
              label="Email address"
              type="email"
              value={form.email}
              onChange={(value) => update('email', value)}
              inputMode="email"
              error={errors.email}
            />
            <TextField
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(value) => update('phone', value)}
              inputMode="tel"
              hint={
                member.account === null
                  ? 'No account on file.'
                  : 'Changing this sets the phone on the account.'
              }
              error={errors.phone}
            />
          </div>

          <SelectField
            label="Status"
            value={form.status}
            onChange={(value) => update('status', value)}
            options={MEMBER_STATUS_FILTERS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            hint="Suspending blocks borrowing immediately."
            error={errors.status}
          />
        </Card>

        <Card title="Student record">
          <SelectField
            label="Student type"
            value={form.memberTypeId}
            onChange={(value) => update('memberTypeId', value)}
            options={memberTypes.map((type) => ({ value: type.id, label: type.name }))}
            disabled={typesLoading}
            error={errors.memberTypeId}
          />

          {singleBranch ? (
            <div className="field">
              <span className="field__label">Home branch</span>
              <p>{singleBranch.name}</p>
              <span className="field__hint">The only branch in this library.</span>
            </div>
          ) : (
            <SelectField
              label="Home branch"
              value={form.homeBranchId}
              onChange={(value) => update('homeBranchId', value)}
              options={branches.map((branch) => ({
                value: branch.id,
                label: `${branch.name} (${branch.code})`,
              }))}
              disabled={branchesLoading}
              error={errors.homeBranchId}
            />
          )}

          <TextField
            label="Expires on"
            type="date"
            value={form.expiresAt}
            onChange={(value) => update('expiresAt', value)}
            error={errors.expiresAt}
          />
        </Card>

        <Card title="Contact and notes">
          <div className="form__row">
            <TextField
              label="Address"
              value={form.address}
              onChange={(value) => update('address', value)}
              error={errors.address}
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(value) => update('city', value)}
              error={errors.city}
            />
          </div>

          <div className="form__row">
            <TextField
              label="Date of birth"
              type="date"
              value={form.dateOfBirth}
              onChange={(value) => update('dateOfBirth', value)}
              error={errors.dateOfBirth}
            />
            <TextField
              label="Gender"
              value={form.gender}
              onChange={(value) => update('gender', value)}
              error={errors.gender}
            />
          </div>

          <TextField
            label="Occupation"
            value={form.occupation}
            onChange={(value) => update('occupation', value)}
            error={errors.occupation}
          />

          <TextAreaField
            label="Notes"
            value={form.notes}
            onChange={(value) => update('notes', value)}
            maxLength={2000}
            error={errors.notes}
          />
        </Card>

        <div className="form__actions">
          <Button variant="ghost" onClick={() => void navigate(paths.member(id))} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
            Save changes
          </Button>
        </div>
      </form>
    </>
  );
}
