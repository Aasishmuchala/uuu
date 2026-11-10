#!/usr/bin/env bash
# Starts the books (the Frappe bench): the private database first, then the
# bench's web server, socket server, workers, scheduler and caches in the
# background. Exits 0 only when the web server answers. Running it again
# while everything is up starts nothing new.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

mkdir -p "$LOG_DIR" "$RUN_DIR"
[ -f "$BENCH_DIR/Procfile" ] || die "no bench in $BENCH_DIR; run install.sh first"

start_db

if bench_running; then
  say "bench already running (process group $(cat "$BENCH_PIDFILE"))"
else
  rm -f "$BENCH_PIDFILE"
  for p in $WEB_PORT $REDIS_QUEUE_PORT $REDIS_CACHE_PORT; do
    if port_open "$p"; then die "port $p is taken by another program"; fi
  done
  say "starting bench processes; output goes to $BENCH_LOG"
  (cd "$BENCH_DIR" && detach "$BENCH_PIDFILE" "$BENCH_LOG" bench start)
fi

say "waiting for the web server on http://127.0.0.1:$WEB_PORT"
wait_until 180 web_alive || die "web server did not answer within 180 seconds; see $BENCH_LOG"
say "books is up at http://127.0.0.1:$WEB_PORT"
