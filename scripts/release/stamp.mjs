import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { ARTIFACTS, imageVersionOf, parseVersions } from './plan.mjs';

// Writes the versions of the published release (RELEASE_TAG, RELEASE_BODY) into each manifest, for the build.

const versions = parseVersions(process.env.RELEASE_BODY ?? '');
if (!versions) throw new Error('the release body has no versions block');
versions.image = imageVersionOf(process.env.RELEASE_TAG ?? '');

for (const a of ARTIFACTS) {
  const version = versions[a.id];
  if (!version) throw new Error(`the release names no version for ${a.name}`);
  const pkg = JSON.parse(readFileSync(a.manifest, 'utf8'));
  pkg.version = version;
  writeFileSync(a.manifest, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${a.name} ${version}`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `image=${versions.image}\n`);
