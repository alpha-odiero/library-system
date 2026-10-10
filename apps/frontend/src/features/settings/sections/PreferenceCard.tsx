import type { ReactNode } from 'react';
import { Card } from '../../../components/ui/Card';
import { CheckboxField, SelectField } from '../../../components/ui/Field';
import { useAuth } from '../../../contexts/AuthContext';
import { usePreference } from '../../../lib/preferences';
import type { PreferenceDef } from '../sections';

/**
 * Personal preferences: toggles and choices that live in this browser.
 *
 * Each row saves the moment it changes, because there is no round trip to wait
 * for — and because a Save button over a local value implies the server was
 * asked something it was not. The card says where the values are kept.
 */
export function PreferenceCard({
  title,
  description,
  scope,
  preferences,
  footer,
}: {
  title: string;
  description?: string;
  /** Shown as the storage note; naming the device is the point of the card. */
  scope: string;
  preferences: readonly PreferenceDef[];
  footer?: ReactNode;
}): ReactNode {
  const { session } = useAuth();
  const userId = session?.userId ?? 'anonymous';

  return (
    <Card title={title} description={description}>
      <div className="settings-fields">
        {preferences.map((preference) => (
          <PreferenceRow
            key={preference.id}
            userId={userId}
            preference={preference}
            scope={scope}
          />
        ))}
      </div>
      <p className="form__note">{footer ?? `Saved on ${scope} for your account only.`}</p>
    </Card>
  );
}

function PreferenceRow({
  userId,
  preference,
  scope,
}: {
  userId: string;
  preference: PreferenceDef;
  scope: string;
}): ReactNode {
  const [value, setValue] = usePreference<boolean | number>(
    userId,
    `preference.${preference.id}`,
    preference.default,
  );

  if (preference.kind === 'select' && preference.options) {
    return (
      <div className="settings-field">
        <SelectField
          label={preference.label}
          value={String(value)}
          options={preference.options.map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
          onChange={(next) => setValue(Number(next))}
          hint={`${preference.description} Saved on ${scope}.`}
        />
      </div>
    );
  }

  return (
    <div className="settings-field">
      <CheckboxField
        label={preference.label}
        checked={value === true}
        hint={`${preference.description} Saved on ${scope}.`}
        onChange={setValue}
      />
    </div>
  );
}
