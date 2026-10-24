import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { ARTIFACTS, compareVersions, imageVersionOf, isVersion, parseVersions, releaseErrors } from './plan.mjs';

// Checks the published release (RELEASE_TAG, RELEASE_BODY, RELEASE_PRERELEASE) and writes its versions into each manifest.

const tag = process.env.RELEASE_TAG ?? '';
const versions = parseVersions(process.env.RELEASE_BODY ?? '');
if (!versions) throw new Error('the release body has no versions block');
versions.image = imageVersionOf(tag);

/** @type {Record<string, string | undefined>} */
const published = {};
for (const a of ARTIFACTS.filter((x) => x.npm)) {
  try {
    published[a.id] = execFileSync('npm', ['view', a.name, 'dist-tags.latest'], { encoding: 'utf8' }).trim();
  } catch {
    published[a.id] = undefined;
  }
}
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n');
published.image = tags
  .filter((t) => t !== tag && t.startsWith('v') && isVersion(t.slice(1)) && !t.includes('-'))
  .map((t) => t.slice(1))
  .sort(compareVersions)
  .at(-1);

const errors = releaseErrors({ versions, prerelease: process.env.RELEASE_PRERELEASE === 'true', published });
if (errors.length > 0) throw new Error(`the release cannot publish:\n${errors.join('\n')}`);

for (const a of ARTIFACTS) {
  const version = versions[a.id];
  if (!version) throw new Error(`the release names no version for ${a.name}`);
  const pkg = JSON.parse(readFileSync(a.manifest, 'utf8'));
  pkg.version = version;
  writeFileSync(a.manifest, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${a.name} ${version}`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `image=${versions.image}\n`);
