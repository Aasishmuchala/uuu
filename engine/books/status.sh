#!/usr/bin/env bash
# Says whether each part of the books is on, off or unhealthy (running but
# not answering). Exits 0 only if every part is on.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

all_on=1
show() {
  printf '%-19s %s\n' "$1:" "$2"
  [ "$2" = "on" ] || all_on=0
}

# database: the private MariaDB
if db_alive; then show database on
elif port_open "$DB_PORT" || pid_alive "$DB_PIDFILE"; then show database unhealthy
else show database off; fi

# web: the web server (answers ping). The socket server is not run: see install.sh.
if web_alive; then show web on
elif port_open "$WEB_PORT"; then show web unhealthy
else show web off; fi

# background workers: the job worker and the scheduler, plus the job queue
procs=""
if bench_running; then procs="$(bench_tree)"; fi
n_worker=0; n_sched=0
case "$procs" in *"frappe worker"*) n_worker=1 ;; esac
case "$procs" in *"frappe schedule"*) n_sched=1 ;; esac
if [ "$n_worker" = 1 ] && [ "$n_sched" = 1 ] && redis_alive "$REDIS_QUEUE_PORT"; then
  show "background workers" on
elif [ "$n_worker" = 0 ] && [ "$n_sched" = 0 ] && ! port_open "$REDIS_QUEUE_PORT"; then
  show "background workers" off
else
  show "background workers" unhealthy
fi

# cache
if redis_alive "$REDIS_CACHE_PORT"; then show cache on
elif port_open "$REDIS_CACHE_PORT"; then show cache unhealthy
else show cache off; fi

[ "$all_on" = 1 ]
