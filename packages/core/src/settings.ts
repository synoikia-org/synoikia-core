import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from './audit.js';
import { EXTERNAL_PROVIDER_IDS, externalProvider } from './auth/external.js';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';
import { tableCache } from './db/writes.js';
import { ValidationError } from './errors.js';
import { cleanStored } from './lenient.js';

/** Global settings, one JSON document per section in the `settings` table. */

/** Keeps the first spelling of each name; upper and lower case do not matter. */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

const SETTINGS_SCHEMAS = {
  security: z
    .object({
      /** Force every user to enroll TOTP at next login. */
      requireTotp: z.boolean().default(false),
      /** Only OIDC sign-in. Saving requires an OIDC-linked user; ADMIN_FORCE_LOCAL_LOGIN overrides. */
      disableLocalLogin: z.boolean().default(false),
      sessionIdleMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60)
        .default(30),
      sessionAbsoluteHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .default(12),
      /** Approval-page sign-in on the MCP port (ADR-0006): how long one browser stays signed in. */
      approvalSessionIdleHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 7)
        .default(12),
      approvalSessionAbsoluteDays: z.number().int().min(1).max(30).default(7),
      /** Role of self-registered users (ADR-0010); null turns self-registration off. */
      defaultRoleId: z.string().min(1).max(64).nullable().default(null),
      /** The "Create account" form on the sign-in page; needs a default role. */
      localSignup: z.boolean().default(false),
    })
    .prefault({}),
  mcp: z
    .object({
      /** Client auth methods enabled on the MCP port (ADR-0009); an endpoint can only narrow them. */
      clientAuth: z
        .object({
          bearer: z.boolean().default(true),
          oauth: z.boolean().default(true),
          external: z.boolean().default(false),
        })
        .prefault({}),
      external: z.object({ provider: z.enum(EXTERNAL_PROVIDER_IDS).default('cloudflare') }).prefault({}),
      allowDynamicRegistration: z.boolean().default(true),
      /** The Cloudflare Access provider's application (ADR-0009). */
      cfAccess: z.object({ teamDomain: z.string().default(''), aud: z.string().default('') }).prefault({}),
      accessTokenTtlMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60)
        .default(60),
      refreshTokenTtlDays: z.number().int().min(1).max(365).default(30),
      /** Allowed or denied MCP clients by their self-declared name (@id:client-policy). */
      clientPolicy: z
        .object({
          mode: z.enum(['off', 'allow', 'deny']).default('off'),
          names: z.array(z.string().trim().min(1).max(100)).max(50).transform(dedupeNames).default([]),
        })
        .prefault({}),
    })
    .prefault({}),
  audit: z
    .object({
      /** Null = keep forever (@id:housekeeping). */
      retentionDays: z.number().int().min(7).nullable().default(90),
    })
    .prefault({}),
} as const;

export type SettingsSection = keyof typeof SETTINGS_SCHEMAS;
export type Settings<S extends SettingsSection> = z.infer<(typeof SETTINGS_SCHEMAS)[S]>;

/** Rules across fields of `mcp`, checked on save only: stored values stay readable as they are. */
function mcpProblems(value: Settings<'mcp'>): string[] {
  const problems: string[] = [];
  if (!Object.values(value.clientAuth).some(Boolean)) problems.push('clientAuth: enable at least one method');
  const provider = externalProvider(value);
  if (value.clientAuth.external && !provider.configured(value))
    problems.push(`external: configure ${provider.name} before you enable external auth`);
  if (value.clientPolicy.mode === 'allow' && !value.clientPolicy.names.length)
    problems.push('clientPolicy: add at least one client name to allow');
  return problems;
}

export function isSettingsSection(name: string): name is SettingsSection {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMAS, name);
}

/** Stored fields that read as off, not as their open defaults, when they can't be read (ADR-0009). */
const FAIL_CLOSED: { [S in SettingsSection]?: Record<string, unknown> } = {
  mcp: { clientAuth: { bearer: false, oauth: false, external: false } },
};

/** Fields an earlier release stored that a save now refuses, so a stale client can't lose them silently. */
const RETIRED: { [S in SettingsSection]?: string[] } = {
  mcp: ['defaultAuthMode', 'trustedIdentityHeader'],
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The lenient read of a stored section, with {@link FAIL_CLOSED} fields closed when dropped. */
function readStored<S extends SettingsSection>(section: S, raw: unknown) {
  const schema = SETTINGS_SCHEMAS[section];
  const result = cleanStored(schema, raw, `settings.${section}`);
  const closed = Object.entries(FAIL_CLOSED[section] ?? {}).filter(([key]) =>
    result.dropped.some((p) => p === '*' || p === key || p.startsWith(`${key}.`)),
  );
  if (!closed.length) return { ...result, value: result.value as Settings<S> };
  const cleaned = { ...(isPlainObject(result.cleaned) ? result.cleaned : {}), ...Object.fromEntries(closed) };
  return { value: schema.parse(cleaned) as Settings<S>, cleaned, dropped: result.dropped };
}

/** Stored settings are read leniently: a field a newer schema rejects falls back to its default. */
export function getSettings<S extends SettingsSection>(db: Db, section: S): Settings<S> {
  return storedSettings(db, section) as Settings<S>;
}

// ADR-0021: read on each call, so kept until the settings table is written; frozen, as callers share it.
const storedSettings = tableCache([settings], (db, section: SettingsSection) => {
  const row = db.select().from(settings).where(eq(settings.key, section)).get();
  return Object.freeze(readStored(section, row?.value).value);
});

/** Startup: removes stored settings fields the schema rejects, once; valid fields stay as stored. */
export function normalizeStoredSettings(db: Db): string[] {
  const changed: string[] = [];
  for (const row of db.select().from(settings).all()) {
    if (!isSettingsSection(row.key)) continue;
    const { cleaned, dropped } = readStored(row.key, row.value);
    if (!dropped.length) continue;
    db.update(settings).set({ value: cleaned }).where(eq(settings.key, row.key)).run();
    changed.push(row.key);
  }
  return changed;
}

export function updateSettings<S extends SettingsSection>(
  db: Db,
  section: S,
  patch: unknown,
  actor: { userId?: string } = {},
): Settings<S> {
  const before = getSettings(db, section);
  const retired = (RETIRED[section] ?? []).filter((k) => isPlainObject(patch) && k in patch);
  if (retired.length)
    throw new ValidationError(
      'invalid_settings',
      'Invalid settings',
      retired.map((k) => `${k}: no longer supported`),
    );
  // Nested objects merge with the stored ones, so a partial save keeps the fields it leaves out.
  const merged: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(isPlainObject(patch) ? patch : {})) {
    const stored = merged[key];
    merged[key] = isPlainObject(stored) && isPlainObject(value) ? { ...stored, ...value } : value;
  }
  const parsed = SETTINGS_SCHEMAS[section].safeParse(merged);
  if (!parsed.success) {
    throw new ValidationError(
      'invalid_settings',
      'Invalid settings',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const problems = section === 'mcp' ? mcpProblems(parsed.data as Settings<'mcp'>) : [];
  if (problems.length) throw new ValidationError('invalid_settings', 'Invalid settings', problems);
  db.transaction((tx) => {
    tx.insert(settings)
      .values({ key: section, value: parsed.data })
      .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data } })
      .run();
    writeAudit(tx, {
      kind: 'config',
      decision: 'settings_updated',
      actorKind: 'user',
      actorId: actor.userId,
      detail: { section, before, after: parsed.data },
    });
  });
  return parsed.data as Settings<S>;
}
