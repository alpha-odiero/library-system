import type { ReactNode } from 'react';
import { Card } from '../../../components/ui/Card';
import { SelectField } from '../../../components/ui/Field';
import { useTheme, type ThemePreference } from '../../../contexts/ThemeContext';

const OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match my device' },
];

/**
 * Appearance — the one preference the whole app already reads.
 *
 * `Match my device` is a live choice: the provider subscribes to the OS colour
 * scheme, so selecting it follows the system immediately rather than on the
 * next reload. The choice is stored on this device, not in the account, which
 * is what the hint says.
 */
export function AppearanceSection(): ReactNode {
  const { preference, setPreference, theme } = useTheme();

  return (
    <Card title="Theme" description="Applies to every screen you open.">
      <div className="settings-fields">
        <div className="settings-field">
          <SelectField
            label="Colour theme"
            value={preference}
            options={OPTIONS}
            onChange={(next) => setPreference(next)}
            hint={
              preference === 'system'
                ? `Following your device — currently showing the ${theme} theme. Saved on this device.`
                : `Saved on this device for your account.`
            }
          />
        </div>
      </div>
    </Card>
  );
}
