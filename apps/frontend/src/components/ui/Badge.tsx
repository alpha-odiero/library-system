import type { ReactNode } from 'react';
import type { MemberStatusDto } from '@lms/shared';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

/**
 * A status pill.
 *
 * Tone is only ever set from a known finite set of states, never from free text.
 * That is why this component takes a `tone` union instead of a colour: a status
 * that reaches a sixth state becomes a type error at the call site, rather than a
 * pill rendered in an undefined class that silently inherits the page's text
 * colour and reads as neutral when it is actually "suspended".
 */
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}): ReactNode {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** Maps a member status to a tone. One place, so the list and detail agree. */
const MEMBER_STATUS_TONES: Record<MemberStatusDto, BadgeTone> = {
  ACTIVE: 'ok',
  INACTIVE: 'neutral',
  SUSPENDED: 'bad',
  EXPIRED: 'warn',
  PENDING: 'info',
};

/** `SUSPENDED` reads as `Suspended`; the enum is not shown raw to a member. */
const MEMBER_STATUS_LABELS: Record<MemberStatusDto, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Expired',
  PENDING: 'Pending',
};

export function MemberStatusBadge({ status }: { status: MemberStatusDto }): ReactNode {
  return <Badge tone={MEMBER_STATUS_TONES[status]}>{MEMBER_STATUS_LABELS[status]}</Badge>;
}

export function ActiveBadge({ isActive }: { isActive: boolean }): ReactNode {
  return <Badge tone={isActive ? 'ok' : 'neutral'}>{isActive ? 'Active' : 'Inactive'}</Badge>;
}

/** For `requiresApproval` and similar boolean policy flags. */
export function PolicyBadge({ required }: { required: boolean }): ReactNode {
  return (
    <Badge tone={required ? 'info' : 'neutral'}>
      {required ? 'Approval required' : 'Open access'}
    </Badge>
  );
}
