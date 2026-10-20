import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkManifest, parsePluginSettings } from '@synoikia/plugin-sdk';
import * as quickpickle from 'quickpickle';
import { afterAll, inject } from 'vitest';
import { parse } from 'yaml';
import { startPluginHarness } from '../index.js';
import type { PluginHarness } from '../index.js';
import { startsAndAnswers } from '../repository.js';
import { loadProfile } from './profile.js';
import type { ComplianceFake, ComplianceProfile } from './profile.js';
import { FAILED_RULE } from './verdict.js';

/** The plugin under test, booted once for the whole run: its profile, its fake and core's harness. */
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
    const harness = await startPluginHarness({ pluginDir, connection: profile.connection }).catch(
      async (err: unknown) => {
        throw new Error(`${FAILED_RULE}the plugin does not start: ${await startError(pluginDir, err)}`);
      },
    );
    await harness.ctx.instances.update(harness.instanceId, {
      settings: { executePerMinute: 10_000, writesPerMinute: 10_000 },
    });
    return { pluginDir, profile, fake, harness };
  } catch (err) {
    await fake?.close();
    throw err;
  }
}

/** Why the plugin did not start: what the bundle printed when it exited, as the release check shows it, on one line. */
async function startError(pluginDir: string, err: unknown): Promise<string> {
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8')) as { entry: string };
  try {
    await startsAndAnswers(pluginDir, manifest.entry, 'the plugin');
  } catch (startErr) {
    return (startErr as Error).message
      .replace(/^the plugin does not start: /, '')
      .split('\n')
      .join(' / ');
  }
  return err instanceof Error ? err.message : String(err);
}

const subjectOf = () => (subject ??= boot());

// The feature files share one process (config.ts), and this file loads once for each of them. The first load
// registers the steps and owns the plugin; the last feature file to end stops it.
const RUN = Symbol.for('synoikia.compliance.run');
const run = globalThis as { [RUN]?: { ended: number; stop(): Promise<void> } };
const firstLoad = !run[RUN];
run[RUN] ??= {
  ended: 0,
  async stop() {
    const s = await subject?.catch(() => undefined);
    await s?.harness.stop();
    await s?.fake?.close();
  },
};
const once = <F>(define: F): F => (firstLoad ? define : ((() => undefined) as F));
const Given = once(quickpickle.Given);
const When = once(quickpickle.When);
const Then = once(quickpickle.Then);

afterAll(async () => {
  const state = run[RUN]!;
  if (++state.ended === inject('synoikiaFeatureFiles')) await state.stop();
});

/** Fails the step with one line for each broken rule, as the verdict lists them. */
function report(issues: string[]) {
  if (issues.length) throw new Error(issues.map((i) => `${FAILED_RULE}${i}`).join('\n'));
}

const shared = new WeakMap<object, { manifestIssues?: string[]; guideIssues?: string[]; lockIssues?: string[] }>();
const seen = (world: object) => {
  let s = shared.get(world);
  if (!s) shared.set(world, (s = {}));
  return s;
};

const syncIssues = (harness: PluginHarness) => {
  const status = harness.instance()?.lastSyncStatus;
  return status === 'ok' ? [] : [`the catalog did not sync (${String(status)})`];
};

Given('core synced the catalog of the plugin', async () => {
  report(syncIssues((await subjectOf()).harness));
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

When('core starts the plugin', async () => {
  await subjectOf();
});

Then('the catalog of the plugin has operations', async () => {
  const { harness } = await subjectOf();
  report(syncIssues(harness));
  report(harness.operations().some((o) => !o.stale) ? [] : ['the catalog is empty']);
});

Then('each operation has a description', async () => {
  const { harness } = await subjectOf();
  const described = (docs: unknown) =>
    ['summary', 'description'].some((k) => {
      const text = (docs as Record<string, unknown> | null | undefined)?.[k];
      return typeof text === 'string' && text.trim() !== '';
    });
  report(
    harness
      .operations()
      .filter((o) => !o.stale && !described(o.docs))
      .map((o) => `${o.key} has no description`),
  );
});

When('core reads the locks of plugin.yaml', async (world: object) => {
  const { harness, pluginDir } = await subjectOf();
  const file = path.join(pluginDir, 'plugin.yaml');
  const settings = existsSync(file) ? parsePluginSettings(parse(readFileSync(file, 'utf8'))) : undefined;
  const keys = new Set(
    harness
      .operations()
      .filter((o) => !o.stale)
      .map((o) => o.key),
  );
  const named = (settings?.rules ?? [])
    .filter((r) => r.locked)
    .flatMap((r) => (Array.isArray(r.match) ? r.match : [r.match]))
    .filter((m) => !m.includes('*'));
  seen(world).lockIssues = named.filter((key) => !keys.has(key)).map((key) => `the lock ${key} names no operation`);
});

Then('each lock names an operation of the catalog', (world: object) => {
  report(seen(world).lockIssues ?? []);
});
