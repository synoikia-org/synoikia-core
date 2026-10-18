import http from 'node:http';

/** What an app sends first on a new MCP session. */
export const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Acme Chat', version: '1.0' } },
};

/** A request to core as a raw client sends it, with any Host header. */
export function rawRequest(
  base: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  const url = new URL(path, base);
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: opts.method ?? (body ? 'POST' : 'GET'),
        headers: {
          ...(body ? { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** A JWT another issuer gave the app: only its claims count here, so it is not signed. */
export const foreignJwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
