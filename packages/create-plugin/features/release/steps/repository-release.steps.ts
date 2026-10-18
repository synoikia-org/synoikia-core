import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Given, Then, When } from 'quickpickle';
import type { DataTable } from 'quickpickle';
import { expect } from 'vitest';
import type { PluginAuthorWorld } from '../../support/world.js';

interface IndexVersion {
  version: string;
  url: string;
  signature: string;
}
interface RepoIndex {
  publicKey: string;
  plugins: { id: string; versions: IndexVersion[] }[];
}

const out = (world: PluginAuthorWorld, file = '') => path.join(world.repo, '.repo', file);
const archiveOf = (world: PluginAuthorWorld) => {
  const manifest = world.readJson<{ version: string }>(`plugins/${world.plugin}/manifest.json`);
  return `${world.plugin}-${manifest.version}.tgz`;
};
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const archives = (world: PluginAuthorWorld) =>
  existsSync(out(world)) ? readdirSync(out(world)).filter((f) => f.endsWith('.tgz')) : [];

Given(
  'plugin author 3 has the plugin repository {string} with the plugin {string} version {string}',
  (world: PluginAuthorWorld, repository: string, id: string, version: string) => {
    world.create(path.basename(repository), '--repository', repository, '--no-plugin');
    world.plugin = id;
    world.newPlugin('--id', id, '--name', 'Acme Tasks', '--archetype', 'blank', '--auth', 'bearer');
    expect(world.last?.code, world.last?.stderr).toBe(0);
    expect(world.readJson(`plugins/${id}/manifest.json`)).toMatchObject({ version });
    // The plugin bundles the SDK of this checkout, as the plugin repository would bundle the installed one.
    world.editJson(`plugins/${id}/package.json`, (pkg) => {
      (pkg.scripts as Record<string, string>).build = 'synoikia-plugin build --conditions synoikia-source';
    });
    world.write('minisign.pub', `untrusted comment: minisign public key\n${world.repoKey.publicKey}\n`);
  },
);

const pack = (world: PluginAuthorWorld) => world.cli('repo', 'pack');

When('plugin author 3 packs the repository', (world: PluginAuthorWorld) => {
  pack(world);
});

When('plugin author 3 packs the repository twice', (world: PluginAuthorWorld) => {
  const sums: string[] = [];
  for (let i = 0; i < 2; i++) {
    world.must('synoikia-plugin', ['repo', 'pack']);
    sums.push(sha256(out(world, archiveOf(world))));
  }
  world.sums = sums;
});

Then('both packs give the archive {string} with the same checksum', (world: PluginAuthorWorld, archive: string) => {
  expect(archives(world)).toEqual([archive]);
  const [first, second] = world.sums;
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(second).toBe(first);
});

Given(
  'the manifest of {string} names the instructions file {string}',
  (world: PluginAuthorWorld, id: string, file: string) => {
    world.editJson(`plugins/${id}/manifest.json`, (m) => {
      m.instructions = file;
    });
    world.write(`plugins/${id}/${file}`, 'Keys are `lists.rename`.\n');
  },
);

Then('the archive {string} holds only these files:', (world: PluginAuthorWorld, archive: string, table: DataTable) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  const listing = execFileSync('tar', ['-tzf', out(world, archive)], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.endsWith('/'))
    .sort();
  expect(listing).toEqual(table.raw().map((row: string[]) => row[0]));
});

Given('the manifest of {string} lists no sensitive keys', (world: PluginAuthorWorld, id: string) => {
  world.editJson(`plugins/${id}/manifest.json`, (m) => {
    m.sensitiveKeys = [];
  });
});

Then('the pack fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Then('no bundle and no archive are written', (world: PluginAuthorWorld) => {
  expect(existsSync(world.file(`plugins/${world.plugin}/dist`))).toBe(false);
  expect(archives(world)).toEqual([]);
});

Given('plugin author 3 has packed the repository', (world: PluginAuthorWorld) => {
  world.must('synoikia-plugin', ['repo', 'pack']);
});

When('plugin author 3 builds the index', (world: PluginAuthorWorld) => {
  world.cli('repo', 'index');
});

Given('plugin author 3 has built the index', (world: PluginAuthorWorld) => {
  world.must('synoikia-plugin', ['repo', 'index']);
});

Then('the index fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Given('plugin author 3 has signed the archives with the key of the repository', (world: PluginAuthorWorld) => {
  world.signArchives();
});

Given('plugin author 3 has signed the archives with another key', (world: PluginAuthorWorld) => {
  world.signArchives(world.otherKey);
});

const builtIndex = (world: PluginAuthorWorld) =>
  JSON.parse(readFileSync(out(world, 'index.json'), 'utf8')) as RepoIndex;

Then(
  'the index lists {string} version {string} at {string}',
  (world: PluginAuthorWorld, id: string, version: string, url: string) => {
    expect(world.last?.code, world.last?.stderr).toBe(0);
    const plugin = builtIndex(world).plugins.find((p) => p.id === id);
    expect(plugin?.versions).toEqual([expect.objectContaining({ version, url })]);
  },
);

Then(
  'the index holds the signature of the archive and the public key of the repository',
  (world: PluginAuthorWorld) => {
    const index = builtIndex(world);
    const archive = archiveOf(world);
    expect(index.publicKey).toBe(world.repoKey.publicKey);
    expect(index.plugins[0]?.versions[0]?.signature).toBe(readFileSync(out(world, `${archive}.minisig`), 'utf8'));
  },
);

const publishedIndex = (world: PluginAuthorWorld, id: string, version: string, publicKey: string) =>
  world.write(
    '.repo-current/index.json',
    JSON.stringify({
      schema: 1,
      name: 'acme-plugins',
      homepage: 'https://github.com/acme/plugins',
      publicKey,
      plugins: [
        {
          id,
          name: 'Acme Tasks',
          versions: [
            {
              version,
              sdk: '^0.3.0',
              url: `https://github.com/acme/plugins/releases/download/${id}-v${version}/${id}-${version}.tgz`,
              sha256: '0'.repeat(64),
              signature: 'signature',
            },
          ],
        },
      ],
    }),
  );

Given(
  'the published index lists {string} version {string} under the key of the repository',
  (world: PluginAuthorWorld, id: string, version: string) => {
    publishedIndex(world, id, version, world.repoKey.publicKey);
  },
);

Given(
  'the published index lists {string} version {string} under another key',
  (world: PluginAuthorWorld, id: string, version: string) => {
    publishedIndex(world, id, version, world.otherKey.publicKey);
  },
);

Then('the pack reports {string} and writes no archive', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  expect(world.last?.stdout).toContain(message);
  expect(archives(world)).toEqual([]);
});

Given('the package of {string} has the version {string}', (world: PluginAuthorWorld, id: string, version: string) => {
  world.editJson(`plugins/${id}/package.json`, (pkg) => {
    pkg.version = version;
  });
});

Given('the repository package names no repository', (world: PluginAuthorWorld) => {
  world.editJson('package.json', (pkg) => {
    delete (pkg.synoikia as Record<string, unknown>).repository;
  });
  world.initGit();
});

Given('the remote {string} of the repository is {string}', (world: PluginAuthorWorld, name: string, url: string) => {
  world.git('remote', 'add', name, url);
});

When('plugin author 3 packs, signs and indexes the repository', (world: PluginAuthorWorld) => {
  world.must('synoikia-plugin', ['repo', 'pack']);
  world.signArchives();
  world.cli('repo', 'index');
});

Given('plugin author 3 has packed, signed and indexed the repository', (world: PluginAuthorWorld) => {
  world.must('synoikia-plugin', ['repo', 'pack']);
  world.signArchives();
  world.must('synoikia-plugin', ['repo', 'index']);
});

When('plugin author 3 packs the repository as {string}', (world: PluginAuthorWorld, repository: string) => {
  world.cli('repo', 'pack', '--repository', repository);
});

When('plugin author 3 publishes the repository', (world: PluginAuthorWorld) => {
  world.cli('repo', 'publish');
});

const release = (world: PluginAuthorWorld, tag: string, file = '') => path.join(world.github, tag, file);

Then('GitHub has the release {string} with the archive and its signature', (world: PluginAuthorWorld, tag: string) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  const archive = archiveOf(world);
  expect(readdirSync(release(world, tag)).sort()).toEqual([archive, `${archive}.minisig`]);
  for (const f of [archive, `${archive}.minisig`])
    expect(readFileSync(release(world, tag, f)).equals(readFileSync(out(world, f))), f).toBe(true);
});

Then('GitHub has the release {string} with the new index', (world: PluginAuthorWorld, tag: string) => {
  expect(readdirSync(release(world, tag))).toEqual(['index.json']);
  expect(readFileSync(release(world, tag, 'index.json'), 'utf8')).toBe(readFileSync(out(world, 'index.json'), 'utf8'));
});

Given(
  'GitHub has the release {string} with the same archive and no signature',
  (world: PluginAuthorWorld, tag: string) => {
    mkdirSync(release(world, tag), { recursive: true });
    copyFileSync(out(world, archiveOf(world)), release(world, tag, archiveOf(world)));
  },
);

Given('GitHub has the release {string} with another archive', (world: PluginAuthorWorld, tag: string) => {
  mkdirSync(release(world, tag), { recursive: true });
  writeFileSync(release(world, tag, archiveOf(world)), 'an archive of other sources');
});

Then('the publish fails with {string}', (world: PluginAuthorWorld, message: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.last?.stderr).toContain(message);
});

Then('GitHub has no release {string}', (world: PluginAuthorWorld, tag: string) => {
  expect(existsSync(release(world, tag))).toBe(false);
});

When('plugin author 3 checks the release', (world: PluginAuthorWorld) => {
  world.cli('repo', 'verify');
});

Then('the check reports {string}', (world: PluginAuthorWorld, line: string) => {
  expect(world.last?.code, world.last?.stderr).toBe(0);
  expect(world.last?.stdout.split('\n')).toContain(line);
});

Then(
  'the release check fails because {string} is signed by a key other than the key of the repository',
  (world: PluginAuthorWorld, name: string) => {
    expect(world.last?.code).toBe(1);
    expect(world.last?.stderr).toContain(`${name}: Signed by key `);
  },
);
