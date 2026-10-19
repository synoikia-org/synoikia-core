import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkManifest } from '@synoikia/plugin-sdk';
import { Given, Then, When } from 'quickpickle';
import { afterAll, inject } from 'vitest';
import { startPluginHarness } from '../index.js';
import type { PluginHarness } from '../index.js';
import { loadProfile } from './profile.js';
import type { ComplianceFake, ComplianceProfile } from './profile.js';
import { FAILED_RULE } from './verdict.js';

/** The plugin under test, booted once for each feature file of the suite: its profile, its fake and core's harness. */
interface Subject {
  pluginDir: string;
  profile: ComplianceProfile;
  fake?: ComplianceFake;
  harness: PluginHarness;
}

let subject: Promise<Subject> | undefined;

async function boot(): Promise<Subject> {
  const pluginDir = inject('synoikiaPluginDir');
  const { profile, fake } = await loadProfile(pluginDir);
  try {
    const harness = await startPluginHarness({ pluginDir, connection: profile.connection });
    await harness.ctx.instances.update(harness.instanceId, {
      settings: { executePerMinute: 10_000, writesPerMinute: 10_000 },
    });
    return { pluginDir, profile, fake, harness };
  } catch (err) {
    await fake?.close();
    throw err;
  }
}

const subjectOf = () => (subject ??= boot());

afterAll(async () => {
  const s = await subject?.catch(() => undefined);
  await s?.harness.stop();
  await s?.fake?.close();
});

/** Fails the step with one line for each broken rule, as the verdict lists them. */
function report(issues: string[]) {
  if (issues.length) throw new Error(issues.map((i) => `${FAILED_RULE}${i}`).join('\n'));
}

const shared = new WeakMap<object, { manifestIssues?: string[]; guideIssues?: string[] }>();
const seen = (world: object) => {
  let s = shared.get(world);
  if (!s) shared.set(world, (s = {}));
  return s;
};

Given('core synced the catalog of the plugin', async () => {
  const { harness } = await subjectOf();
  const status = harness.instance()?.lastSyncStatus;
  report(status === 'ok' ? [] : [`the catalog did not sync (${String(status)})`]);
});

When('core reads the manifest of the plugin', (world: object) => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(inject('synoikiaPluginDir'), 'manifest.json'), 'utf8'));
  seen(world).manifestIssues = checkManifest(manifest).filter(
    (i) => i.startsWith('connection.') || i.startsWith('manifest:'),
  );
});

Then('each secret field is write-only, uses the secret widget and is a sensitive key', (world: object) => {
  report(seen(world).manifestIssues ?? []);
});

Then('the profile has a case for each locked operation', async () => {
  const { harness, profile } = await subjectOf();
  const locked = harness.operations().filter((o) => o.locked && !o.stale);
  report(
    locked.filter((o) => !profile.locks[o.key]).map((o) => `${o.key} is locked and the profile has no case for it`),
  );
});

When('the agent reads the guide of each operation that requires one', async (world: object) => {
  const { harness } = await subjectOf();
  const issues: string[] = [];
  for (const op of harness.operations().filter((o) => o.attestationRequired && !o.stale)) {
    const read = await harness.search(`return await guides.get(${JSON.stringify(op.key)});`);
    const content = read.ok ? (read.value as { content?: unknown } | undefined)?.content : undefined;
    if (typeof content !== 'string' || !content.trim()) issues.push(`the guide of ${op.key} is not provided`);
  }
  seen(world).guideIssues = issues;
});

Then('each guide has content', (world: object) => {
  report(seen(world).guideIssues ?? []);
});
