import { fstatSync } from 'node:fs';
import { Socket } from 'node:net';
import semver from 'semver';
import { ErrorCodes, PluginError } from './errors.js';
import { CHANNEL_FD, createFrameReader, encodeFrame } from './frames.js';
import { RPC_METHODS, isRpcRequest } from './rpc.js';
import type { PluginHandlers, RpcNotification, RpcRequest, RpcResponse } from './rpc.js';
import { SENSITIVE_RESULT_SINCE } from './version.js';

type Catalog = { operations?: { key: string; sensitiveResult?: unknown }[] } | null | undefined;
const sensitiveKeys = (catalog: Catalog) =>
  new Set((catalog?.operations ?? []).filter((op) => op.sensitiveResult !== undefined).map((op) => op.key));

const olderCoreError = (core: unknown, keys: Iterable<string>) =>
  new PluginError(
    ErrorCodes.Internal,
    `This plugin declares result secrets (${[...keys].slice(0, 3).join(', ')}) that core masks from plugin contract ${SENSITIVE_RESULT_SINCE}; ` +
      `this core implements ${String(core)}. Upgrade Synoikia, or require ^${SENSITIVE_RESULT_SINCE} in manifest.sdk.`,
  );

/** The dispatcher `runPlugin` uses, exposed so plugin tests see core's exact error mapping. */
export function createDispatcher(handlers: PluginHandlers): (req: RpcRequest) => Promise<RpcResponse> {
  // An older core (contract < 0.2.2) drops `sensitiveResult`, and bindings return raw results: refuse the
  // catalog sync and calls to operations that declare one there.
  let coreVersion: unknown;
  let olderCore = false;
  let sensitive: Promise<Set<string>> | undefined;
  const guard = async (method: string, params: unknown) => {
    if (method === 'init') {
      coreVersion = (params as { sdkVersion?: unknown } | null)?.sdkVersion;
      olderCore = !(
        typeof coreVersion === 'string' &&
        semver.valid(coreVersion) &&
        semver.gte(coreVersion, SENSITIVE_RESULT_SINCE)
      );
      sensitive = undefined;
    } else if (olderCore && method === 'invoke') {
      sensitive ??= Promise.resolve(handlers.syncCatalog()).then(sensitiveKeys);
      const keys = await sensitive.catch((err: unknown) => {
        sensitive = undefined;
        throw err;
      });
      const key = (params as { key?: unknown } | null)?.key;
      if (typeof key === 'string' && keys.has(key)) throw olderCoreError(coreVersion, [key]);
    }
  };
  const check = (method: string, result: unknown) => {
    if (!olderCore || method !== 'syncCatalog') return;
    const keys = sensitiveKeys(result as Catalog);
    sensitive = Promise.resolve(keys);
    if (keys.size) throw olderCoreError(coreVersion, keys);
  };
  return async (req) => {
    const method = req.method as (typeof RPC_METHODS)[number];
    const handler = RPC_METHODS.includes(method) ? handlers[method] : undefined;
    if (typeof handler !== 'function') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: ErrorCodes.MethodNotFound, message: `Method not supported: ${req.method}` },
      };
    }
    try {
      await guard(method, req.params);
      const result = await (handler as (params: unknown) => unknown).call(handlers, req.params);
      check(method, result);
      return { jsonrpc: '2.0', id: req.id, result: result ?? null };
    } catch (err) {
      if (err instanceof PluginError) {
        return { jsonrpc: '2.0', id: req.id, error: { code: err.code, message: err.message, data: err.data } };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { jsonrpc: '2.0', id: req.id, error: { code: ErrorCodes.Internal, message } };
    }
  };
}

let channel: Socket | undefined;

/** The message pipe core opens on fd 3 (ADR-0020); throws when the process was not started by core. */
function openChannel(): Socket {
  let pipe = false;
  try {
    const stat = fstatSync(CHANNEL_FD);
    pipe = stat.isSocket() || stat.isFIFO();
  } catch {
    // fd 3 is not open.
  }
  if (!pipe) throw new Error('runPlugin() must be started by the Synoikia core (no message pipe on fd 3)');
  return new Socket({ fd: CHANNEL_FD, readable: true, writable: true });
}

type Notice = RpcNotification extends infer N ? (N extends unknown ? Omit<N, 'jsonrpc'> : never) : never;

/** Sends a notification (log line, catalogChanged) to core. No-op when not running under core. */
export function notify(notification: Notice): void {
  channel?.write(encodeFrame({ jsonrpc: '2.0', ...notification }));
}

/** Plugin child entry point: wires JSON-RPC requests on the message pipe to `handlers` and exits after `shutdown`. */
export function runPlugin(handlers: PluginHandlers): void {
  const pipe = (channel = openChannel());
  const read = createFrameReader();
  const dispatch = createDispatcher(handlers);
  let heartbeat: NodeJS.Timeout | undefined;
  // ADR-0023: only a running event loop sends it, and only to a core that asks for it in `init`.
  const beat = (params: unknown) => {
    const ms = (params as { heartbeatMs?: unknown } | null)?.heartbeatMs;
    clearInterval(heartbeat);
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0)
      heartbeat = setInterval(() => notify({ method: 'heartbeat' }), Math.max(100, ms));
  };
  pipe.on('data', (chunk: Buffer) => {
    const frames = read(chunk);
    if (!frames) process.exit(1);
    for (const frame of frames) {
      if (!frame.ok || !isRpcRequest(frame.value)) continue;
      const req = frame.value;
      void dispatch(req).then((res) => {
        if (req.method === 'init' && !('error' in res && res.error)) beat(req.params);
        pipe.write(encodeFrame(res), () => {
          if (req.method === 'shutdown') process.exit(0);
        });
      });
    }
  });
  // Core closed the pipe: it stopped, or it stopped this instance.
  pipe.on('end', () => process.exit(0));
  pipe.on('error', () => process.exit(0));
}
