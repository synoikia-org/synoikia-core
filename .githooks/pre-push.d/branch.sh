#!/bin/sh
[ "${ALLOW_BRANCH:-}" = "1" ] && exit 0
branch=${GITHUB_HEAD_REF:-$(git symbolic-ref --short HEAD 2>/dev/null)} || exit 0

# A claude/ branch is a session's generated name. Name the branch for the slice instead.
case "$branch" in
  claude/*)
    echo "pre-push: '$branch' is a generated session branch name." >&2
    echo "pre-push: rename it for the slice, such as feat/<slug>: git branch -m <new-name>" >&2
    echo "pre-push: or override: ALLOW_BRANCH=1 git push" >&2
    exit 1
    ;;
esac
exit 0
