import type { Paginated } from '../../lib/api';
import { api } from '../../lib/api';

/**
 * Notifications are strictly per-user and there is no public or broadcast feed to
 * read: the list endpoint always filters `where.userId = principal.userId`, so a
 * member's "Notice Board" and a librarian's are different documents by
 * construction. The client does not send a user id and could not widen the query
 * even if it tried.
 *
 * `data` is a JSON blob whose shape depends on `type` — it is the payload for a
 * deep link or an inline action, not a renderable body. Treat it as opaque and
 * switch on `type` before reading a key.
 */

export type NotificationTypeDto =
  | 'LOAN_DUE'
  | 'LOAN_OVERDUE'
  | 'RESERVATION_READY'
  | 'FINE_ASSESSED'
  | 'MEMBERSHIP_EXPIRING'
  | 'SYSTEM';

export interface NotificationDto {
  id: string;
  userId: string;
  /**
   * Known types are enumerated, but the union is kept open with `| (string & {})`
   * rather than `| string`. A plain `| string` would collapse the union to `string`
   * and delete every autocomplete hint at the call site; this form preserves the
   * known members as suggestions while still admitting a type the server adds
   * later — which is why `noticeIcon` must have a default branch.
   */
  type: NotificationTypeDto | (string & {});
  title: string;
  message: string;
  /** Type-specific JSON payload. Opaque — switch on `type` before reading it. */
  data: unknown;
  channel: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export type NotificationFilters = {
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  unreadOnly?: boolean;
};

export function listNotifications(
  filters: NotificationFilters,
  signal?: AbortSignal,
): Promise<Paginated<NotificationDto>> {
  return api.get<NotificationDto[]>('/notifications', {
    query: { ...filters },
    ...(signal ? { signal } : {}),
  }) as Promise<Paginated<NotificationDto>>;
}

/** Count for the topbar badge. A failure here must never break the shell. */
export async function unreadCount(): Promise<number> {
  const page = await listNotifications({ unreadOnly: true, limit: 1 });
  return page.meta?.total ?? 0;
}

export function markRead(id: string) {
  return api.post<{ notification: NotificationDto }>(`/notifications/${id}/read`);
}

export function markAllRead() {
  return api.post<{ updated: number }>('/notifications/read-all');
}

export function removeNotification(id: string) {
  return api.delete<void>(`/notifications/${id}`);
}

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  LOAN_DUE: 'Loan due',
  LOAN_OVERDUE: 'Overdue',
  RESERVATION_READY: 'Reservation ready',
  FINE_ASSESSED: 'Fine',
  MEMBERSHIP_EXPIRING: 'Membership',
  SYSTEM: 'System',
};
