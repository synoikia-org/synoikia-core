// SessionStart hook: tells the user and the assistant when the plugins this repository uses are not loaded.
// Usage: check-plugins.mjs required|recommended <plugin>... Prints the hook's JSON, nothing when all are loaded.
import { spawnSync } from 'node:child_process';

const [level, ...wanted] = process.argv.slice(2);
const list = spawnSync(process.env.CLAUDE_CODE_EXECPATH || 'claude', ['plugin', 'list', '--json'], {
  encoding: 'utf8',
  timeout: 20_000,
});
let loaded = new Set();
try {
  loaded = new Set(
    JSON.parse(list.stdout)
      .filter((p) => p.enabled)
      .map((p) => String(p.id).split('@')[0]),
  );
} catch {
  // An unreadable list counts as no plugin loaded, so a missing plugin is never missed.
}
const missing = wanted.filter((name) => !loaded.has(name));
if (!missing.length) process.exit(0);

const names = missing.map((n) => `\`${n}\``).join(', ');
const how =
  'See https://github.com/synoikia-org/synoikia-dev-kit#use-the-plugins. In a cloud session, add the plugins to your claude.ai account.';
const message =
  level === 'required'
    ? `This repository needs the plugins ${names}, and they are not loaded. ${how}`
    : `The plugins ${names} are recommended for this repository, and they are not loaded. ${how}`;
const context =
  level === 'required'
    ? `${message} Without them this session has none of the repository's workflow skills, rules or hooks. Do not change files in this repository. Tell the user how to install the plugins, then stop.`
    : `${message} Without them this session has none of the workflow skills, rules or hooks. Tell the user once at the start, then continue.`;
console.log(
  JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  }),
);
