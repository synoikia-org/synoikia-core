import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { PACKAGE_DIR } from '../../support/world.js';
import type { PluginAuthorWorld } from '../../support/world.js';

const STEPS = 'plugins/acme-tasks/features/lists/steps/rename-lists.steps.ts';
const CODE = 'plugins/acme-tasks/src/plugin.ts';

const feature = (id: string, rules: string[][]) =>
  [
    ...(id ? [`@id:${id}`] : []),
    'Feature: Rename lists',
    ...rules.flatMap((scenarios, r) => [
      `  Rule: A list keeps its tasks when it is renamed, case ${r + 1}`,
      ...scenarios.flatMap((s) => s.split('\n').map((l) => `    ${l}`)),
    ]),
    '',
  ].join('\n');

const scenario = (name: string, steps = ['When the agent renames the list "Groceries" to "Food"']) =>
  [`Scenario: ${name}`, '  Given the list "Groceries" has the task "milk"', ...steps.map((s) => `  ${s}`)]
    .concat('  Then the list "Food" has the task "milk"')
    .join('\n');

const RENAME = scenario('The agent renames the list "Groceries"');

/** The feature file of the branch, with one flaw. */
const FLAWS: Record<string, () => Record<string, string>> = {
  'no id tag': () => ({ '': feature('', [[RENAME]]) }),
  'a scenario outside a rule': () => ({
    '': `@id:rename-lists\nFeature: Rename lists\n${RENAME.replace(/^/gm, '  ')}\n`,
  }),
  'a comment': () => ({ '': feature('rename-lists', [[`# Ask the admin first\n${RENAME}`]]) }),
  'the tag "@wip"': () => ({ '': feature('rename-lists', [[`@wip\n${RENAME}`]]) }),
  'the word "button" in a step': () => ({
    '': feature('rename-lists', [[scenario('The agent renames a list', ['When the agent uses the rename button'])]]),
  }),
  'a scenario of six steps': () => ({
    '': feature('rename-lists', [
      [
        scenario('The agent renames a list', [
          'And the list "Groceries" has the task "bread"',
          'And the list "Groceries" has the task "eggs"',
          'And the list "Chores" has no tasks',
          'When the agent renames the list "Groceries" to "Food"',
        ]),
      ],
    ]),
  }),
  'a scenario with no Then': () => ({
    '': `@id:rename-lists\nFeature: Rename lists\n  Rule: A list keeps its tasks\n    Scenario: The agent renames a list\n      When the agent renames the list "Groceries" to "Food"\n`,
  }),
  'the id of another feature': () => ({
    '': feature('rename-lists', [[RENAME]]),
    'plugins/acme-tasks/features/lists/archive-lists.feature': feature('rename-lists', [[RENAME]]),
  }),
  'a line that is not a step': () => ({ '': feature('rename-lists', [[`${RENAME}\n  milk, bread and eggs`]]) }),
  'four scenarios in one rule': () => ({
    '': feature('rename-lists', [[1, 2, 3, 4].map((n) => scenario(`The agent renames list ${n}`))]),
  }),
  'one scenario in each of two rules': () => ({
    '': feature('rename-lists', [[scenario('The agent renames list 1')], [scenario('The agent renames list 2')]]),
  }),
};

Given(
  'plugin author 3 has the plugin repository {string} with the plugin {string} and the assistant files',
  (world: PluginAuthorWorld, name: string, id: string) => {
    world.plugin = id;
    world.create(
      name,
      ...['--repository', 'acme/plugins', '--claude', '--yes', '--id', id, '--name', 'Acme Tasks'],
      ...['--archetype', 'blank', '--auth', 'bearer'],
    );
    expect(world.last?.code, world.last?.stderr).toBe(0);
  },
);

Given('the repository is a git repository with one commit on {string}', (world: PluginAuthorWorld, main: string) => {
  expect(main).toBe('main');
  world.initGit();
});

Given('plugin author 3 works on the branch {string}', (world: PluginAuthorWorld, branch: string) => {
  world.git('checkout', '-q', '-b', branch);
});

When('plugin author 3 checks the branch name', (world: PluginAuthorWorld) => {
  world.cli('workflow', 'check-branch');
});

When('plugin author 3 checks the branch name {string}', (world: PluginAuthorWorld, name: string) => {
  world.cli('workflow', 'check-branch', name);
});

Given('the branch adds the feature file {string} with {}', (world: PluginAuthorWorld, file: string, flaw: string) => {
  const make = FLAWS[flaw];
  if (!make) throw new Error(`The World has no feature file with ${flaw}`);
  const files = Object.fromEntries(Object.entries(make()).map(([f, text]) => [f || file, text]));
  world.commit('spec: rename lists', files);
});

When('plugin author 3 checks the feature files', (world: PluginAuthorWorld) => {
  world.cli('workflow', 'check-features');
});

When('plugin author 3 checks the feature files against {string}', (world: PluginAuthorWorld, base: string) => {
  world.cli('workflow', 'check-features', '--base', base);
});

/** What a commit of each phase changes, unless the step names the files. */
const defaultFiles = (world: PluginAuthorWorld, subject: string): Record<string, string> => {
  const phase = /^([a-z]+)(?:\([a-z0-9-]+\))?: /.exec(subject)?.[1];
  if (phase === 'spec')
    return { 'plugins/acme-tasks/features/lists/rename-lists.feature': feature('rename-lists', [[RENAME]]) };
  if (phase === 'test') return { [STEPS]: 'export {};\n' };
  if (phase === 'docs') return { 'docs/lists.md': '# Lists\n\nA list keeps its tasks.\n' };
  return code(world, subject);
};

const code = (world: PluginAuthorWorld, subject: string) => ({
  [CODE]: `${world.read(CODE)}// ${subject}\n`,
});

Given('the branch has the commits {string}', (world: PluginAuthorWorld, a: string) => {
  world.commit(a, defaultFiles(world, a));
});

Given('the branch has the commits {string} and {string}', (world: PluginAuthorWorld, a: string, b: string) => {
  for (const s of [a, b]) world.commit(s, defaultFiles(world, s));
});

Given(
  'the branch has the commits {string}, {string} and {string}',
  (world: PluginAuthorWorld, a: string, b: string, c: string) => {
    for (const s of [a, b, c]) world.commit(s, defaultFiles(world, s));
  },
);

Given('the branch has the commits {string} with the plugin code', (world: PluginAuthorWorld, subject: string) => {
  world.commit(subject, code(world, subject));
});

Given(
  'the branch has the commits {string} with the test file {string}',
  (world: PluginAuthorWorld, subject: string, file: string) => {
    world.commit(subject, { [file]: "import { it } from 'vitest';\n\nit.todo('names a list');\n" });
  },
);

When('plugin author 3 checks the phases of the branch against {string}', (world: PluginAuthorWorld, base: string) => {
  world.cli('workflow', 'check-phases', '--base', base);
});

When('plugin author 3 checks the phases of the backfill against {string}', (world: PluginAuthorWorld, base: string) => {
  world.cli('workflow', 'check-phases', '--base', base, '--backfill');
});

const words = (n: number) => Array.from({ length: n }, (_, i) => (i ? 'word' : 'Word')).join(' ');

/** The lines the branch adds to a document, and whether they must open the file. */
const TEXTS: Record<string, string> = {
  'a sentence with a semicolon': 'Rename a list; its tasks stay.',
  'a sentence with an em dash': 'Rename a list — its tasks stay.',
  'a sentence of 26 words': `${words(26)}.`,
  'a table row with a semicolon': '| Rename; keep |',
  'a semicolon in inline code': 'Run `rename; list` to rename a list.',
  'a semicolon in a code block': '```sh\nrename; list\n```',
  'a semicolon in a link target': 'See [the guide](https://acme.test/lists;rename) for lists.',
  'a semicolon in a comment': '<!-- Rename; keep -->',
  'a table row of 30 words': `| ${words(30)} |`,
};

Given('the branch adds to {string} {}', (world: PluginAuthorWorld, file: string, text: string) => {
  if (text === 'a semicolon in the front matter') {
    world.commit('docs: lists', { [file]: '---\ntitle: Lists; tasks\n---\n\n# Lists\n' });
    return;
  }
  const added = TEXTS[text];
  if (added === undefined) throw new Error(`The World has no text "${text}"`);
  let before = '# Lists\n';
  try {
    before = world.read(file);
  } catch {
    // a new file
  }
  world.commit('docs: lists', { [file]: `${before}\n${added}\n` });
});

Given(
  '{string} on {string} has a sentence with a semicolon',
  (world: PluginAuthorWorld, file: string, main: string) => {
    const branch = world.git('symbolic-ref', '--short', 'HEAD');
    world.git('checkout', '-q', main);
    world.commit('docs: lists', { [file]: `# Lists\n\n${TEXTS['a sentence with a semicolon']}\n` });
    world.git('checkout', '-q', branch);
    world.git('reset', '-q', '--hard', main);
  },
);

When('plugin author 3 checks the prose against {string}', (world: PluginAuthorWorld, base: string) => {
  world.cli('workflow', 'check-prose', '--base', base);
});

const pullRequest = (world: PluginAuthorWorld, draft: boolean, body: string) => {
  world.eventFile = path.join(world.dir, 'event.json');
  writeFileSync(world.eventFile, JSON.stringify({ pull_request: { draft, body } }));
};

Given('the pull request is ready with the description {string}', (world: PluginAuthorWorld, body: string) => {
  pullRequest(world, false, body);
});

Given('the pull request is a draft with the description {string}', (world: PluginAuthorWorld, body: string) => {
  pullRequest(world, true, body);
});

When('plugin author 3 checks the security line against {string}', (world: PluginAuthorWorld, base: string) => {
  world.cli('workflow', 'check-security-line', '--base', base);
});

Given('plugin author 3 stages the file {string}', (world: PluginAuthorWorld, file: string) => {
  world.write(file, 'ACME_TOKEN=acme-tok-9f8e7d6c\n');
  world.git('add', file);
});

When('the commit hook runs', (world: PluginAuthorWorld) => {
  world.run('sh', ['.githooks/pre-commit']);
});

Given('the shared file {string} was changed by hand', (world: PluginAuthorWorld, file: string) => {
  world.write(file, `${world.read(file)}\nA local note.\n`);
});

When('plugin author 3 syncs the shared files', (world: PluginAuthorWorld) => {
  world.cli('workflow', 'sync');
});

Then('{string} matches the template again', (world: PluginAuthorWorld, file: string) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  expect(world.read(file)).toBe(readFileSync(path.join(PACKAGE_DIR, 'templates/workflow/base', file), 'utf8'));
});

Then('the sync check reports nothing out of date', (world: PluginAuthorWorld) => {
  const check = world.cli('workflow', 'sync', '--check');
  expect(check.stderr).toBe('');
  expect(check.code).toBe(0);
});

When('plugin author 3 installs the git hooks', (world: PluginAuthorWorld) => {
  world.cli('workflow', 'hooks', 'install');
});

Then('git runs the hooks of the clone from {string}', (world: PluginAuthorWorld, dir: string) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  expect(world.git('config', 'core.hooksPath')).toBe(dir);
});

Given('{string} is a link to a file outside the repository', (world: PluginAuthorWorld, file: string) => {
  writeFileSync(path.join(world.dir, 'outside.md'), 'Keep this note.\n');
  rmSync(world.file(file));
  symlinkSync(path.join(world.dir, 'outside.md'), world.file(file));
});

Then('the sync fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Then('the file outside the repository is unchanged', (world: PluginAuthorWorld) => {
  expect(readFileSync(path.join(world.dir, 'outside.md'), 'utf8')).toBe('Keep this note.\n');
});

When('the assistant asks to run {string}', (world: PluginAuthorWorld, command: string) => {
  world.run(process.execPath, ['.claude/hooks/guard-branch.mjs'], {
    input: JSON.stringify({ tool_input: { command }, cwd: world.repo }),
    env: { CLAUDE_PROJECT_DIR: world.repo },
  });
});

const decision = (world: PluginAuthorWorld) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  const out = world.last?.stdout.trim() ?? '';
  return out
    ? (JSON.parse(out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } })
        .hookSpecificOutput
    : undefined;
};

Then('the hook denies the command with {string}', (world: PluginAuthorWorld, reason: string) => {
  const d = decision(world);
  expect(d?.permissionDecision).toBe('deny');
  expect(d?.permissionDecisionReason).toContain(reason);
});

Then('the hook denies the command', (world: PluginAuthorWorld) => {
  expect(decision(world)?.permissionDecision).toBe('deny');
});

Then('the hook allows the command', (world: PluginAuthorWorld) => {
  expect(decision(world)).toBeUndefined();
});
