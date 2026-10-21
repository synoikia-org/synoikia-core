#!/bin/sh
staged=$(git diff --cached --name-only --diff-filter=ACMRT)
[ -z "$staged" ] && exit 0

# Synoikia adds key files and package-manager credentials to the credential paths that security.sh refuses.
keys=$(printf '%s\n' "$staged" \
  | grep -Ev '(\.|^|/)(example|sample|template)(\.[^/]+)?$' \
  | grep -E '(^|/)([^/]+\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc)$' || true)

if [ -n "$keys" ]; then
  echo "pre-commit: refusing to stage key or credential files:" >&2
  printf '  %s\n' $keys >&2
  echo "pre-commit: if one is already tracked, git rm --cached <path>. The file stays on disk." >&2
  exit 1
fi
exit 0
