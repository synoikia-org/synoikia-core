import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { safeEqual, sha256 } from '../auth/tokens.js';
import { errorResponse } from './common.js';

/** The metrics listener for Prometheus (ADR-0024): `/metrics`, behind the scrape token, compared as digests in constant time. */
export function createMetricsApp(ctx: AppContext): Hono {
  const { registry } = ctx.metrics;
  const token = ctx.config.METRICS_TOKEN;
  const expected = token ? sha256(token) : undefined;
  const app = new Hono();
  app.onError((err, c) => errorResponse(err, c, ctx.log));
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/metrics', async (c) => {
    if (expected) {
      const given = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
      if (!safeEqual(sha256(given), expected))
        return c.json({ error: 'unauthenticated', message: 'Send the scrape token' }, 401, {
          'WWW-Authenticate': 'Bearer',
        });
    }
    return c.text(await registry.metrics(), 200, { 'Content-Type': registry.contentType });
  });
  return app;
}
