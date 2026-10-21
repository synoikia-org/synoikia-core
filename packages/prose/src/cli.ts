import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { addedLines, changedSince, repoRoot } from './git.js';
import { matchesAny } from './glob.js';
import { checkProse } from './prose.js';

const USAGE = `check-prose [--base <ref>] [--pr-body] [files...]
  --base <ref>  check the lines that the branch adds since <ref>, in the files that synoikia.prose lists
  --pr-body     also check the pull request description (GITHUB_EVENT_PATH)
  files...      check these files in full`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { base: { type: 'string' }, 'pr-body': { type: 'boolean' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const root = repoRoot(process.cwd());
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { synoikia?: { prose?: string[] } };
const globs = pkg.synoikia?.prose ?? ['**/*.md', '**/*.feature'];
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

const issues: string[] = [];
for (const f of positionals) issues.push(...checkProse(f, read(f)));
if (values.base) {
  const changed = changedSince(root, values.base).filter((f) => matchesAny(f, globs));
  const added = addedLines(root, values.base, changed);
  for (const f of changed) issues.push(...checkProse(f, read(f), added.get(f) ?? new Set()));
}
if (values['pr-body'] && process.env.GITHUB_EVENT_PATH) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) as {
    pull_request?: { body: string | null };
  };
  const body = event.pull_request?.body;
  if (body) issues.push(...checkProse('PR description', body.replace(/\r\n/g, '\n')));
}
for (const issue of issues) console.error(`check-prose: ${issue}`);
process.exit(issues.length ? 1 : 0);
