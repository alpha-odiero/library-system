import { z } from 'zod';
import { uuidSchema } from '@lms/shared';
import { LIMITS } from '../../config/constants.js';

export const notificationIdParamSchema = z.object({ id: uuidSchema }).strict();

export const notificationListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

export const notificationBroadcastSchema = z
  .object({
    userIds: z.array(uuidSchema).min(1).max(500),
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(1000),
    type: z
      .enum([
        'BOOK_DUE_SOON',
        'BOOK_OVERDUE',
        'RESERVATION_READY',
        'FINE_CREATED',
        'FINE_PAYMENT',
        'BOOK_RETURNED',
        'GENERAL',
        'SYSTEM',
      ])
      .default('GENERAL'),
    actionUrl: z.string().trim().max(300).nullable().optional(),
    data: z.record(z.any()).optional(),
  })
  .strict();
