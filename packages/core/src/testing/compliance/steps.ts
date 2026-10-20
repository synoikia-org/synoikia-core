import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkManifest, parsePluginSettings } from '@synoikia/plugin-sdk';
import * as quickpickle from 'quickpickle';
import { afterAll, inject } from 'vitest';
import { parse } from 'yaml';
import { startPluginHarness } from '../index.js';
import type { ExecuteResult, HarnessApproval, PluginHarness } from '../index.js';
import { startsAndAnswers } from '../repository.js';
import { loadProfile } from './profile.js';
import type { ComplianceCall, ComplianceProfile } from './profile.js';
import { currentRun, startRun } from './run.js';
import type { ComplianceSubject } from './run.js';
import { FAILED_RULE } from './verdict.js';

type Subject = ComplianceSubject;

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
const firstLoad = !currentRun();
const run = startRun({
  ended: 0,
  subject: subjectOf,
  async stop() {
    const s = await subject?.catch(() => undefined);
    await s?.harness.stop();
    await s?.fake?.close();
  },
});
const once = <F>(define: F): F => (firstLoad ? define : ((() => undefined) as F));
const Given = once(quickpickle.Given);
const When = once(quickpickle.When);
const Then = once(quickpickle.Then);
const Before = once(quickpickle.Before);

afterAll(async () => {
  if (++run.ended === inject('synoikiaFeatureFiles')) await run.stop();
});

// Feature files share the plugin, so each scenario starts with every group off and no operation level of its own.
Before(async () => {
  const s = await subject?.catch(() => undefined);
  if (!s) return;
  for (const op of s.harness.operations()) if (op.levelOverride !== null) s.harness.setOperationLevel(op.key, null);
  for (const group of new Set(s.harness.operations().map((o) => o.pluginGroup))) s.harness.setGroupLevel(group, 'none');
  await s.fake?.reset?.();
});

/** Fails the step with one line for each broken rule, as the verdict lists them. */
function report(issues: string[]) {
  if (issues.length) throw new Error(issues.map((i) => `${FAILED_RULE}${i}`).join('\n'));
}

const shared = new WeakMap<
  object,
  {
    manifestIssues?: string[];
    guideIssues?: string[];
    lockIssues?: string[];
    results?: CallResult[];
    approvals?: LockApproval[];
    writeApprovals?: { key?: string; shown?: string }[];
    connectionTest?: unknown;
  }
>();

type LockApproval = {
  key: string;
  confirm: string;
  target?: string;
  literal?: string | null;
  message?: string;
  pending?: string;
  wrongRefused: boolean;
  result: ExecuteResult;
};
type CallResult = { call: Omit<ComplianceCall, 'key'> & { key?: string }; result: ExecuteResult };
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
  seen(world).manifestIssues = checkManifest(manifest);
});

Then('each secret field is write-only, uses the secret widget and is a sensitive key', (world: object) => {
  report((seen(world).manifestIssues ?? []).filter((i) => i.startsWith('connection.') || i.startsWith('manifest:')));
});

Then('the manifest names at least one network host', (world: object) => {
  report((seen(world).manifestIssues ?? []).filter((i) => i.startsWith('network.')));
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

/** Sandbox code that makes one profile call through the plugin's binding. */
const codeOf = (h: PluginHarness, call: { fn: string; args: unknown[] }) =>
  `return await ${h.manifest.binding.namespace}.${call.fn}(...${JSON.stringify(call.args)});`;

const label = (call: { fn: string; args: unknown[] }) => `${call.fn}(${JSON.stringify(call.args).slice(1, -1)})`;

/** A catalog whose every write is locked needs no sample write: the lock cases drive each of its writes. */
function requireSampleWrites(h: PluginHarness, profile: ComplianceProfile) {
  const unlocked = h.operations().some((o) => o.classification === 'write' && !o.locked && !o.stale);
  if (profile.writes.length === 0 && unlocked) report(['the profile names no sample write']);
}

/** Sets the group of each call's operation; a call whose key is not in the catalog is an issue. */
function setGroups(h: PluginHarness, calls: ComplianceCall[], level: 'read' | 'ask' | 'write') {
  const issues: string[] = [];
  for (const call of calls) {
    if (!call.key) issues.push(`${label(call)} names no operation key in the profile`);
    else if (!h.operations().some((o) => o.key === call.key)) issues.push(`the catalog has no ${call.key}`);
    else h.setGroupLevel(h.operation(call.key).pluginGroup, level);
  }
  report(issues);
}

async function makeCalls(world: object, calls: CallResult['call'][]) {
  const { harness } = await subjectOf();
  const results: CallResult[] = [];
  for (const call of calls) results.push({ call, result: await harness.execute(codeOf(harness, call)) });
  seen(world).results = results;
}

const errorOf = (r: ExecuteResult) => (r.ok ? undefined : (r.error as { code?: string; message?: string } | undefined));

Given('the groups of the sample reads are at level read', async () => {
  const { harness, profile } = await subjectOf();
  if (profile.reads.length === 0) report(['the profile names no sample read']);
  setGroups(harness, profile.reads, 'read');
});

Given('the groups of the sample writes are at level read', async () => {
  const { harness, profile } = await subjectOf();
  requireSampleWrites(harness, profile);
  setGroups(harness, profile.writes, 'read');
});

When('the agent makes each sample read', async (world: object) => {
  await makeCalls(world, (await subjectOf()).profile.reads);
});

When('the agent makes each sample write', async (world: object) => {
  await makeCalls(world, (await subjectOf()).profile.writes);
});

When('the agent makes each call that the profile names as unknown', async (world: object) => {
  const { profile } = await subjectOf();
  if (profile.rejects.length === 0) report(['the profile names no unknown call']);
  await makeCalls(world, profile.rejects);
});

Then('each sample read returns a result', async (world: object) => {
  const { harness } = await subjectOf();
  report(
    (seen(world).results ?? []).flatMap(({ call, result }) => {
      if (!result.ok) return [`${call.key} failed at level read (${JSON.stringify(errorOf(result))})`];
      return harness.audit({ operationKey: call.key }).length ? [] : [`${call.key} ran but is not in the audit log`];
    }),
  );
});

Then('core refuses each sample write, because the operation is off', (world: object) => {
  report(
    (seen(world).results ?? []).flatMap(({ call, result }) =>
      result.ok
        ? [`${call.key} ran at level read`]
        : errorOf(result)?.code === 'OPERATION_DISABLED'
          ? []
          : [`${call.key} failed at level read with ${JSON.stringify(errorOf(result))}, not because it is off`],
    ),
  );
});

Then('core refuses each of those calls', (world: object) => {
  report(
    (seen(world).results ?? []).flatMap(({ call, result }) =>
      result.ok || errorOf(result)?.code !== 'UNKNOWN_OPERATION'
        ? [`the plugin accepted a call that is not in its catalog: ${label(call)}`]
        : [],
    ),
  );
});

const lockCases = (profile: ComplianceProfile) => Object.entries(profile.locks).map(([key, c]) => ({ ...c, key }));

Given('the groups of the locked operations are at level write', async () => {
  const { harness, profile } = await subjectOf();
  setGroups(harness, lockCases(profile), 'write');
  for (const c of lockCases(profile)) harness.setOperationLevel(c.key, null);
});

When('the agent makes the call of each lock case', async (world: object) => {
  await makeCalls(world, lockCases((await subjectOf()).profile));
});

Then('core refuses each call, because the operation is off', async (world: object) => {
  const { harness } = await subjectOf();
  report(
    (seen(world).results ?? []).flatMap(({ call, result }) =>
      !harness.operation(call.key!).locked || result.ok || errorOf(result)?.code !== 'OPERATION_DISABLED'
        ? [`${call.key} is not off by default`]
        : [],
    ),
  );
});

Given('each locked operation is at level ask', async () => {
  const { harness, profile } = await subjectOf();
  const cases = lockCases(profile);
  setGroups(harness, cases, 'ask');
  for (const c of cases) harness.setOperationLevel(c.key, 'ask');
});

let lockRun: Promise<LockApproval[]> | undefined;

/** Runs each lock case once for each feature file, as a human decides it: a wrong literal first, then the right one. */
async function approveLocks(world: object) {
  seen(world).approvals = await (lockRun ??= runLocks());
}

async function runLocks(): Promise<LockApproval[]> {
  const { harness, profile } = await subjectOf();
  setGroups(harness, lockCases(profile), 'ask');
  for (const c of lockCases(profile)) harness.setOperationLevel(c.key, 'ask');
  const approvals: LockApproval[] = [];
  for (const c of lockCases(profile)) {
    // Each case starts from the fake's seed: an earlier case may have changed what this one acts on.
    await (await subjectOf()).fake?.reset?.();
    const seenBy: Partial<LockApproval> = { wrongRefused: false };
    const result = await harness.execute(codeOf(harness, c), {
      onApproval: (a) => {
        seenBy.literal = a.pending.confirmLiteral;
        seenBy.message = a.message;
        seenBy.pending = JSON.stringify(a.pending);
        try {
          a.approve(`${c.confirm} (wrong)`);
        } catch {
          seenBy.wrongRefused = true;
          a.approve(c.confirm);
        }
      },
    });
    approvals.push({ key: c.key, confirm: c.confirm, target: c.target, wrongRefused: false, ...seenBy, result });
  }
  return approvals;
}

When(
  'the agent makes the call of each lock case, and the human types a wrong literal and then the right one',
  approveLocks,
);

When('the agent makes the call of each lock case, and the human reads the approval', approveLocks);

Then('core refused the wrong literal and ran the call with the literal of its case', (world: object) => {
  report(
    (seen(world).approvals ?? []).flatMap((a) => {
      if (a.literal !== a.confirm)
        return [`${a.key} asks to type ${JSON.stringify(a.literal ?? null)} in place of ${JSON.stringify(a.confirm)}`];
      if (!a.wrongRefused) return [`${a.key} accepted a wrong confirmation literal`];
      return a.result.ok ? [] : [`${a.key} failed after approval (${JSON.stringify(errorOf(a.result))})`];
    }),
  );
});

Then('the approval shows the target of each lock case', (world: object) => {
  report(
    (seen(world).approvals ?? []).flatMap((a) => {
      if (a.message === undefined) return [`${a.key} ran without an approval`];
      if (!a.target) return [`the lock case of ${a.key} names no target`];
      return a.message.includes(a.target) ? [] : [`the approval of ${a.key} does not show ${JSON.stringify(a.target)}`];
    }),
  );
});

/** The secret values that must never be seen: those of the profile and the secret fields of the connection. */
const secretFields = ({ harness }: Subject) =>
  Object.entries((harness.manifest.connection.schema.properties ?? {}) as Record<string, { writeOnly?: boolean }>)
    .filter(([, p]) => p?.writeOnly)
    .map(([name]) => name);

function secretValues(s: Subject): string[] {
  const { profile } = s;
  const fromConnection = secretFields(s)
    .map((name) => profile.connection[name])
    .filter((v): v is string => typeof v === 'string' && v !== '');
  const values = [...profile.secrets.flatMap((s) => s.values), ...fromConnection];
  report(values.filter((v) => typeof v !== 'string' || v === '').map(() => 'a secret value of the profile is empty'));
  return [...new Set(values)];
}

const leaks = (text: string, values: string[], where: string) =>
  values
    .filter((v) => text.includes(v))
    .map((v) => `a secret value of the profile reached ${where}: "${v.slice(0, 4)}…"`);

Given('the groups of the secret reads are at level read', async () => {
  const { harness, profile } = await subjectOf();
  if (profile.secrets.length === 0) report(['the profile names no secret read']);
  setGroups(harness, profile.secrets, 'read');
});

When('the agent makes each secret read', async (world: object) => {
  await makeCalls(world, (await subjectOf()).profile.secrets);
});

Then('no secret value of the profile reaches the agent or the audit log', async (world: object) => {
  const s = await subjectOf();
  const values = secretValues(s);
  const results = seen(world).results ?? [];
  report([
    ...results.flatMap(({ call, result }) =>
      result.ok ? [] : [`${call.key} failed at level read (${JSON.stringify(errorOf(result))})`],
    ),
    ...leaks(JSON.stringify(results.map((r) => r.result)), values, 'the agent'),
    ...leaks(JSON.stringify(s.harness.audit()), values, 'the audit log'),
  ]);
});

Given('the groups of the sample writes are at level ask', async () => {
  const { harness, profile } = await subjectOf();
  requireSampleWrites(harness, profile);
  setGroups(harness, profile.writes, 'ask');
});

When('the agent makes each sample write, and the human reads the approval', async (world: object) => {
  const { harness, profile } = await subjectOf();
  const shown: { key?: string; shown?: string }[] = [];
  for (const call of profile.writes) {
    const seenBy: { key?: string; shown?: string } = { key: call.key };
    await harness.execute(codeOf(harness, call), {
      onApproval: (a) => {
        seenBy.shown = `${a.message}\n${JSON.stringify(a.pending)}`;
        a.deny();
      },
    });
    shown.push(seenBy);
  }
  seen(world).writeApprovals = shown;
});

Then('no secret value of the profile reaches the approval', async (world: object) => {
  const values = secretValues(await subjectOf());
  const locks = await (lockRun ??= runLocks());
  report([
    ...(seen(world).writeApprovals ?? []).flatMap((a) =>
      a.shown === undefined
        ? [`${a.key ?? 'a sample write'} asked for no approval`]
        : leaks(a.shown, values, `the approval of ${a.key ?? 'a sample write'}`),
    ),
    ...locks.flatMap((a) => leaks(`${a.message ?? ''}\n${a.pending ?? ''}`, values, `the approval of ${a.key}`)),
  ]);
});

When('an admin tests the connection with the wrong credentials of the profile', async (world: object) => {
  const s = await subjectOf();
  const { harness, profile } = s;
  if (!profile.connectionTest) {
    // A connection with no secret field has no credentials that the upstream could refuse.
    if (secretFields(s).length === 0) return void (seen(world).connectionTest = { ok: false });
    report(['the profile names no wrong credentials for the connection test']);
  }
  seen(world).connectionTest = await harness
    .testConnection({ ...profile.connection, ...profile.connectionTest!.wrong })
    .catch((err: unknown) => ({ ok: false, message: String(err) }));
});

Then('the connection test fails', (world: object) => {
  const result = seen(world).connectionTest as { ok?: boolean } | undefined;
  report(result?.ok === false ? [] : ['the connection test passed with the wrong credentials of the profile']);
});

// ── Steps for a plugin's own feature files, on the named calls of the profile ──

const own = new WeakMap<object, { result?: ExecuteResult; message?: string; literal?: string | null }>();
const ownOf = (world: object) => {
  let o = own.get(world);
  if (!o) own.set(world, (o = {}));
  return o;
};

async function namedCall(name: string) {
  const s = await subjectOf();
  const call = s.profile.calls[name];
  if (!call) throw new Error(`test/compliance.yaml names no call "${name}" under calls`);
  return { ...s, call };
}

const LEVELS = ['none', 'read', 'ask', 'write'] as const;
const levelOf = (level: string) => {
  if (!(LEVELS as readonly string[]).includes(level)) throw new Error(`"${level}" is not one of ${LEVELS.join(', ')}`);
  return level as (typeof LEVELS)[number];
};

Given('the group of {string} is at level {word}', async (_world: object, name: string, level: string) => {
  const { harness, call } = await namedCall(name);
  if (!call.key) throw new Error(`the call "${name}" names no operation key`);
  harness.setGroupLevel(harness.operation(call.key).pluginGroup, levelOf(level));
});

Given('the operation of {string} is at level {word}', async (_world: object, name: string, level: string) => {
  const { harness, call } = await namedCall(name);
  if (!call.key) throw new Error(`the call "${name}" names no operation key`);
  harness.setOperationLevel(call.key, levelOf(level));
});

async function runNamed(world: object, name: string, decide?: (a: HarnessApproval) => void) {
  const { harness, call } = await namedCall(name);
  const o = ownOf(world);
  o.result = await harness.execute(codeOf(harness, call), {
    onApproval: decide
      ? (a) => {
          o.message = a.message;
          o.literal = a.pending.confirmLiteral;
          decide(a);
        }
      : undefined,
  });
}

When('the agent runs {string}', (world: object, name: string) => runNamed(world, name));

When('the agent runs {string}, and the human approves it', (world: object, name: string) =>
  runNamed(world, name, (a) => a.approve()),
);

When('the agent runs {string}, and the human types {string}', (world: object, name: string, literal: string) =>
  runNamed(world, name, (a) => a.approve(literal)),
);

When('the agent runs {string}, and the human denies it', (world: object, name: string) =>
  runNamed(world, name, (a) => a.deny()),
);

Then('the agent gets a result that contains {string}', (world: object, text: string) => {
  const { result } = ownOf(world);
  if (!result?.ok) throw new Error(`the call failed: ${JSON.stringify(result && errorOf(result))}`);
  if (!JSON.stringify(result.value).includes(text)) throw new Error(`the result does not contain "${text}"`);
});

Then('core refuses the call with the code {string}', (world: object, code: string) => {
  const { result } = ownOf(world);
  if (result?.ok) throw new Error('the call ran');
  if (errorOf(result!)?.code !== code) throw new Error(`the call failed with ${JSON.stringify(errorOf(result!))}`);
});

Then('the approval shows {string}', (world: object, text: string) => {
  const { message } = ownOf(world);
  if (message === undefined) throw new Error('no approval was asked');
  if (!message.includes(text)) throw new Error(`the approval "${message}" does not show "${text}"`);
});

Then('the approval asks to type {string}', (world: object, literal: string) => {
  const { literal: asked } = ownOf(world);
  if (asked !== literal) throw new Error(`the approval asks to type ${JSON.stringify(asked ?? null)}`);
});
