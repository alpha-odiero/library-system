import { z } from 'zod';
import { moneySchema, uuidSchema } from '@lms/shared';
import { LIMITS } from '../../config/constants.js';

const decimalLike = z.union([
  moneySchema,
  z.number().finite().min(0.01),
  z.string().trim().min(1).max(40),
]);

const moneyAmount = decimalLike.transform((value) => {
  if (typeof value === 'number') return value.toString();
  return value.trim ? value.trim() : String(value);
});

const fineTypeSchema = z.enum(['OVERDUE', 'LOST', 'DAMAGE', 'LATE_RETURN', 'OTHER']);
const fineStatusSchema = z.enum(['OUTSTANDING', 'PARTIAL', 'PAID', 'WAIVED', 'VOID']);
const paymentMethodSchema = z.enum(['CASH', 'MPESA', 'BANK', 'CARD', 'OTHER']);

export const fineIdParamSchema = z.object({ id: uuidSchema }).strict();
export const paymentIdParamSchema = z.object({ id: uuidSchema }).strict();

export const fineListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    memberId: uuidSchema.optional(),
    loanId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    status: fineStatusSchema.optional(),
    type: fineTypeSchema.optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const fineCreateSchema = z
  .object({
    memberId: uuidSchema,
    loanId: uuidSchema.optional(),
    type: fineTypeSchema.default('OTHER'),
    amount: moneyAmount,
    description: z.string().trim().min(1).max(500),
    daysOverdue: z.coerce.number().int().min(0).max(3650).optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const fineUpdateSchema = z
  .object({
    amount: moneyAmount.optional(),
    description: z.string().trim().min(1).max(500).optional(),
    status: fineStatusSchema.optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const fineWaiveSchema = z
  .object({
    amount: moneyAmount,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const paymentListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    fineId: uuidSchema.optional(),
    memberId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  })
  .strict();

export const paymentCreateSchema = z
  .object({
    fineId: uuidSchema,
    amount: moneyAmount,
    method: paymentMethodSchema.default('CASH'),
    reference: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().max(255).optional(),
    branchId: uuidSchema.optional(),
  })
  .strict();

export const paymentVoidSchema = z
  .object({
    reason: z.string().trim().min(1).max(255),
  })
  .strict();

export { fineTypeSchema, fineStatusSchema, paymentMethodSchema };
