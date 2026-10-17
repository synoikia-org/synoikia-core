// PreToolUse hook: denies git commands that create or push a branch whose name breaks docs/workflow.md › Branches.
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { tool_input: toolInput = {}, cwd } = JSON.parse(input || '{}');
const command = String(toolInput.command ?? '');

const currentBranch = () =>
  spawnSync('git', ['symbolic-ref', '-q', '--short', 'HEAD'], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? cwd,
    encoding: 'utf8',
  }).stdout.trim();
const names = new Set();
for (const part of command.split(/&&|\|\|?|;|\n/)) {
  const words = part
    .trim()
    .split(/\s+/)
    .filter((w, i, all) => !/^\d*[<>]/.test(w) && !/^\d*[<>]+&?$/.test(all[i - 1] ?? ''));
  const at = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  if (words[at] !== 'git') continue;
  const [sub, ...args] = words.slice(at + 1).filter((w, i, all) => !(i > 0 && all[i - 1] === '-C') && w !== '-C');
  const plain = args.filter((a) => !a.startsWith('-'));
  if ((sub === 'checkout' || sub === 'switch') && args.some((a) => /^-[bcBC]$/.test(a)))
    names.add(args[args.findIndex((a) => /^-[bcBC]$/.test(a)) + 1]);
  else if (
    sub === 'branch' &&
    plain.length &&
    !args.some((a) => /^-(?:d|D|l|a|r|v|vv|-list|-show-current|-delete)$/.test(a))
  )
    names.add(args.some((a) => /^-[mM]$/.test(a)) ? plain.at(-1) : plain[0]);
  else if (sub === 'push' && !args.some((a) => a === '-d' || a === '--delete')) {
    const refs = plain.slice(1).map((ref) => (ref.includes(':') ? ref.split(':').pop() : ref));
    for (const ref of refs.length ? refs : ['HEAD']) names.add(ref === 'HEAD' ? currentBranch() : ref);
  }
}

const clean = (n) =>
  n
    .replace(/^\+/, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^['"]|['"]$/g, '');
const denied = [];
const unchecked = [];
for (const name of [...names]
  .filter(Boolean)
  .map(clean)
  .filter((n) => n && n !== 'HEAD')) {
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    denied.push(`${name}: use letters, digits, ".", "_", "-" and "/" only`);
    continue;
  }
  const r = spawnSync('pnpm', ['run', '--silent', 'workflow', 'check-branch', name], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? cwd,
    encoding: 'utf8',
  });
  const out = `${r.stderr}${r.stdout}`.trim();
  if (r.status === 0) continue;
  if (out.startsWith('check-branch:')) denied.push(out.replace(/^check-branch: /gm, `${name}: `));
  else unchecked.push(`${name}: ${out.split('\n')[0] ?? 'the check did not run'}`);
}
const decide = (permissionDecision, permissionDecisionReason) =>
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
    }),
  );
if (denied.length)
  decide(
    'deny',
    `Branch name breaks docs/workflow.md › Branches. Use <component>/<two to four words>.\n${denied.join('\n')}`,
  );
else if (unchecked.length) decide('ask', `Could not check the branch name:\n${unchecked.join('\n')}`);
