#!/bin/bash
# SessionStart hook: installs workspace dependencies and the workflow git hooks in Claude Code cloud sessions,
# so lint, typecheck, tests and the workflow checks work straight away. Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
command -v pnpm >/dev/null 2>&1 || corepack enable
# stdout becomes session context; keep the install log out of it.
pnpm install --frozen-lockfile >&2
pnpm --silent hooks:install >&2
