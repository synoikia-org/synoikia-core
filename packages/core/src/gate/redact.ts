import { maskSensitiveResult } from '@synoikia/plugin-sdk';
import type { SensitiveResult } from '@synoikia/plugin-sdk';

/** Redaction (ADR-0007) of values under sensitive keys, matched case-insensitively ignoring `_`/`-`,
 * exactly or by containment (short rules only as the last word; contained matches keep booleans/numbers). */

export const REDACTED = '[REDACTED]';

export const GLOBAL_SENSITIVE_KEYS = [
  'password',
  'passphrase',
  'secret',
  'token',
  'apiKey',
  'privateKey',
  'bindpw',
  'authPass',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'authorization',
  'credential',
  'cookie',
  'passwd',
  'pass',
  'pwd',
];

const normalize = (key: string) => key.toLowerCase().replace(/[_-]/g, '');

export type Redactor = (<T>(value: T) => T) & {
  /** Whether a key name (in an object, or a segment of a diff path) holds a secret. */
  isSensitiveKey?: (key: string) => boolean;
};

/** Secret values shorter than this are not scrubbed from text: too likely to match ordinary words. */
const MIN_SCRUB_LENGTH = 6;

export function createRedactor(...keyLists: (readonly string[] | undefined)[]): Redactor {
  return createInstanceRedactor({ keyLists });
}

/** One instance's redactor: sensitive keys, plus its actual secret values wherever they appear in text. */
export function createInstanceRedactor(opts: {
  keyLists: (readonly string[] | undefined)[];
  secretValues?: readonly string[];
}): Redactor {
  const keys = new Set(opts.keyLists.flatMap((l) => l ?? []).map(normalize));
  const rules = [...keys].filter((k) => k !== '');
  /** 'exact' hides any value; 'contains' hides strings, objects and arrays only. */
  const sensitivity = (key: string): 'exact' | 'contains' | null => {
    const k = normalize(key);
    if (keys.has(k)) return 'exact';
    const last = key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[\s_.-]+/)
      .at(-1);
    return rules.some((r) => (r.length >= 5 ? k.includes(r) : last === r)) ? 'contains' : null;
  };
  const hide = (key: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return false;
    const how = sensitivity(key);
    return how === 'exact' || (how === 'contains' && typeof v !== 'boolean' && typeof v !== 'number');
  };
  const needles = [
    ...new Set(
      (opts.secretValues ?? [])
        .filter((v) => typeof v === 'string' && v.length >= MIN_SCRUB_LENGTH)
        .flatMap((v) => [v, encodeURIComponent(v), JSON.stringify(v).slice(1, -1)]),
    ),
  ].sort((a, b) => b.length - a.length);
  const scrub = (text: string) => (needles.length ? needles.reduce((t, n) => t.split(n).join(REDACTED), text) : text);
  const walk = (value: unknown, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') return scrub(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => walk(v, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // defineProperty, not assignment: a `__proto__` key must stay a visible own key, or it would
      // vanish from what approvers and the audit log see while still reaching the plugin.
      Object.defineProperty(out, scrub(k), {
        value: hide(k, v) ? REDACTED : walk(v, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  };
  const redact = (<T>(value: T) => walk(value, new WeakSet()) as T) as Redactor;
  redact.isSensitiveKey = (key: string) => sensitivity(key) !== null;
  return redact;
}

/** Decodes a JSON pointer (`/a/b~1c`) into its segments. */
const pointerSegments = (path: string) =>
  path
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));

// ADR-0007: many upstreams read keys without case, so a declared path matches in any case. The round trip
// through upper case also folds forms such as "ſ" and the Kelvin sign that lower case alone leaves alone.
const fold = (text: string) => text.toUpperCase().toLowerCase();

const sameSegments = (prefix: readonly string[], segments: readonly string[]) =>
  prefix.every((part, i) => fold(part) === fold(segments[i] ?? ''));

const escapeSegment = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');

/** Hides the values at `paths` (folded segments) under `node`, folding each key once. */
function hideAt(node: unknown, paths: readonly (readonly string[])[]): void {
  if (node === null || typeof node !== 'object') return;
  const byFirst = new Map<string, (readonly string[])[]>();
  for (const [first, ...rest] of paths)
    if (first !== undefined) byFirst.set(first, [...(byFirst.get(first) ?? []), rest]);
  const container = node as Record<string, unknown>;
  for (const key of Object.keys(container)) {
    const rests = byFirst.get(fold(key));
    if (!rests) continue;
    if (rests.some((rest) => rest.length === 0)) {
      if (container[key] !== undefined && container[key] !== null && container[key] !== '') container[key] = REDACTED;
    } else hideAt(container[key], rests);
  }
}

/** Hides values at JSON-pointer `paths` (`sensitiveParams`), in any case, on a copy; missing paths are ignored. */
export function redactPaths<T>(value: T, paths: readonly string[] | null | undefined): T {
  if (!paths?.length || value === null || typeof value !== 'object') return value;
  const out = structuredClone(value) as unknown;
  hideAt(
    out,
    paths.map((path) => pointerSegments(path).map(fold)).filter((parts) => parts.length > 0),
  );
  return out as T;
}

/** Masks an operation's declared `sensitiveResult` (ADR-0007) on the raw result, before the instance
 * redactor; exact key names, since names like `key` would hide too much as a global rule. */
export function redactResult<T>(value: T, spec: SensitiveResult | null | undefined): T {
  return maskSensitiveResult(value, spec);
}

export interface DiffEntry {
  path: string;
  before?: unknown;
  after?: unknown;
}

/** Redacts a `prepareWrite` diff: entries whose path has a sensitive segment or sits under a
 * `sensitiveParams` path hide `before`/`after`; the rest go through the instance redactor. */
export function redactDiff(
  diff: readonly DiffEntry[] | undefined,
  redact: Redactor,
  sensitiveParams?: readonly string[] | null,
): DiffEntry[] | undefined {
  if (!diff) return diff;
  // Without a key check (a hand-built redactor) every path counts as sensitive: fail closed.
  const isSensitive = redact.isSensitiveKey ?? (() => true);
  const declared = sensitiveParams ?? [];
  return diff.map((entry) => {
    const path = typeof entry.path === 'string' ? entry.path : '';
    // A JSON pointer, or a plugin's own dotted form (`smtp.password`): check every part and the whole.
    const segments = path.startsWith('/') ? pointerSegments(path) : path.split(/[./]/);
    const secret =
      isSensitive(path) ||
      segments.some((s) => s !== '' && isSensitive(s)) ||
      declared.some((p) => fold(path) === fold(p) || fold(path).startsWith(`${fold(p)}/`));
    if (secret) {
      return {
        path: redact(path),
        ...('before' in entry ? { before: REDACTED } : {}),
        ...('after' in entry ? { after: REDACTED } : {}),
      };
    }
    // An entry above a declared path (`/args` holding `/args/1`) hides that part of its values.
    const above = path === '' || path.startsWith('/') ? pointerSegments(path) : undefined;
    const below = above
      ? declared
          .map(pointerSegments)
          .filter((parts) => parts.length > above.length && sameSegments(above, parts))
          .map((parts) => `/${parts.slice(above.length).map(escapeSegment).join('/')}`)
      : [];
    const hide = (v: unknown) => (below.length ? redactPaths(v, below) : v);
    return redact({
      path,
      ...('before' in entry ? { before: hide(entry.before) } : {}),
      ...('after' in entry ? { after: hide(entry.after) } : {}),
    });
  });
}
