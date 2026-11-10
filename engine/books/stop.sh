#!/usr/bin/env bash
# Stops the books: the whole bench process group, then the private database
# (cleanly, so no data is lost). Safe to run when nothing is running. Exits 0
# when none of the books ports is listening any more.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

proc_gone() { ! kill -0 "$1" 2>/dev/null; }
# True when none of the given process groups has a process left.
groups_gone() {
  local g
  for g in "$@"; do
    if kill -0 -- "-$g" 2>/dev/null; then return 1; fi
  done
  return 0
}

if bench_running; then
  # Every process group under the bench: its own, plus one per Procfile process.
  groups="$(bench_tree | awk '{ print $2 }' | sort -u | tr '\n' ' ')"
  say "stopping bench processes (process groups: $groups)"
  # honcho passes the signal on to each process and waits for them
  # shellcheck disable=SC2086
  for g in $groups; do kill -TERM -- "-$g" 2>/dev/null || true; done
  # shellcheck disable=SC2086
  if ! wait_until 30 groups_gone $groups; then
    say "bench did not stop in 30 seconds; forcing"
    # shellcheck disable=SC2086
    for g in $groups; do kill -KILL -- "-$g" 2>/dev/null || true; done
    # shellcheck disable=SC2086
    wait_until 10 groups_gone $groups || true
  fi
else
  say "bench is not running"
fi
rm -f "$BENCH_PIDFILE"

dbpid=""
if pid_alive "$DB_PIDFILE"; then
  dbpid="$(cat "$DB_PIDFILE")"
elif pid_alive "$DB_DIR/mariadbd.pid"; then
  dbpid="$(cat "$DB_DIR/mariadbd.pid")"
fi
if [ -n "$dbpid" ] && ps -o command= -p "$dbpid" 2>/dev/null | grep -q mariadbd; then
  say "stopping database (pid $dbpid)"
  # SIGTERM makes mariadbd do a normal, clean shutdown
  kill -TERM "$dbpid" 2>/dev/null || true
  wait_until 120 proc_gone "$dbpid" || die "database did not shut down within 120 seconds"
else
  say "database is not running"
fi
rm -f "$DB_PIDFILE"

busy=""
for p in $ALL_PORTS; do
  if port_open "$p"; then busy="$busy $p"; fi
done
[ -z "$busy" ] || die "still listening on port(s):$busy"
say "books stopped; ports $ALL_PORTS are closed"
