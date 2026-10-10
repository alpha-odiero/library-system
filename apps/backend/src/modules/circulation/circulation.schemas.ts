import { z } from 'zod';
import { uuidSchema } from '@lms/shared';

export const loanIdParamSchema = z.object({ id: uuidSchema });
export const reservationIdParamSchema = z.object({ id: uuidSchema });

export const loanListQuerySchema = z.object({
  memberId: uuidSchema.optional(),
  copyId: uuidSchema.optional(),
  bookId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  status: z.enum(['ACTIVE', 'RETURNED', 'OVERDUE', 'LOST', 'DAMAGED']).optional(),
  includeReturned: z.coerce.boolean().optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.string().min(1).max(50).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});

export const loanIssueSchema = z.object({
  memberId: uuidSchema,
  copyId: uuidSchema,
  branchId: uuidSchema.optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const loanReturnSchema = z.object({
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const loanRenewSchema = z.object({
  reason: z.string().max(255).optional().nullable(),
});

export const reservationListQuerySchema = z.object({
  memberId: uuidSchema.optional(),
  bookId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  status: z.enum(['ACTIVE', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED']).optional(),
  sort: z.string().min(1).max(50).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});

export const reservationCreateSchema = z.object({
  memberId: uuidSchema.optional(),
  bookId: uuidSchema,
  branchId: uuidSchema.optional(),
});

export const reservationFulfillSchema = z.object({
  copyId: uuidSchema.optional(),
});
