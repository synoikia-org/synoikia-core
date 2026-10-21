#!/bin/sh
[ "${ALLOW_ADRS:-}" = "1" ] && exit 0
[ -x node_modules/.bin/madr-lint ] || exit 0
adrs=${ADRS_DIR:-docs/adrs}
git cat-file -e "HEAD:$adrs" 2>/dev/null || exit 0
if ! git cat-file -e "HEAD:.madrlintrc.json" 2>/dev/null; then
  echo "pre-push: $adrs is committed, but no .madrlintrc.json is, so the ADRs cannot be linted." >&2
  echo "pre-push: commit the lint rules, or override: ALLOW_ADRS=1 git push" >&2
  exit 1
fi

# Lint the ADRs as committed, by the lint rules as committed.
tree=$(mktemp -d "${TMPDIR:-/tmp}/nvadrs.XXXXXX")
found=$(mktemp "${TMPDIR:-/tmp}/nvadrs.XXXXXX")
git archive HEAD | tar -x -C "$tree"
lint=$(pwd)/node_modules/.bin/madr-lint
(cd "$tree" && "$lint" "$adrs") >"$found" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  echo "pre-push: the ADRs do not lint." >&2
  sed "s#$tree/##g" "$found" >&2
  rm -rf "$tree" "$found"
  echo "pre-push: fix them, or override: ALLOW_ADRS=1 git push" >&2
  exit 1
fi
rm -rf "$tree" "$found"
exit 0
