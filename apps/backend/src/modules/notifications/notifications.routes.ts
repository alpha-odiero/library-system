import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler.js';
import { parsePagination } from '../../lib/pagination.js';
import { sendCreated, sendNoContent, sendOk, sendPaginated } from '../../lib/response.js';
import { currentPrincipal, requireAuth } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate, validated } from '../../middleware/validate.js';
import * as notifications from './notification.service.js';
import {
  notificationBroadcastSchema,
  notificationIdParamSchema,
  notificationListQuerySchema,
} from './notifications.schemas.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth(),
  requirePermission('NOTIFICATION_VIEW_OWN'),
  validate({ query: notificationListQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const query = validated.query(req, notificationListQuerySchema);
    const { notifications: items, total } = await notifications.listNotifications(principal, {
      unreadOnly: query.unreadOnly,
      pagination: parsePagination(req.query as Record<string, unknown>),
      sort: query.sort,
      direction: query.direction,
    });

    sendPaginated(res, items.map(notifications.toNotificationDto), {
      ...parsePagination(req.query as Record<string, unknown>),
      total,
    });
  }),
);

notificationsRouter.post(
  '/:id/read',
  requireAuth(),
  requirePermission('NOTIFICATION_VIEW_OWN'),
  validate({ params: notificationIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, notificationIdParamSchema);
    const item = await notifications.markNotificationRead(principal, id);
    sendOk(
      res,
      { notification: notifications.toNotificationDto(item) },
      { message: 'Notification marked as read' },
    );
  }),
);

notificationsRouter.post(
  '/read-all',
  requireAuth(),
  requirePermission('NOTIFICATION_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const count = await notifications.markAllNotificationsRead(principal);
    sendOk(res, { count }, { message: 'Notifications marked as read' });
  }),
);

notificationsRouter.delete(
  '/:id',
  requireAuth(),
  requirePermission('NOTIFICATION_DELETE_OWN'),
  validate({ params: notificationIdParamSchema }),
  asyncHandler(async (req, res) => {
    const principal = currentPrincipal(req);
    const { id } = validated.params(req, notificationIdParamSchema);
    await notifications.deleteNotification(principal, id);
    sendNoContent(res);
  }),
);

notificationsRouter.post(
  '/broadcast',
  requireAuth(),
  requirePermission('NOTIFICATION_BROADCAST'),
  validate({ body: notificationBroadcastSchema }),
  asyncHandler(async (req, res) => {
    const body = validated.body(req, notificationBroadcastSchema);
    const count = await notifications.notifyMany(body.userIds, {
      type: body.type,
      title: body.title,
      message: body.message,
      data: body.data ?? {},
      actionUrl: body.actionUrl ?? null,
    });
    sendCreated(res, { count }, 'Notification broadcast queued');
  }),
);
