import type { ReactNode } from 'react';
import type { RoleCode } from '@lms/shared';
import { PasswordCard, SessionsCard } from '../../auth/components/SecurityCards';
import type { SettingDto } from '../api';
import { OrgSection } from './OrgSection';

/**
 * Security: the administrator's sign-in policy, and everyone's own account.
 *
 * For a librarian or a member this section is entirely theirs — password and
 * devices. For an administrator it additionally carries the one policy that
 * decides how a NEW account gets in, which is why their navigation calls it
 * "Security & Access".
 */
export function SecuritySection({
  role,
  settings,
  onSaved,
}: {
  role: RoleCode | null | undefined;
  settings?: Map<string, SettingDto> | undefined;
  onSaved?: ((updates: Record<string, unknown>) => void) | undefined;
}): ReactNode {
  return (
    <>
      {role === 'ADMIN' && settings && onSaved && (
        <OrgSection
          section="security"
          settings={settings}
          onSaved={onSaved}
          title="Sign-in policy"
          description="Applies to every account in this library, including the ones created next week."
        />
      )}

      <PasswordCard />
      <SessionsCard />
    </>
  );
}
