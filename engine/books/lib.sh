# Shared settings and helpers for the books scripts (the Frappe bench that is
# the company's system of record). Sourced by install.sh, start.sh, stop.sh
# and status.sh; never run on its own. Works with macOS bash 3.2.

ENGINE_HOME="$HOME/.paperclip/uuu-engine"
BOOKS_HOME="$ENGINE_HOME/books"
BENCH_DIR="$BOOKS_HOME/bench"
DB_DIR="$BOOKS_HOME/mariadb"
DB_CNF="$BOOKS_HOME/my.cnf"
SKIPPED_FILE="$BOOKS_HOME/skipped-apps.txt"
SECRETS_DIR="$ENGINE_HOME/secrets"
LOG_DIR="$ENGINE_HOME/logs"
RUN_DIR="$ENGINE_HOME/run"

DB_SOCKET="$RUN_DIR/books-mariadb.sock"
DB_PIDFILE="$RUN_DIR/books-mariadb.pid"
BENCH_PIDFILE="$RUN_DIR/books-bench.pid"
DB_LOG="$LOG_DIR/books-mariadb.log"
BENCH_LOG="$LOG_DIR/books-bench.log"

SITE="engine.localhost"
DB_PORT=3317
WEB_PORT=8120
SOCKETIO_PORT=9120
REDIS_QUEUE_PORT=11120
REDIS_CACHE_PORT=13120
ALL_PORTS="$DB_PORT $WEB_PORT $SOCKETIO_PORT $REDIS_QUEUE_PORT $REDIS_CACHE_PORT"

HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"
MARIADB_PREFIX="$HOMEBREW_PREFIX/opt/mariadb@11.8"
NODE_BIN="$HOME/.nvm/versions/node/v24.13.0/bin"

# Node 24 first, then the bench tool, then the private MariaDB's programs.
export PATH="$NODE_BIN:$HOME/.local/bin:$MARIADB_PREFIX/bin:$HOMEBREW_PREFIX/bin:$PATH"
# mysqlclient (a frappe dependency) is built from source and finds MariaDB's
# client library through pkg-config; MariaDB 11.8 is keg-only.
export PKG_CONFIG_PATH="$MARIADB_PREFIX/lib/pkgconfig:$HOMEBREW_PREFIX/opt/mariadb-connector-c/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

say() { printf '[books] %s\n' "$*"; }
die() { printf '[books] ERROR: %s\n' "$*" >&2; exit 1; }

# Python 3.14, used for the bench and for the small detach helper below.
py314() {
  if [ -z "${PY314:-}" ]; then
    PY314="$(uv python find 3.14 2>/dev/null)" || die "Python 3.14 not found (uv python find 3.14)"
  fi
  printf '%s\n' "$PY314"
}

# True when something listens on 127.0.0.1:<port>.
port_open() { nc -z -G 1 127.0.0.1 "$1" >/dev/null 2>&1; }

# True when the process in pid file $1 is alive.
pid_alive() {
  [ -f "$1" ] || return 1
  local pid
  pid="$(cat "$1" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Free disk in whole GiB on the home volume (same units as df -h).
free_gb() { df -k "$HOME" | tail -1 | awk '{ printf "%d\n", $4 / 1048576 }'; }

# Runs a command in a new session (own process group), detached from this
# shell, with stdout and stderr appended to a log. The process id (which is
# also the process group id) goes to a pid file.
#   detach <pidfile> <logfile> <command> [args...]
detach() {
  local pidfile="$1" logfile="$2"
  shift 2
  "$(py314)" -I -c '
import os, sys
os.setsid()
with open(sys.argv[1], "w") as f:
    f.write(str(os.getpid()) + "\n")
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(fd, 1)
os.dup2(fd, 2)
nul = os.open(os.devnull, os.O_RDONLY)
os.dup2(nul, 0)
os.execvp(sys.argv[3], sys.argv[3:])
' "$pidfile" "$logfile" "$@" &
  # wait for the pid file so callers can rely on it
  local i=0
  while [ ! -s "$pidfile" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
}

# Waits up to $1 seconds for the command in the remaining arguments to succeed.
wait_until() {
  local secs="$1" i=0
  shift
  while [ "$i" -lt "$secs" ]; do
    if "$@"; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  "$@"
}

# True when the bench process from the pid file is alive and is ours.
bench_running() {
  pid_alive "$BENCH_PIDFILE" || return 1
  ps -o command= -p "$(cat "$BENCH_PIDFILE")" 2>/dev/null | grep -q 'honcho start\|bench start'
}

# Prints "pid pgid command" for the bench process and everything under it.
# honcho puts each Procfile process in a session of its own, so the bench's
# own process group alone does not cover them.
bench_tree() {
  [ -f "$BENCH_PIDFILE" ] || return 0
  ps -axo pid=,ppid=,pgid=,command= | awk -v root="$(cat "$BENCH_PIDFILE")" '
    { parent[$1] = $2; pgid[$1] = $3; $2 = ""; $3 = ""; cmd[$1] = $0 }
    END {
      for (p in parent) {
        q = p
        while (q > 1) {
          if (q == root) { print p, pgid[p], cmd[p]; break }
          q = parent[q]
        }
      }
    }'
}

db_alive() {
  [ -S "$DB_SOCKET" ] || return 1
  # mariadb-admin ping exits 0 whenever the server answers, even if it
  # refuses the (password-less) login, so no secret is needed here.
  "$MARIADB_PREFIX/bin/mariadb-admin" --no-defaults --socket="$DB_SOCKET" \
    --connect-timeout=2 ping >/dev/null 2>&1
}

web_alive() {
  curl -s -m 5 "http://127.0.0.1:$WEB_PORT/api/method/ping" 2>/dev/null | grep -q '"pong"'
}

redis_alive() {
  [ "$(redis-cli -h 127.0.0.1 -p "$1" ping 2>/dev/null)" = "PONG" ]
}

# Starts the private MariaDB if it is not running and waits until it answers.
start_db() {
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  if db_alive; then say "database already running on port $DB_PORT"; return 0; fi
  [ -d "$DB_DIR/mysql" ] || die "no MariaDB data in $DB_DIR; run install.sh first"
  if port_open "$DB_PORT"; then die "port $DB_PORT is taken by another program"; fi
  say "starting database on 127.0.0.1:$DB_PORT"
  rm -f "$DB_SOCKET"
  detach "$DB_PIDFILE" "$DB_LOG" "$MARIADB_PREFIX/bin/mariadbd" --defaults-file="$DB_CNF"
  wait_until 60 db_alive || die "database did not answer within 60 seconds; see $DB_LOG"
  say "database is up"
}
