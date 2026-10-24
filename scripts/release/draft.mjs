import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ARTIFACTS, imageVersionOf, parseVersions, planRelease, renderBody } from './plan.mjs';

// Creates or updates the draft release from the changes on main since the last release. Needs GH_TOKEN.

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error('GITHUB_REPOSITORY is not set');

/** @param {string} cmd @param {string[]} args @param {string} [input] */
const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: 'utf8', input }).trim();
/** @param {string[]} args @param {unknown} [body] */
const api = (args, body) =>
  JSON.parse(run('gh', ['api', ...args, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined));

/** @type {{ id: number, tag_name: string, draft: boolean, prerelease: boolean, body: string | null }[]} */
const releases = api([`repos/${repo}/releases?per_page=100`]);
const last = releases.find((r) => !r.draft && !r.prerelease && parseVersions(r.body ?? '') !== undefined);

/** @type {Record<string, string>} */
const current = {};
/** @type {Record<string, string>} */
const boundary = {};
for (const a of ARTIFACTS) {
  if (last) {
    current[a.id] = a.npm ? (parseVersions(last.body ?? '')?.[a.id] ?? '') : imageVersionOf(last.tag_name);
    boundary[a.id] = run('git', ['rev-list', '-n', '1', last.tag_name]);
  } else {
    // Before the first release, the last version bump in the manifest marks the last publish.
    current[a.id] = JSON.parse(readFileSync(a.manifest, 'utf8')).version;
    boundary[a.id] = run('git', ['log', '-1', '--format=%H', '-G', '"version":', '--', a.manifest]);
  }
}

/** @type {Map<string, import('./plan.mjs').Change>} */
const seen = new Map();
/** @param {string} sha */
function change(sha) {
  const cached = seen.get(sha);
  if (cached) return cached;
  const files = run('git', ['diff', '--name-only', `${sha}^1`, sha])
    .split('\n')
    .filter(Boolean);
  /** @type {{ number: number, title: string, merged_at: string | null, labels: { name: string }[] }[]} */
  const pulls = api([`repos/${repo}/commits/${sha}/pulls`]);
  const pr = pulls.find((p) => p.merged_at !== null);
  const c = pr
    ? { sha, files, number: pr.number, title: pr.title, labels: pr.labels.map((l) => l.name) }
    : { sha, files, title: run('git', ['log', '-1', '--format=%s', sha]), labels: [] };
  seen.set(sha, c);
  return c;
}

/** @type {Record<string, import('./plan.mjs').Change[]>} */
const changes = {};
for (const a of ARTIFACTS) {
  const shas = run('git', ['rev-list', '--first-parent', '--reverse', `${boundary[a.id]}..HEAD`]);
  changes[a.id] = shas.split('\n').filter(Boolean).map(change);
}

const { plan, release } = planRelease(current, changes);
if (!release) {
  console.log('Nothing to release since the last release');
  process.exit(0);
}
const tag = `v${plan.image?.version}`;
const draft = releases.find((r) => r.draft);
const fields = {
  tag_name: tag,
  name: tag,
  target_commitish: run('git', ['rev-parse', 'HEAD']),
  body: renderBody(plan, current),
  draft: true,
};
if (draft) api(['--method', 'PATCH', `repos/${repo}/releases/${draft.id}`], fields);
else api(['--method', 'POST', `repos/${repo}/releases`], fields);
console.log(`${draft ? 'Updated' : 'Created'} the draft release ${tag}`);
