import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async route handler so a rejected promise reaches Express.
 *
 * Express 4 does not await handlers: an `async` handler that throws produces an
 * unhandled rejection and the request hangs until the client or a proxy times
 * out. The failure never reaches the error handler, so nothing is logged and the
 * client sees a timeout instead of a 500.
 *
 * Every async handler in this codebase goes through here. (Express 5 handles this
 * natively, and this wrapper becomes a no-op upgrade.)
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
