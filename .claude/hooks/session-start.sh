#!/bin/bash
# SessionStart hook: turns on the git hooks and checks that the NoVibe and Synoikia dev kit plugins are loaded.
# In Claude Code cloud sessions it also installs the workspace dependencies, so lint, typecheck and tests work.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"
git config core.hooksPath .githooks
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  command -v pnpm >/dev/null 2>&1 || corepack enable
  # stdout becomes session context; keep the install log out of it.
  pnpm install --frozen-lockfile >&2
fi
node .claude/hooks/check-plugins.mjs required novibe synoikia-core-dev
