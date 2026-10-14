import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import { ErrorCodes, PluginError } from './errors.js';
import { isPlainObject } from './plugin-kit.js';
import { statusKind, upstreamError } from './upstream-errors.js';
import { parseBaseUrl } from './url.js';

/** JSON-over-HTTP client for upstreams (node:http(s), so `verifyTls: false` works): no redirects, capped
 * responses, auth only from the plugin; errors carry method and path only. */

export interface HttpJsonClientOptions {
  /** The API base every path is appended to, e.g. `https://seerr.lan/api/v1`. */
  baseUrl: string;
  /** The upstream's name in error messages ("Seerr denied …"). */
  service: string;
  /** Default true. */
  verifyTls?: boolean;
  /** Per-call timeout when the call gives none. Default 15 s. */
  timeoutMs?: number;
  /** Largest response body accepted. Default 32 MiB. */
  maxBytes?: number;
  /** Auth and other headers, read on every request (so a refreshed session cookie applies). */
  headers?: () => Record<string, string>;
  /** Runs before each request, e.g. to sign in first. Receives the call's deadline. */
  before?: (deadline: number) => Promise<void>;
  /** On 401/403: return true to retry once after signing in again. */
  onAuthFailure?: (deadline: number) => Promise<boolean>;
}

/** How a request body is sent: JSON, `application/x-www-form-urlencoded`, or `multipart/form-data` text fields. */
export const BODY_ENCODINGS = ['json', 'form', 'multipart'] as const;
export type BodyEncoding = (typeof BODY_ENCODINGS)[number];

export interface HttpRequestOptions {
  /** Arrays repeat the key, objects are sent as JSON, null and undefined are dropped. */
  query?: Record<string, unknown>;
  /** Not sent for GET. With `form` or `multipart` it must be an object, encoded like `query`. */
  body?: unknown;
  /** Default `json`. */
  bodyEncoding?: BodyEncoding;
  timeoutMs?: number;
  /** Absolute deadline (ms since epoch); overrides `timeoutMs`. */
  deadline?: number;
}

export interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** Parsed JSON, the raw text if it isn't JSON, or null for an empty body. */
  body: unknown;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** Name/value pairs of a query or form: arrays repeat the key, objects are sent as JSON, booleans and
 * numbers as text, null/undefined are dropped. */
export function formFields(fields: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === null) continue;
      out.push([key, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
  }
  return out;
}

/** `?a=1&b=2&b=3`, from `formFields`. */
export function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const s = new URLSearchParams(formFields(query)).toString();
  return s ? `?${s}` : '';
}

/** Multipart field names escape `"`, CR and LF as browsers do. */
const multipartName = (name: string) => name.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** The bytes and content type of a request body, or undefined for none. */
export function encodeBody(
  body: unknown,
  encoding: BodyEncoding = 'json',
): { data: Buffer; contentType: string } | undefined {
  if (body === undefined) return undefined;
  if (!BODY_ENCODINGS.includes(encoding))
    throw new PluginError(ErrorCodes.InvalidParams, `Unknown body encoding ${String(encoding)}`);
  if (encoding === 'json') return { data: Buffer.from(JSON.stringify(body)), contentType: 'application/json' };
  if (!isPlainObject(body))
    throw new PluginError(ErrorCodes.InvalidParams, `A ${encoding} body must be an object of fields`);
  const fields = formFields(body);
  if (encoding === 'form')
    return {
      data: Buffer.from(new URLSearchParams(fields).toString()),
      contentType: 'application/x-www-form-urlencoded',
    };
  const boundary = `synoikia-${randomBytes(16).toString('hex')}`;
  if (fields.some(([k, v]) => k.includes(boundary) || v.includes(boundary)))
    throw new PluginError(ErrorCodes.InvalidParams, 'A multipart field contains the boundary');
  const parts = fields.map(
    ([k, v]) => `--${boundary}\r\ncontent-disposition: form-data; name="${multipartName(k)}"\r\n\r\n${v}\r\n`,
  );
  return {
    data: Buffer.from(`${parts.join('')}--${boundary}--\r\n`),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The upstream's own error message: a JSON `message`, a short text body, or the status. */
export function errorMessage(res: HttpResponse): string {
  if (isPlainObject(res.body) && typeof res.body.message === 'string' && res.body.message) return res.body.message;
  if (typeof res.body === 'string' && res.body.trim()) return res.body.trim();
  return `HTTP ${res.status}`;
}

export class HttpJsonClient {
  private readonly base: string;
  private readonly host: string;
  private readonly basePath: string;

  constructor(private readonly opts: HttpJsonClientOptions) {
    const { url, path } = parseBaseUrl(opts.baseUrl);
    this.base = `${url.protocol}//${url.host}${path}`;
    this.host = url.host;
    this.basePath = path;
  }

  /** One API call: the parsed 2xx body, or a `PluginError` (401/403 denied, 400/422 invalid, else upstream). */
  async request(method: string, path: string, opts: HttpRequestOptions = {}): Promise<unknown> {
    const label = `${method} ${path}`;
    const deadline = opts.deadline ?? Date.now() + (opts.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    await this.opts.before?.(deadline);
    let res = await this.raw(method, path, { ...opts, deadline });
    if ((res.status === 401 || res.status === 403) && (await this.opts.onAuthFailure?.(deadline))) {
      res = await this.raw(method, path, { ...opts, deadline });
    }
    if (res.status >= 200 && res.status < 300) return res.body;
    const kind = statusKind(res.status);
    const message = errorMessage(res);
    return Promise.reject(
      upstreamError(this.opts.service, kind, label, kind === 'failed' ? `HTTP ${res.status} (${message})` : message, {
        status: res.status,
      }),
    );
  }

  /** One HTTP exchange, whatever the status. Network failures and timeouts throw. */
  raw(method: string, path: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    const label = `${method} ${path}`;
    const deadline = opts.deadline ?? Date.now() + (opts.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const left = deadline - Date.now();
    if (left <= 0) return Promise.reject(new PluginError(ErrorCodes.UpstreamError, `${label}: timed out`));
    // A `.` or `..` segment (also percent-encoded) would resolve to another endpoint than the one gated.
    const dotted = path.split('/').some((seg) => {
      try {
        return ['.', '..'].includes(decodeURIComponent(seg));
      } catch {
        return true;
      }
    });
    if (dotted) return Promise.reject(new PluginError(ErrorCodes.InvalidParams, `${label}: invalid path`));
    const url = new URL(`${this.base}${path}${queryString(opts.query)}`);
    if (url.host !== this.host || !`${url.pathname}/`.startsWith(`${this.basePath}/`))
      return Promise.reject(new PluginError(ErrorCodes.InvalidParams, `${label}: invalid path`));
    let data: ReturnType<typeof encodeBody>;
    try {
      data = method === 'GET' ? undefined : encodeBody(opts.body, opts.bodyEncoding);
    } catch (err) {
      return Promise.reject(
        err instanceof PluginError ? err : new PluginError(ErrorCodes.InvalidParams, `${label}: invalid body`),
      );
    }
    const lib = url.protocol === 'https:' ? https : http;
    const maxBytes = this.opts.maxBytes ?? DEFAULT_MAX_BYTES;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: PluginError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new PluginError(ErrorCodes.UpstreamError, `${label}: timed out`)), left);
      const req = lib.request(
        url,
        {
          method,
          headers: {
            accept: 'application/json',
            ...this.opts.headers?.(),
            ...(data !== undefined ? { 'content-type': data.contentType, 'content-length': data.data.length } : {}),
          },
          ...(url.protocol === 'https:' ? { rejectUnauthorized: this.opts.verifyTls !== false } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) fail(new PluginError(ErrorCodes.UpstreamError, `${label}: response too large`));
            else chunks.push(c);
          });
          res.on('error', () => fail(new PluginError(ErrorCodes.UpstreamError, `${label}: response interrupted`)));
          res.on('end', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: parseBody(Buffer.concat(chunks).toString('utf8')),
            });
          });
        },
      );
      req.on('error', () =>
        fail(new PluginError(ErrorCodes.UpstreamError, `${this.opts.service} is unreachable at ${this.host}`)),
      );
      if (data !== undefined) req.write(data.data);
      req.end();
    });
  }
}
