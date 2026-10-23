import { MATCH_OPS } from '@synoikia/plugin-sdk';
import type { ResolvedTarget } from '@synoikia/plugin-sdk';
import { z } from 'zod';
import { canonicalJson } from './canonical.js';

/** Pre-approval `match` evaluator (ADR-0003): all conditions must hold, failing closed. Matching is
 * strict: every parameter must be covered, or accepted with `op: 'any'`. */

const PARAM_OPS = [...MATCH_OPS, 'any'] as const;

export const ParamConditionSchema = z
  .object({
    field: z.string().regex(/^(\/.*)?$/, 'must be a JSON pointer'),
    op: z.enum(PARAM_OPS),
    value: z.unknown().optional(),
  })
  .refine((c) => c.op === 'any' || c.field !== '', 'only "any" can apply to all parameters');

/** Selects resolved targets by id and declared scope values; every target must match (ADR-0011). */
export const TargetConditionSchema = z
  .object({
    field: z.literal('$targets'),
    ids: z.array(z.string().min(1)).min(1).optional(),
    scopes: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).optional(),
  })
  .strict()
  .refine((c) => c.ids || Object.keys(c.scopes ?? {}).length > 0, 'select at least one target id or scope value');

export const MatchSchema = z.array(z.union([TargetConditionSchema, ParamConditionSchema]));
export type MatchCondition = z.infer<typeof MatchSchema>[number];

const MISSING = Symbol('missing');

/** RFC 6901 JSON pointer lookup; returns MISSING instead of undefined so `null` values still count. */
export function getPointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return MISSING;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function paramMatches(actual: unknown, op: string, expected: unknown): boolean {
  if (op === 'any') return true; // present or not, any value
  if (actual === MISSING) return false;
  switch (op) {
    case 'eq':
      return canonicalJson(actual) === canonicalJson(expected);
    case 'in': {
      if (!Array.isArray(expected)) return false;
      const allowed = new Set(expected.map((v) => canonicalJson(v)));
      const values = Array.isArray(actual) ? actual : [actual];
      return values.length > 0 && values.every((v) => allowed.has(canonicalJson(v)));
    }
    case 'prefix':
      // Path-segment boundary: "vol/media" matches "vol/media" and "vol/media/tv", not "vol/media-private".
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        expected !== '' &&
        (actual === expected ||
          (actual.startsWith(expected) && (expected.endsWith('/') || actual[expected.length] === '/'))) &&
        !hasDotPart(actual)
      );
    case 'range': {
      const { min, max } = (expected ?? {}) as { min?: unknown; max?: unknown };
      if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
      if (min === undefined && max === undefined) return false;
      if (min !== undefined && (typeof min !== 'number' || actual < min)) return false;
      if (max !== undefined && (typeof max !== 'number' || actual > max)) return false;
      return true;
    }
    case 'bool':
      return typeof actual === 'boolean' && actual === expected;
    default:
      return false;
  }
}

function targetMatches(target: ResolvedTarget, c: z.infer<typeof TargetConditionSchema>): boolean {
  if (c.ids && !c.ids.includes(target.id)) return false;
  for (const [key, values] of Object.entries(c.scopes ?? {})) {
    const value = target.scopes?.[key];
    if (value === undefined || !values.includes(value)) return false;
  }
  return true;
}

// Slashes that NFKC leaves alone (⁄ ∕ ⧵ ⧸ ⧹ ∖), Windows best-fit backslashes (¥ ₩) and control characters.
const SEPARATOR = /[\\/\u2044\u2215\u2216\u29f5\u29f8\u29f9\u00a5\u20a9\p{Cc}]/u;
const INVISIBLE = /\p{Cf}/gu;
// The leading \s* cannot take a dot, so the test stays linear on a long run of dots.
const DOT_PART = /^\s*\.[.\s]*$/;
const ESCAPED = /(?:%[0-9a-f]{2})+/gi;

/** ADR-0003: whether a value has a part of only dots and spaces, also once %-escapes and NFKC forms are undone. */
export function hasDotPart(value: string): boolean {
  let text = value;
  for (let round = 0; round < 3; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      // A malformed escape elsewhere: decode each well-formed run on its own.
      decoded = text.replace(ESCAPED, (run) => {
        try {
          return decodeURIComponent(run);
        } catch {
          return run;
        }
      });
    }
    if (decoded === text) break;
    text = decoded;
  }
  // Still encoded after three rounds, or not valid UTF-8: too hard to judge, so fail closed.
  if (new RegExp(ESCAPED.source, 'i').test(text) || /%u[0-9a-f]{4}/i.test(text)) return true;
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .split(SEPARATOR)
    .some((part) => DOT_PART.test(part));
}

const escapePointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Whether every parameter is covered by a condition: a path covers everything under it; partly covered
 * objects and arrays are checked key by key. */
export function coversAllParams(
  match: readonly MatchCondition[],
  params: unknown,
  /** Extra covered pointers, e.g. the raw target a `$targets` condition stands for (ADR-0012). */
  alsoCovered: readonly string[] = [],
): boolean {
  const pointers = [...match.filter((c) => c.field !== '$targets').map((c) => c.field), ...alsoCovered];
  const covered = (value: unknown, path: string): boolean => {
    if (pointers.includes(path)) return true;
    if (value === undefined || value === null) return path === '';
    if (typeof value !== 'object') return false;
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    // ADR-0003: an empty object or list is a parameter too; only the call's own empty root is covered.
    if (entries.length === 0) return path === '';
    if (!pointers.some((p) => p.startsWith(`${path}/`))) return false;
    return entries.every(([k, v]) => covered(v, `${path}/${escapePointer(k)}`));
  };
  return covered(params, '');
}

/** The conditions alone, without the strict every-parameter check (used to spot rules strictness broke). */
export function conditionsHold(
  match: readonly MatchCondition[],
  call: { params: unknown; targets: readonly ResolvedTarget[] },
): boolean {
  return match.every((c) => {
    if (c.field === '$targets') {
      const tc = c as z.infer<typeof TargetConditionSchema>;
      return call.targets.length > 0 && call.targets.every((t) => targetMatches(t, tc));
    }
    const pc = c as z.infer<typeof ParamConditionSchema>;
    return paramMatches(getPointer(call.params, pc.field), pc.op, pc.value);
  });
}

export function matches(
  match: readonly MatchCondition[],
  call: { params: unknown; targets: readonly ResolvedTarget[] },
): boolean {
  return conditionsHold(match, call) && coversAllParams(match, call.params);
}
