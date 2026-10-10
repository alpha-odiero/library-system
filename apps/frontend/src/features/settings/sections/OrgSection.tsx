import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { CheckboxField, TextField } from '../../../components/ui/Field';
import { EmptyState } from '../../../components/ui/States';
import { ApiError } from '../../../lib/api';
import { useToast } from '../../../contexts/ToastContext';
import { updateSettings, type SettingDto } from '../api';
import { draftFromValue, orgFieldsFor, parseOrgField, type OrgFieldDef } from '../fields';
import type { OrgSectionId } from '../sections';

const SAVE_FAILED = 'Unable to save settings. Please try again.';

/**
 * One administrator section — Organization, Circulation, Fines and the rest.
 *
 * A single Save for the section rather than one per row: these values are read
 * together by the borrowing policy, and saving the fine rate while the block
 * threshold still holds the old number leaves the desk in a state nobody chose.
 * Every field in the section is validated before anything is sent, so a typo in
 * the last row cannot be preceded by four writes.
 *
 * The form is driven by the registry in `fields.ts`; the control, its rules and
 * its wire format all come from there, which is why a new policy key is one
 * entry in that array and nothing here.
 */
export function OrgSection({
  section,
  settings,
  onSaved,
  title,
  description,
}: {
  section: OrgSectionId;
  settings: Map<string, SettingDto>;
  onSaved: (updates: Record<string, unknown>) => void;
  title?: string;
  description?: string;
}): ReactNode {
  const { notify } = useToast();

  const fields = useMemo(
    () => orgFieldsFor(section).filter((field) => settings.has(field.key)),
    [section, settings],
  );

  // Mounted after the page has loaded, so the first render already sees every
  // value; the initialiser is what keeps typing from being overwritten by the
  // effect that would otherwise re-seed from props.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.key, draftFromValue(settings.get(field.key)?.value ?? null)]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rawCurrency = settings.get('org.currency')?.value;
  const currency = typeof rawCurrency === 'string' ? rawCurrency : '';

  /** Parsed values that differ from what the server currently holds. */
  const changes = useMemo(() => {
    const updates: Record<string, unknown> = {};
    for (const field of fields) {
      const setting = settings.get(field.key);
      if (!setting) continue;
      const result = parseOrgField(field, drafts[field.key] ?? '', setting.valueType);
      if (!result.ok) continue;
      if (JSON.stringify(result.value) !== JSON.stringify(setting.value)) {
        updates[field.key] = result.value;
      }
    }
    return updates;
  }, [fields, drafts, settings]);

  const dirty = Object.keys(changes).length > 0;

  function update(field: OrgFieldDef, value: string): void {
    setDrafts((current) => ({ ...current, [field.key]: value }));
    setErrors((current) => {
      if (!current[field.key]) return current;
      const next = { ...current };
      delete next[field.key];
      return next;
    });
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const nextErrors: Record<string, string> = {};
    const updates: Record<string, unknown> = {};

    for (const field of fields) {
      const setting = settings.get(field.key);
      if (!setting) continue;
      const result = parseOrgField(field, drafts[field.key] ?? '', setting.valueType);
      if (!result.ok) {
        nextErrors[field.key] = result.message;
        continue;
      }
      if (JSON.stringify(result.value) !== JSON.stringify(setting.value)) {
        updates[field.key] = result.value;
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (Object.keys(updates).length === 0) {
      notify('No changes to save.', 'info');
      return;
    }

    setSaving(true);
    try {
      const response = await updateSettings(updates);
      const saved = Object.fromEntries(
        response.data.settings.map((setting) => [setting.key, setting.value]),
      );
      onSaved(saved);
      notify('Settings updated', 'success');
      setDrafts((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(saved)) next[key] = draftFromValue(value);
        return next;
      });
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  }

  if (fields.length === 0) {
    return (
      <Card title={title ?? 'Policy values'}>
        <EmptyState
          title="Nothing to configure here yet"
          description="This section has no settings on file for your library."
        />
      </Card>
    );
  }

  return (
    <Card title={title} description={description}>
      <form onSubmit={(event) => void handleSave(event)} noValidate>
        {formError && (
          <p className="form__error" role="alert">
            {formError}
          </p>
        )}

        <div className="settings-fields">
          {fields.map((field) => {
            const draft = drafts[field.key] ?? '';
            const hint =
              field.kind === 'money' && currency
                ? `${field.description} Amounts are in ${currency}.`
                : field.description;

            if (field.kind === 'toggle') {
              return (
                <div className="settings-field" key={field.key}>
                  <CheckboxField
                    label={field.label}
                    checked={draft === 'true'}
                    hint={hint}
                    onChange={(checked) => update(field, checked ? 'true' : 'false')}
                  />
                  {errors[field.key] && (
                    <p className="field__error" role="alert">
                      {errors[field.key]}
                    </p>
                  )}
                </div>
              );
            }

            return (
              <div className="settings-field" key={field.key}>
                <TextField
                  label={field.label}
                  value={draft}
                  onChange={(value) => update(field, value)}
                  type={field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'tel' : 'text'}
                  /*
                   * `inputMode` and `placeholder` are spread conditionally:
                   * `exactOptionalPropertyTypes` rejects an explicit `undefined`
                   * for props declared as `placeholder?: string`, so omitting
                   * the key is the type-safe way to say "no placeholder".
                   */
                  {...(field.kind === 'integer' || field.kind === 'money'
                    ? { inputMode: 'decimal' as const }
                    : field.kind === 'tel'
                      ? { inputMode: 'tel' as const }
                      : {})}
                  {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                  hint={hint}
                  error={errors[field.key]}
                  required={field.required}
                  autoComplete={
                    field.key === 'org.email'
                      ? 'email'
                      : field.key === 'org.phone'
                        ? 'tel'
                        : 'organization'
                  }
                />
              </div>
            );
          })}
        </div>

        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            busy={saving}
            busyLabel="Saving…"
            disabled={saving || !dirty}
          >
            Save changes
          </Button>
          <p className="form__note">
            Every write is audit-logged with the value it replaced, and takes effect on the next
            read at the desk.
          </p>
        </div>
      </form>
    </Card>
  );
}
