#!/bin/bash
# Any change under Sources needs a new VERSION (PLAN-MAC-2 N3). Judged on the working tree, so it passes
# before a commit once VERSION is raised. The mark is the last commit that changed VERSION; no mark, no rule.
# Exit 0 or 1. Works from any folder.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
cd "$HERE" || exit 1

MARK="$(git log -1 --format=%H -- VERSION 2>/dev/null || true)"
[ -n "$MARK" ] || exit 0

changed=0
if ! git diff --quiet "$MARK" -- Sources; then
  changed=1
elif [ -n "$(git ls-files --others --exclude-standard -- Sources)" ]; then
  changed=1
fi
[ "$changed" = 1 ] || exit 0

if git diff --quiet "$MARK" -- VERSION; then
  echo "check.sh: Sources changed since VERSION last changed. Bump VERSION." >&2
  exit 1
fi
exit 0
