#!/usr/bin/env bash
# Wires the books for the department agents (Bookkeeper, Sales, Support,
# People): one draft-only role, one user and one API key each.
#
#   wire.sh            make or check the roles, rights, users and keys.
#                      Safe to run again: a second run prints only
#                      `unchanged` lines and never rotates a key.
#   wire.sh --verify   prove, with each agent's own key, that it can make and
#                      edit drafts and cannot make anything final, cannot
#                      delete, cannot touch users, roles or rights, cannot read
#                      another department's records and cannot send. Removes
#                      its test records with the owner's key. Exit 0 only when
#                      every line is PASS.
#
# Keys go to ~/.paperclip/uuu-engine/secrets/agents/<slug>.env and passwords to
# secrets/bench-users/<slug>.txt, mode 0600. Nothing secret is printed.
# What each role may do, and why, is in wire/NOTES.md.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

mode=wire
case "${1:-}" in
  "") ;;
  --verify) mode=verify ;;
  *) printf 'usage: wire.sh [--verify]\n' >&2; exit 64 ;;
esac

if [ ! -d "$BENCH_DIR/sites/$SITE" ]; then
  if [ "$mode" = verify ]; then
    printf 'SKIP Books is not installed on this Mac yet, so there is nothing to check.\n'
    exit 2
  fi
  printf 'Books is not installed on this Mac yet, so there is nothing to wire.\n'
  exit 0
fi

if ! "$HERE/status.sh" >/dev/null 2>&1; then
  printf 'Books is not running. Run: engine start\n' >&2
  exit 1
fi

umask 077
mkdir -p "$SECRETS_DIR/agents" "$SECRETS_DIR/bench-users"
chmod 700 "$SECRETS_DIR" "$SECRETS_DIR/agents" "$SECRETS_DIR/bench-users"

if [ "$mode" = verify ]; then
  exec /usr/bin/python3 -I "$HERE/wire/verify.py" "$ENGINE_HOME" "$SITE" "http://127.0.0.1:$WEB_PORT"
fi

# The bench's Python, run from the sites folder as the bench itself does.
cd "$BENCH_DIR/sites"
"$BENCH_DIR/env/bin/python" "$HERE/wire/wire_bench.py" "$SITE" "$ENGINE_HOME"
