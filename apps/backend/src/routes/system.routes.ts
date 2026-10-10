import { Router } from 'express';
import { healthRouter } from '../modules/system/health.routes.js';

/**
 * System routes: health, readiness, and the public settings subset.
 *
 * Mounted at the root, NOT under /api/v1, so probes never collide with the
 * versioned surface.
 */
export const systemRouter = Router();

systemRouter.use(healthRouter);
