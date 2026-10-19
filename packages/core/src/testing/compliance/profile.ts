import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

/** `test/compliance.yaml` of a plugin: what the compliance suite needs to check it against core's rules. */

const Call = z.strictObject({ fn: z.string(), args: z.array(z.unknown()).default([]), key: z.string().optional() });

const ProfileSchema = z.strictObject({
  fake: z.string().optional(),
  connection: z.record(z.string(), z.unknown()),
  reads: z.array(Call).default([]),
  writes: z.array(Call).default([]),
  rejects: z.array(Call.omit({ key: true })).default([]),
  locks: z.record(z.string(), Call.extend({ confirm: z.string(), target: z.string().optional() })).default({}),
  secrets: z.array(Call.extend({ values: z.array(z.string()) })).default([]),
  connectionTest: z.strictObject({ wrong: z.record(z.string(), z.unknown()) }).optional(),
  calls: z.record(z.string(), Call).default({}),
});

export type ComplianceProfile = z.infer<typeof ProfileSchema>;
export type ComplianceCall = z.infer<typeof Call>;

/** What the module named by `fake` starts: the fake upstream, with `url` and any other `${fake.<name>}` values. */
export interface ComplianceFake {
  url: string;
  close(): unknown;
  reset?(): unknown;
  [name: string]: unknown;
}

export const PROFILE_FILE = path.join('test', 'compliance.yaml');

/** Reads the profile, starts its fake upstream and puts the fake's values in place of each `${fake.<name>}`. */
export async function loadProfile(pluginDir: string): Promise<{ profile: ComplianceProfile; fake?: ComplianceFake }> {
  const file = path.join(pluginDir, PROFILE_FILE);
  const parsed = ProfileSchema.safeParse(parse(readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`${PROFILE_FILE}: ${z.prettifyError(parsed.error)}`);
  const fake = parsed.data.fake ? await startFake(pluginDir, parsed.data.fake) : undefined;
  return { profile: fill(parsed.data, fake ?? { url: '', close: () => undefined }) as ComplianceProfile, fake };
}

async function startFake(pluginDir: string, module: string): Promise<ComplianceFake> {
  const mod = (await import(pathToFileURL(path.resolve(pluginDir, module)).href)) as {
    start?: () => Promise<ComplianceFake>;
    default?: { start?: () => Promise<ComplianceFake> };
  };
  const start = mod.start ?? mod.default?.start;
  if (!start) throw new Error(`${module} exports no start()`);
  const fake = await start();
  if (typeof fake?.url !== 'string') throw new Error(`${module}: start() returned no url`);
  return fake;
}

const PLACEHOLDER = /\$\{fake\.([A-Za-z0-9_]+)\}/g;

function fill(value: unknown, fake: ComplianceFake): unknown {
  if (typeof value === 'string') {
    const whole = /^\$\{fake\.([A-Za-z0-9_]+)\}$/.exec(value);
    if (whole) return valueOf(fake, whole[1]!);
    return value.replace(PLACEHOLDER, (_m, name: string) => String(valueOf(fake, name)));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, fake));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, fake)]));
  return value;
}

function valueOf(fake: ComplianceFake, name: string) {
  if (!(name in fake)) throw new Error(`${PROFILE_FILE}: the fake has no value "${name}"`);
  return fake[name];
}
