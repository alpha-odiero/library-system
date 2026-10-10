import { z } from 'zod';
import { uuidSchema } from '@lms/shared';
import { LIMITS } from '../../config/constants.js';

/**
 * Branch query schemas.
 *
 * Read-only for now. `branches.schemas.ts` declares no body schema because no
 * branch write endpoint exists, and a schema with nothing to validate is a
 * comment pretending to be validation.
 */

export const branchIdParamSchema = z.object({ id: uuidSchema }).strict();

export const branchListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(LIMITS.MAX_PAGE_SIZE).optional(),
    sort: z.string().trim().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    /** Free-text over branch code and name. */
    q: z.string().trim().min(1).max(120).optional(),
    includeInactive: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

export type BranchListQuery = z.infer<typeof branchListQuerySchema>;
