import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { subscribeRealtime, type RealtimeEvent } from '../../lib/events.js';

/**
 * Realtime routes.
 *
 * `GET /api/v1/realtime/events` opens a Server-Sent Events stream. The stream
 * is a notification bus, not a data channel: each event says "something changed
 * in this channel" and carries little more than a label and an id. The client
 * responds by refetching the records it is entitled to see, so the backend's
 * permission check happens at the read — the same check as any other request.
 *
 * The handler is deliberately synchronous and is not wrapped in `asyncHandler`:
 * a request only "completes" when the client disconnects, so `next` is never
 * called. The interval and the event subscription are both torn down on close,
 * so a dropped tab cannot leak a listener into the process.
 */

export const realtimeRouter = Router();

const HEARTBEAT_MS = 15_000;

realtimeRouter.get('/events', requireAuth(), (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // `retry:` asks the browser how long to wait before reconnecting after a
  // dropped stream, so a proxy restart self-heals without a page reload.
  res.write('retry: 3000\n\n');

  const send = (event: RealtimeEvent): void => {
    res.write(`event: ${event.channel}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = subscribeRealtime(send);

  // A comment line keeps idle proxies from closing a quiet stream: a heartbeat
  // is whitespace, never an event, so the client ignores it.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});
