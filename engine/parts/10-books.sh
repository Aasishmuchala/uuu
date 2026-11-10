#!/usr/bin/env bash
# part-name: Books
# The books (the Frappe bench that is the system of record). Wraps the bench's
# own scripts in engine/books/: start.sh, stop.sh and status.sh.
#   10-books.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

BOOKS_DIR="$ENGINE_DIR/books"

part_installed() {
  if [ -d "$CFG_STATE/books/bench" ] && [ -f "$BOOKS_DIR/start.sh" ] \
    && [ -f "$BOOKS_DIR/stop.sh" ] && [ -f "$BOOKS_DIR/status.sh" ]; then
    return 0
  fi
  echo "The books are not installed on this Mac."
  return 1
}

# status.sh prints one line per piece ("database: on") and exits 0 only when
# every piece is on.
part_health() {
  local out code=0 line piece state off="" on_any=0 bad=""
  out="$(/bin/bash "$BOOKS_DIR/status.sh" 2>/dev/null)" || code=$?
  if [ "$code" = 0 ]; then
    echo "The books are on."
    return 0
  fi
  while IFS= read -r line; do
    piece="${line%%:*}"
    state="$(printf '%s' "${line#*:}" | tr -d ' ')"
    [ -n "$piece" ] || continue
    case "$piece" in
      database) piece="the database" ;;
      web) piece="the web pages" ;;
      "background workers") piece="the background work" ;;
      cache) piece="the cache" ;;
    esac
    case "$state" in
      on) on_any=1 ;;
      off) off="${off:+$off, }$piece" ;;
      *) on_any=1; bad="${bad:+$bad, }$piece" ;;
    esac
  done <<EOF
$out
EOF
  if [ "$on_any" = 0 ]; then
    echo "The books are off; run engine start to turn them on."
    return 1
  fi
  if [ -n "$bad" ]; then
    echo "The books are only partly working: $bad is not answering; run engine stop, then engine start."
  else
    echo "The books are only partly working: $off is off; run engine stop, then engine start."
  fi
  return 2
}

part_start() {
  # the bench's own script waits for its web pages; its messages go to the log
  if ! /bin/bash "$BOOKS_DIR/start.sh" >>"$PART_LOG" 2>&1; then
    health_now
    echo "$HEALTH_SENTENCE"
    return 1
  fi
  # the background work and the cache may need a moment more
  if wait_until 90 part_health_ok; then return 0; fi
  health_now
  echo "$HEALTH_SENTENCE"
  return 1
}

part_stop() {
  if /bin/bash "$BOOKS_DIR/stop.sh" >>"$PART_LOG" 2>&1; then
    return 0
  fi
  echo "The books did not stop completely."
  return 1
}

part_main "$@"
