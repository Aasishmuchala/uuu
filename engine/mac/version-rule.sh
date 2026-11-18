#!/bin/bash
# Any change under Sources needs a new VERSION (PLAN-MAC-2 N3). Judged on the working tree, so it passes
# before a commit once VERSION is raised. The mark is the last commit that changed VERSION; no mark, no rule.
# Exit 0 or 1. Works from any folder.
#
# M16 (M15's M3 and L3): VERSION must be one line of two to four numbers ("1.0.4"), and when Sources changed it
# must be higher than at the mark, not merely different. Nothing under Sources may be hidden from git: a file
# git ignores there (by any rule, .git/info/exclude too) fails, except the generated BuildConstants.swift.
#
# M16b: no link under Sources (SwiftPM compiles what it points at), no file there git is told not to look at
# (skip-worktree, assume-unchanged), the generated file never committed, VERSION never lower than at the mark
# even when Sources did not change, and each part of VERSION at most nine digits, so it compares as a number.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
cd "$HERE" || exit 1

fail() { echo "check.sh: $*" >&2; exit 1; }

PATTERN='^[0-9]{1,9}(\.[0-9]{1,9}){1,3}$'
NOW="$(cat VERSION 2>/dev/null)" || fail "VERSION cannot be read."
[[ "$NOW" =~ $PATTERN ]] || fail "VERSION must be one line like 1.0.4 (two to four numbers of at most nine digits, nothing else)."

links="$(find Sources -type l 2>/dev/null)"
if [ -n "$links" ]; then
  echo "$links" | sed 's/^/  /' >&2
  fail "links under Sources (above). Put the files themselves there."
fi

# git ls-files -v marks a file git is told to skip with S, or with a lower-case letter when it is assumed unchanged.
told="$(git ls-files -v -- Sources 2>/dev/null | grep '^[a-zS]')"
if [ -n "$told" ]; then
  echo "$told" | sed 's/^/  /' >&2
  fail "git is told not to look at files under Sources (above). Run: git update-index --no-skip-worktree --no-assume-unchanged <file>"
fi

if [ -n "$(git ls-files -- Sources/EngineShell/Build/BuildConstants.swift 2>/dev/null)" ]; then
  fail "the generated Sources/EngineShell/Build/BuildConstants.swift is committed. Remove it from git."
fi

# Files under Sources that git ignores: only the generated one may be there.
hidden="$(git ls-files --others --ignored --exclude-standard -- Sources 2>/dev/null \
  | grep -vx 'Sources/EngineShell/Build/BuildConstants.swift' | grep -v '\(^\|/\)\.DS_Store$')"
if [ -n "$hidden" ]; then
  echo "$hidden" | sed 's/^/  /' >&2
  fail "files under Sources are hidden from git (above). Remove them or commit them."
fi

MARK="$(git log -1 --format=%H -- VERSION 2>/dev/null || true)"
[ -n "$MARK" ] || exit 0

THEN="$(git show "$MARK:./VERSION" 2>/dev/null | head -n 1 | tr -d '[:space:]')"

# 0 when $1 is higher than $2, numbers compared part by part, a missing part counting as 0.
higher() {
  local IFS=.
  local -a a=($1) b=($2)
  local i x y
  for i in 0 1 2 3; do
    x="${a[$i]:-0}"; y="${b[$i]:-0}"
    ((10#$x > 10#$y)) && return 0
    ((10#$x < 10#$y)) && return 1
  done
  return 1
}

# Never lower than at the mark, whether or not Sources changed (M16b).
if [[ "$THEN" =~ $PATTERN ]] && higher "$THEN" "$NOW"; then
  fail "VERSION is lower than when it last changed ($THEN). Raise it, never lower it."
fi

# A committed lowering becomes the mark itself, so the mark must not be lower than the VERSION before it.
BEFORE="$(git show "$MARK^:./VERSION" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
if [[ "$BEFORE" =~ $PATTERN ]] && [[ "$THEN" =~ $PATTERN ]] && higher "$BEFORE" "$THEN"; then
  fail "VERSION was lowered in a commit ($BEFORE to $THEN). Raise it above $BEFORE."
fi

changed=0
if ! git diff --quiet "$MARK" -- Sources; then
  changed=1
elif [ -n "$(git ls-files --others --exclude-standard -- Sources)" ]; then
  changed=1
fi
[ "$changed" = 1 ] || exit 0

if ! [[ "$THEN" =~ $PATTERN ]]; then
  # The mark's VERSION was not a version: any well-formed change counts as new.
  [ "$NOW" != "$THEN" ] && exit 0
elif higher "$NOW" "$THEN"; then
  exit 0
fi
fail "Sources changed since VERSION last changed. Bump VERSION."
