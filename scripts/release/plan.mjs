/**
 * @typedef {'patch' | 'minor' | 'major'} Bump
 * @typedef {{ sha: string, files: string[], number?: number, title: string, labels: string[] }} Change
 * @typedef {{ id: string, name: string, manifest: string, paths: string[], npm: boolean }} Artifact
 */

// The paths follow DEVELOPMENT.md › Which versions a release bumps.
/** @type {Artifact[]} */
export const ARTIFACTS = [
  {
    id: 'sdk',
    name: '@synoikia/plugin-sdk',
    manifest: 'packages/plugin-sdk/package.json',
    paths: ['packages/plugin-sdk/src/', 'packages/plugin-sdk/package.json'],
    npm: true,
  },
  {
    id: 'core',
    name: '@synoikia/core',
    manifest: 'packages/core/package.json',
    paths: ['packages/core/src/', 'packages/core/drizzle/', 'packages/core/package.json'],
    npm: true,
  },
  {
    id: 'create-plugin',
    name: '@synoikia/create-plugin',
    manifest: 'packages/create-plugin/package.json',
    paths: ['packages/create-plugin/src/', 'packages/create-plugin/templates/', 'packages/create-plugin/package.json'],
    npm: true,
  },
  {
    id: 'image',
    name: 'image',
    manifest: 'package.json',
    paths: [
      'packages/plugin-sdk/src/',
      'packages/plugin-sdk/package.json',
      'packages/core/src/',
      'packages/core/drizzle/',
      'packages/core/package.json',
      'packages/admin-ui/src/',
      'packages/admin-ui/index.html',
      'packages/admin-ui/vite.config.ts',
      'packages/admin-ui/package.json',
      'Dockerfile',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ],
    npm: false,
  },
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const RANK = { patch: 0, minor: 1, major: 2 };

/** @param {string} version */
export function isVersion(version) {
  return SEMVER.test(version);
}

/** @param {string} version @param {Bump} bump */
export function bumpVersion(version, bump) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`not a version: ${version}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // While at 0.x, a breaking change bumps the minor.
  if (bump === 'major' && major > 0) return `${major + 1}.0.0`;
  if (bump === 'major' || bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** @param {string[]} labels @returns {Bump} */
export function bumpOf(labels) {
  if (labels.includes('breaking')) return 'major';
  if (labels.includes('feature')) return 'minor';
  return 'patch';
}

/** @param {Bump[]} bumps @returns {Bump | undefined} */
function largest(bumps) {
  return bumps.reduce(
    (a, b) => (a === undefined || RANK[b] > RANK[a] ? b : a),
    /** @type {Bump | undefined} */ (undefined),
  );
}

/** @param {Artifact} artifact @param {string[]} files */
export function touches(artifact, files) {
  return files.some((f) => artifact.paths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
}

/**
 * Plans the next release. `changes` maps each artifact id to the changes since its last release.
 * @param {Record<string, string>} current the released version of each artifact id
 * @param {Record<string, Change[]>} changes
 */
export function planRelease(current, changes) {
  /** @type {Record<string, { version: string, changes: Change[] }>} */
  const plan = {};
  /** @type {Record<string, Bump | undefined>} */
  const bumps = {};
  for (const a of ARTIFACTS) {
    const own = (changes[a.id] ?? []).filter((c) => touches(a, c.files));
    plan[a.id] = { version: current[a.id] ?? '', changes: own };
    bumps[a.id] = largest(own.map((c) => bumpOf(c.labels)));
  }
  // create-plugin's workspace:^ ranges are packed with the minor pinned.
  if ([bumps.sdk, bumps.core].some((b) => b === 'minor' || b === 'major')) bumps['create-plugin'] ??= 'patch';
  // The release version is the image version, so any release bumps it by the largest step.
  const any = largest(Object.values(bumps).filter((b) => b !== undefined));
  bumps.image = any;
  for (const a of ARTIFACTS) {
    const bump = bumps[a.id];
    const p = plan[a.id];
    if (bump !== undefined && p) p.version = bumpVersion(current[a.id] ?? '', bump);
  }
  return { plan, release: any !== undefined };
}

const FENCE_START = '```text synoikia-versions';

/**
 * @param {Record<string, { version: string, changes: Change[] }>} plan
 * @param {Record<string, string>} current
 */
export function renderBody(plan, current) {
  const out = [];
  for (const a of ARTIFACTS) {
    const p = plan[a.id];
    if (!p || p.version === current[a.id]) continue;
    out.push(`## ${a.id === 'image' ? 'Docker image' : a.name} ${p.version}`, '');
    if (p.changes.length === 0 && a.id === 'create-plugin')
      out.push('- Repacked for the new minor of the SDK or core.');
    if (p.changes.length === 0 && a.id === 'image')
      out.push('- No changes of its own. Its version is the release version.');
    for (const c of p.changes) {
      const labels = c.labels.filter((l) => l === 'breaking' || l === 'feature');
      const ref = c.number ? `#${c.number}` : c.sha.slice(0, 7);
      out.push(`- ${c.title} (${ref})${labels.length ? ` [${labels.join(', ')}]` : ''}`);
    }
    out.push('');
  }
  out.push(
    '## Versions',
    '',
    'Publishing this release publishes these npm versions, if they are not on npm yet. The tag is the image version. Edit the block or the tag before you publish.',
    '',
    FENCE_START,
    ...ARTIFACTS.filter((a) => a.npm).map((a) => `${a.name} ${plan[a.id]?.version ?? current[a.id]}`),
    '```',
    '',
  );
  return out.join('\n');
}

/**
 * Reads the npm versions block of a release body. Throws on a name it does not know or a bad version.
 * @param {string} body
 * @returns {Record<string, string> | undefined} versions by artifact id
 */
export function parseVersions(body) {
  const lines = body.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.trim() === FENCE_START);
  if (start < 0) return undefined;
  /** @type {Record<string, string>} */
  const versions = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '```') return versions;
    if (line.trim() === '') continue;
    const [name, version, ...rest] = line.trim().split(/\s+/);
    const artifact = ARTIFACTS.find((a) => a.npm && a.name === name);
    if (!artifact || !version || rest.length > 0 || !isVersion(version)) throw new Error(`bad versions line: ${line}`);
    versions[artifact.id] = version;
  }
  throw new Error('the versions block has no end');
}

/** @param {string} tag the release tag, `v<image version>` */
export function imageVersionOf(tag) {
  const version = tag.startsWith('v') ? tag.slice(1) : '';
  if (!isVersion(version)) throw new Error(`the release tag must be v<version>: ${tag}`);
  return version;
}
