import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AuthPrincipal } from '@lms/shared';
import { HEADER_REQUEST_ID } from '../config/constants.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id. Present on every request; echoed in responses and logs. */
      requestId: string;
      /** Populated by Gate 1 (authenticate). Never assigned by a controller. */
      auth?: AuthPrincipal;
    }
  }
}

/** Accepts a caller-supplied request id only if it looks safe and bounded. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(HEADER_REQUEST_ID);
  // An unsanitised inbound id would let a client inject arbitrary content into
  // every log line and response header for that request.
  const id = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();

  req.requestId = id;
  res.setHeader(HEADER_REQUEST_ID, id);
  next();
}
