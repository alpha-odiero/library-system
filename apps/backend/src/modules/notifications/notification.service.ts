import type { NotificationType, Prisma } from '@prisma/client';
import type { AuthPrincipal } from '@lms/shared';
import { prisma } from '../../config/database.js';
import { publishRealtime } from '../../lib/events.js';
import type { Tx } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { notFound } from '../../lib/errors.js';
import { orderBy, skipTake, type PaginationQuery } from '../../lib/pagination.js';
import { SORTABLE_FIELDS } from '../../config/constants.js';

/**
 * In-app notifications.
 *
 * V1 delivers through exactly one channel: `IN_APP`, persisted in
 * `notifications` and read by the client. EMAIL / SMS / PUSH are deliberately
 * NOT columns or branches here — they are provider implementations behind
 * `dispatch()`, added when a provider exists. Modelling them now would mean a
 * schema migration and a retry-state machine for channels nobody has configured.
 *
 * Notifications are written INSIDE the transaction that caused them, with the
 * same `tx` as the business change. A notification that survives a rollback
 * tells a member their book is overdue when the return actually went through.
 */

export type NotificationChannel = 'IN_APP';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /**
   * Deep-link payload rendered by the client, e.g. `{ loanId, dueDate }`.
   *
   * Never put anything secret here: it is returned verbatim in an API response.
   * Never put an internal row id the recipient is not entitled to see.
   */
  data?: Prisma.InputJsonValue;
  actionUrl?: string | null;
  channel?: NotificationChannel;
  /**
   * Non-secret facts about the event: `{ kind, expiresAt }`.
   *
   * Separate from `data` because the two have opposite rules. `data` is rendered
   * to the recipient verbatim; this is for filtering and audit. Neither is a place
   * for a credential — see the one-time token delivery path, which keeps the token
   * in `message` only and treats this as metadata.
   */
  metadata?: Prisma.InputJsonValue;
}

export interface NotifyByMemberInput extends Omit<NotifyInput, 'userId'> {
  memberId: string;
}

type Db = Tx | typeof prisma;

/**
 * Resolves a member to the user account that authenticates.
 *
 * A member without a user account is legitimate (registered at the desk, never
 * signed in), so this returns null rather than throwing. The caller decides
 * whether that is acceptable — a circulation desk still wants the notification
 * recorded against the member.
 */
export async function userIdForMember(memberId: string, db: Db = prisma): Promise<string | null> {
  const member = await db.member.findUnique({
    where: { id: memberId },
    select: { userId: true },
  });
  return member?.userId ?? null;
}

/** Resolves many members in one query. N+1 avoidance for broadcast/sweep paths. */
export async function userIdsForMembers(
  memberIds: readonly string[],
  db: Db = prisma,
): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db.member.findMany({
    where: { id: { in: [...memberIds] } },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

export async function notify(input: NotifyInput, db: Db = prisma): Promise<string | null> {
  try {
    const created = await db.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        message: input.message.slice(0, 1000),
        // Metadata is nested under its own key rather than merged into `data`, so
        // the renderable payload stays exactly what the client expects to draw.
        data:
          input.metadata === undefined
            ? (input.data ?? {})
            : { data: input.data ?? {}, meta: input.metadata },
        channel: input.channel ?? 'IN_APP',
        actionUrl: input.actionUrl?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    publishRealtime({
      channel: 'notifications',
      action: 'Notification.created',
      entityId: created.id,
      occurredAt: new Date().toISOString(),
    });
    return created.id;
  } catch (error) {
    // Same rule as the audit log: never fail the business operation, always log.
    logger.error(
      { err: error, event: 'notification.write_failed', type: input.type, userId: input.userId },
      'Failed to write notification',
    );
    return null;
  }
}

/**
 * Notifies the user behind a member.
 *
 * Returns null when the member has no account. Callers that need to know whether
 * a member is reachable (an email-verification gate, for example) check
 * `userIdForMember` first rather than inferring from the null.
 */
export async function notifyMember(
  input: NotifyByMemberInput,
  db: Db = prisma,
): Promise<string | null> {
  const userId = await userIdForMember(input.memberId, db);
  if (!userId) {
    logger.debug(
      { event: 'notification.no_account', memberId: input.memberId, type: input.type },
      'Member has no user account; in-app notification skipped',
    );
    return null;
  }
  const { memberId: _memberId, ...rest } = input;
  return notify({ ...rest, userId }, db);
}

/**
 * Fans one message out to many users.
 *
 * `createMany` rather than a loop: a broadcast to 50,000 members is a single
 * statement instead of 50,000 round trips. Duplicates are impossible because the
 * id is server-generated and the input set is de-duplicated first.
 *
 * Not transactional with the caller's work — a failed broadcast must not roll
 * back the circulation event that triggered it.
 */
export async function notifyMany(
  userIds: readonly string[],
  input: Omit<NotifyInput, 'userId'>,
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;

  try {
    const result = await prisma.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        type: input.type,
        title: input.title.slice(0, 200),
        message: input.message.slice(0, 1000),
        data: input.data ?? {},
        channel: input.channel ?? ('IN_APP' as const),
        actionUrl: input.actionUrl?.slice(0, 300) ?? null,
      })),
    });
    publishRealtime({
      channel: 'notifications',
      action: 'Notification.broadcast',
      occurredAt: new Date().toISOString(),
    });
    return result.count;
  } catch (error) {
    logger.error(
      { err: error, event: 'notification.broadcast_failed', recipients: unique.length },
      'Failed to broadcast notification',
    );
    return 0;
  }
}

/* ── Message builders ──────────────────────────────────────────────────────── */

/**
 * Titles and copy live here rather than at the call site.
 *
 * Two reasons: the client renders `title`/`message` directly, so wording is a
 * user-facing surface that should be edited in one file; and a copy change must
 * not require touching the circulation service that triggers it.
 */

export const messages = {
  loanCreated: (title: string, dueDate: string): { title: string; message: string } => ({
    title: 'Book borrowed',
    message: `"${title}" is due on ${dueDate}. Renew it from My Loans if nobody is waiting.`,
  }),
  dueSoon: (title: string, dueDate: string, days: number): { title: string; message: string } => ({
    title: `Book due in ${days} day${days === 1 ? '' : 's'}`,
    message: `"${title}" is due on ${dueDate}.`,
  }),
  overdue: (title: string, daysOverdue: number): { title: string; message: string } => ({
    title: 'Book overdue',
    message: `"${title}" is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue. A fine may apply.`,
  }),
  loanReturned: (title: string): { title: string; message: string } => ({
    title: 'Book returned',
    message: `Thank you — "${title}" has been returned.`,
  }),
  renewed: (title: string, newDueDate: string): { title: string; message: string } => ({
    title: 'Loan renewed',
    message: `"${title}" is now due on ${newDueDate}.`,
  }),
  reservationPlaced: (title: string, position: number): { title: string; message: string } => ({
    title: 'Reservation placed',
    message: `You are #${position} in the queue for "${title}".`,
  }),
  reservationReady: (title: string, expiresAt: string): { title: string; message: string } => ({
    title: 'Your reserved book is ready',
    message: `"${title}" is being held for you until ${expiresAt}.`,
  }),
  reservationExpired: (title: string): { title: string; message: string } => ({
    title: 'Reservation expired',
    message: `The hold on "${title}" expired and was returned to the queue.`,
  }),
  reservationCancelled: (title: string): { title: string; message: string } => ({
    title: 'Reservation cancelled',
    message: `Your reservation for "${title}" was cancelled.`,
  }),
  fineAssessed: (reference: string, amount: string): { title: string; message: string } => ({
    title: 'Fine issued',
    message: `A fine of ${amount} has been issued against you (reference ${reference}).`,
  }),
  finePaid: (
    reference: string,
    amount: string,
    outstanding: string,
  ): {
    title: string;
    message: string;
  } => ({
    title: 'Payment received',
    message: `Thank you. ${amount} was received against ${reference}. Outstanding balance: ${outstanding}.`,
  }),
  fineWaived: (reference: string, amount: string): { title: string; message: string } => ({
    title: 'Fine waived',
    message: `${amount} against fine ${reference} has been waived.`,
  }),
  membershipApproved: (membershipNumber: string): { title: string; message: string } => ({
    title: 'Membership approved',
    message: `Your membership (${membershipNumber}) is active. You can borrow now.`,
  }),
  membershipExpiring: (expiresAt: string): { title: string; message: string } => ({
    title: 'Membership expiring',
    message: `Your membership expires on ${expiresAt}. Renew at the circulation desk.`,
  }),
  accountSuspended: (reason: string): { title: string; message: string } => ({
    title: 'Account suspended',
    message: `Your account has been suspended: ${reason}. Contact the library for details.`,
  }),
  general: (title: string, message: string): { title: string; message: string } => ({
    title,
    message,
  }),
  system: (title: string, message: string): { title: string; message: string } => ({
    title,
    message,
  }),
} as const;

const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  type: true,
  title: true,
  message: true,
  data: true,
  channel: true,
  actionUrl: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export function toNotificationDto(
  notification: Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>,
) {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data,
    channel: notification.channel,
    actionUrl: notification.actionUrl,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export async function listNotifications(
  principal: AuthPrincipal,
  filters: {
    unreadOnly?: boolean;
    pagination: PaginationQuery;
    sort?: string;
    direction?: 'asc' | 'desc';
  },
): Promise<{
  notifications: Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>[];
  total: number;
}> {
  const where: Prisma.NotificationWhereInput = { userId: principal.userId };
  if (filters.unreadOnly) {
    where.readAt = null;
  }

  const order = orderBy(
    ['createdAt', 'readAt'] as const,
    filters.direction ?? 'desc',
    SORTABLE_FIELDS.notification,
  );

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: order,
      ...skipTake(filters.pagination),
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}

export async function getNotification(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>> {
  const notification = await prisma.notification.findFirst({
    where: { id, userId: principal.userId },
    select: NOTIFICATION_SELECT,
  });
  if (!notification) throw notFound('Notification');
  return notification;
}

export async function markNotificationRead(
  principal: AuthPrincipal,
  id: string,
): Promise<Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>> {
  const notification = await prisma.notification.findFirst({
    where: { id, userId: principal.userId },
    select: NOTIFICATION_SELECT,
  });
  if (!notification) throw notFound('Notification');

  return prisma.notification.update({
    where: { id },
    data: { readAt: notification.readAt ?? new Date() },
    select: NOTIFICATION_SELECT,
  });
}

export async function markAllNotificationsRead(principal: AuthPrincipal): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId: principal.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function deleteNotification(principal: AuthPrincipal, id: string): Promise<void> {
  const exists = await prisma.notification.findFirst({
    where: { id, userId: principal.userId },
    select: { id: true },
  });
  if (!exists) throw notFound('Notification');
  await prisma.notification.delete({ where: { id } });
}
