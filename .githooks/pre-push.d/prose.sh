#!/bin/sh
[ "${ALLOW_PROSE:-}" = "1" ] && exit 0
[ "$(git symbolic-ref --short HEAD 2>/dev/null)" = "main" ] && exit 0
base=$(git merge-base origin/main HEAD 2>/dev/null) || exit 0

# Synoikia's writing rules (technical-writing skill) on the lines this branch adds.
node .github/actions/prose/check-prose.mjs --base "$base" || {
  echo "pre-push: fix the prose, or override: ALLOW_PROSE=1 git push" >&2
  exit 1
}
exit 0
