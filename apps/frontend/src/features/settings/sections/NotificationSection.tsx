import type { ReactNode } from 'react';
import type { RoleCode } from '@lms/shared';
import type { SettingDto } from '../api';
import { notificationPreferencesFor } from '../sections';
import { OrgSection } from './OrgSection';
import { PreferenceCard } from './PreferenceCard';

/**
 * Notifications, in two halves for an administrator and one for everyone else.
 *
 * The organization half is policy — how many days ahead the library reminds a
 * borrower — and it is the only part the server knows about, audited and
 * enforced there. The personal half is what reaches this person on this device.
 * They are kept in separate cards because confusing them is how someone ends up
 * thinking a browser toggle changed the library's reminder schedule.
 */
export function NotificationSection({
  role,
  settings,
  onSaved,
}: {
  role: RoleCode | null | undefined;
  settings?: Map<string, SettingDto> | undefined;
  onSaved?: ((updates: Record<string, unknown>) => void) | undefined;
}): ReactNode {
  const isAdmin = role === 'ADMIN';

  return (
    <>
      {isAdmin && settings && onSaved && (
        <OrgSection
          section="notifications"
          settings={settings}
          onSaved={onSaved}
          title="Reminder policy"
          description="When the library tells a borrower that something is due. Applies to everyone."
        />
      )}

      <PreferenceCard
        title="Reach me about"
        description="What you are told about, on this device."
        scope="this device"
        preferences={notificationPreferencesFor(role)}
      />
    </>
  );
}
