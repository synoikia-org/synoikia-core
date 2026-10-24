import { Hono } from 'hono';
import { Gauge, Registry } from '@prometheus-io/client';
import type { AppContext } from '../app.js';
import { safeEqual, sha256 } from '../auth/tokens.js';
import { CORE_VERSION } from '../version.js';
import { errorResponse } from './common.js';

/** The metrics listener for Prometheus (ADR-0023): `/metrics`, behind the scrape token when one is set. */
export function createMetricsApp(ctx: AppContext): Hono {
  const registry = new Registry();
  new Gauge({
    name: 'synoikia_build_info',
    help: 'The version of core.',
    labelNames: ['version'],
    registers: [registry],
  })
    .labels(CORE_VERSION)
    .set(1);

  // Digests of equal length, so the compare takes the same time for any token (ADR-0023).
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
