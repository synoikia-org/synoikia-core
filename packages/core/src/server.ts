import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { AppContext } from './app.js';
import { createAdminApp } from './http/admin-app.js';
import { createMcpApp } from './http/mcp-app.js';
import { createMetricsApp } from './http/metrics-app.js';

export interface RunningServers {
  mcp: { server: Server; port: number };
  admin: { server: Server; port: number };
  /** Only when METRICS_PORT is set (ADR-0023). */
  metrics?: { server: Server; port: number };
  /** Stops accepting, then waits up to `graceMs` for open requests before cutting their connections. */
  close(graceMs?: number): Promise<void>;
}

function listen(app: { fetch: (req: Request) => Response | Promise<Response> }, hostname: string, port: number) {
  return new Promise<{ server: Server; port: number }>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname, port }, (info: AddressInfo) =>
      resolve({ server: server as Server, port: info.port }),
    ) as Server;
    server.once('error', reject);
  });
}

function close(server: Server, graceMs: number) {
  return new Promise<void>((resolve, reject) => {
    const cut = setTimeout(() => server.closeAllConnections(), graceMs);
    server.close((err) => {
      clearTimeout(cut);
      if (err) reject(err);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

/** Starts the two listeners on separate ports (ADR-0015), and the metrics listener when it is on (ADR-0023). */
export async function startServers(ctx: AppContext): Promise<RunningServers> {
  const { config } = ctx;
  const mcp = await listen(createMcpApp(ctx), config.MCP_HOST, config.MCP_PORT);
  const admin = await listen(createAdminApp(ctx, { uiDir: config.ADMIN_UI_DIR }), config.ADMIN_HOST, config.ADMIN_PORT);
  const metrics =
    config.METRICS_PORT === undefined
      ? undefined
      : await listen(createMetricsApp(ctx), config.METRICS_HOST, config.METRICS_PORT);
  return {
    mcp,
    admin,
    ...(metrics ? { metrics } : {}),
    close: async (graceMs = 5000) => {
      await Promise.all([mcp, admin, metrics].map((l) => (l ? close(l.server, graceMs) : undefined)));
    },
  };
}
