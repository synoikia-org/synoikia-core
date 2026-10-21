#!/bin/bash
# SessionStart hook: checks that the Synoikia dev kit plugins are loaded. In Claude Code cloud sessions it
# also installs workspace dependencies, so lint, typecheck and tests work straight away.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  command -v pnpm >/dev/null 2>&1 || corepack enable
  # stdout becomes session context; keep the install log out of it.
  pnpm install --frozen-lockfile >&2
fi
node .claude/hooks/check-plugins.mjs recommended synoikia-plugin-dev
