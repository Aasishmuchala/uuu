#!/usr/bin/env bash
# Installs the Frappe bench that holds the company's books, customers,
# support and people records. Safe to run again: every step checks whether it
# is already done and skips it. Never lets free disk fall below 8 GB.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

MIN_FREE_GB=9   # refuse to start a download or build below this
BREW_PACKAGES="mariadb@11.8 pkg-config mariadb-connector-c"
# name|source|branch, installed in this order
APPS="erpnext|erpnext|version-16
india_compliance|https://github.com/resilient-tech/india-compliance|version-16
hrms|hrms|version-16
crm|crm|version-16
telephony|telephony|develop
helpdesk|helpdesk|version-16"

STATE_DIR="$BOOKS_HOME/.state"
COMMON_CONF="$BENCH_DIR/sites/common_site_config.json"
CLIENT_CNF="$RUN_DIR/books-client.cnf"
# The bench gets caches of its own, deleted after installs. The owner's shared
# uv cache is left alone: running tools (uvx, uv run) keep their environments
# there and hold its lock.
CACHE_DIR="$BOOKS_HOME/.cache"
export UV_CACHE_DIR="$CACHE_DIR/uv" YARN_CACHE_FOLDER="$CACHE_DIR/yarn"
export npm_config_cache="$CACHE_DIR/npm"

cleanup() {
  rm -f "$CLIENT_CNF"
  if [ -f "$COMMON_CONF" ]; then conf_secrets remove 2>/dev/null || true; fi
  stop_install_redis
}
trap cleanup EXIT

disk_ok() { [ "$(free_gb)" -ge "$MIN_FREE_GB" ]; }
need_disk() {
  disk_ok || die "only $(free_gb) GB free; need at least $MIN_FREE_GB GB before: $1"
  say "free disk $(free_gb) GB; ok for: $1"
}
report_disk() {
  say "free disk now $(free_gb) GB; bench folder $(du -sh "$BENCH_DIR" 2>/dev/null | cut -f1)"
}
bench_in() { (cd "$BENCH_DIR" && bench "$@" </dev/null); }

clean_caches() {
  say "cleaning the bench's yarn, uv and npm caches"
  rm -rf "$CACHE_DIR"
}

# The two redis servers the bench needs while apps install (jobs and cache).
# Only used when the bench itself is not running; stopped when install ends.
start_install_redis() {
  if bench_running; then return 0; fi
  local r port
  for r in queue cache; do
    if [ "$r" = queue ]; then port=$REDIS_QUEUE_PORT; else port=$REDIS_CACHE_PORT; fi
    redis_alive "$port" && continue
    (cd "$BENCH_DIR" && detach "$RUN_DIR/books-install-redis-$r.pid" "$LOG_DIR/books-install-redis.log" \
      redis-server "config/redis_$r.conf")
    wait_until 10 redis_alive "$port" || die "redis $r did not start on port $port"
  done
  say "redis started for the install"
}
stop_install_redis() {
  local r f
  for r in queue cache; do
    f="$RUN_DIR/books-install-redis-$r.pid"
    if pid_alive "$f"; then kill -TERM "$(cat "$f")" 2>/dev/null || true; fi
    rm -f "$f"
  done
  sleep 1
}

# Puts the database root password and the Administrator password into the
# bench config only while a site is being created (frappe reads them from
# there instead of asking), then takes them out again.
conf_secrets() {
  "$BENCH_DIR/env/bin/python" -I - "$1" "$COMMON_CONF" "$SECRETS_DIR" <<'PY'
import json, os, sys
action, path, secrets = sys.argv[1:4]
with open(path) as f:
    conf = json.load(f)
if action == "add":
    for key, name in (("root_password", "mariadb-root.txt"), ("admin_password", "bench-admin.txt")):
        with open(os.path.join(secrets, name)) as s:
            conf[key] = s.read().strip()
    mode = 0o600
else:
    if "root_password" not in conf and "admin_password" not in conf:
        sys.exit(0)
    conf.pop("root_password", None)
    conf.pop("admin_password", None)
    mode = 0o644
tmp = path + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(conf, f, indent=1, sort_keys=True)
os.chmod(tmp, mode)
os.replace(tmp, path)
PY
}

site_ready() {
  [ -f "$BENCH_DIR/sites/$SITE/site_config.json" ] && bench_in --site "$SITE" list-apps >/dev/null 2>&1
}
app_fetched() {
  [ -d "$BENCH_DIR/apps/$1" ] && grep -qx "$1" "$BENCH_DIR/sites/apps.txt"
}
app_installed() {
  bench_in --site "$SITE" list-apps 2>/dev/null | awk '{print $1}' | grep -qx "$1"
}
build_app() {
  if [ -f "$STATE_DIR/built-$1" ]; then say "assets for $1 already built"; return 0; fi
  need_disk "bench build --app $1"
  bench_in build --app "$1"
  touch "$STATE_DIR/built-$1"
}

# A client options file holding the root password, readable only by this user
# and deleted when the script exits, so the password never reaches a command line.
write_client_cnf() {
  ( umask 077
    printf '[client]\nuser=root\npassword=%s\nsocket=%s\n' \
      "$(cat "$SECRETS_DIR/mariadb-root.txt")" "$DB_SOCKET" > "$CLIENT_CNF" )
}
root_sql() { mariadb --defaults-extra-file="$CLIENT_CNF" "$@"; }

mkdir -p "$BOOKS_HOME" "$LOG_DIR" "$RUN_DIR"
mkdir -p "$SECRETS_DIR" && chmod 700 "$SECRETS_DIR"

# --- 1. Homebrew packages ----------------------------------------------------
for pkg in $BREW_PACKAGES; do
  if brew list --versions "$pkg" >/dev/null 2>&1; then
    say "homebrew $pkg already installed"
    continue
  fi
  need_disk "brew install $pkg"
  dl="$(brew --cache)/downloads"
  before="$(ls "$dl" 2>/dev/null || true)"
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_UPGRADE=1 \
    HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 HOMEBREW_NO_INSTALL_CLEANUP=1 \
    HOMEBREW_NO_ANALYTICS=1 brew install "$pkg"
  # remove only the downloads this step added
  for f in $(ls "$dl" 2>/dev/null || true); do
    case "$before" in *"$f"*) ;; *) rm -f "$dl/$f" ;; esac
  done
done
[ -x "$MARIADB_PREFIX/bin/mariadbd" ] || die "mariadbd not found under $MARIADB_PREFIX"

# --- 2. yarn on Node 24, and the bench tool -----------------------------------
[ -x "$NODE_BIN/node" ] || die "Node 24 not found at $NODE_BIN"
if [ -x "$NODE_BIN/yarn" ]; then
  say "yarn already installed on Node 24"
else
  need_disk "npm install -g yarn"
  "$NODE_BIN/npm" install -g yarn
fi
if [ -x "$HOME/.local/bin/bench" ]; then
  say "bench tool already installed"
else
  need_disk "uv tool install frappe-bench"
  uv tool install frappe-bench
fi
PY="$(py314)"
say "using $PY ($("$PY" --version)), node $(node --version), yarn $(yarn --version), $(bench --version 2>/dev/null | head -1 | sed 's/^/bench /')"

# --- 3. Secrets --------------------------------------------------------------
for s in mariadb-root bench-admin; do
  f="$SECRETS_DIR/$s.txt"
  if [ -s "$f" ]; then
    say "secret $s.txt already exists"
  else
    ( umask 077; openssl rand -hex 24 > "$f" )
    say "generated secret $s.txt"
  fi
  chmod 600 "$f"
done

# --- 4. Private MariaDB --------------------------------------------------------
cat > "$DB_CNF" <<EOF
# Private MariaDB for the books bench. Started by engine/books/start.sh only.
[mariadbd]
datadir=$DB_DIR
port=$DB_PORT
socket=$DB_SOCKET
bind-address=127.0.0.1
pid-file=$DB_DIR/mariadbd.pid
log-error=$LOG_DIR/books-mariadb.log
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
innodb_buffer_pool_size=256M
max_connections=100

[client]
default-character-set=utf8mb4
EOF
if [ -d "$DB_DIR/mysql" ]; then
  say "database files already created in $DB_DIR"
else
  need_disk "create the database files"
  rm -rf "$DB_DIR"
  mariadb-install-db --no-defaults --basedir="$MARIADB_PREFIX" --datadir="$DB_DIR" \
    --auth-root-authentication-method=normal --skip-test-db \
    --user="$(id -un)" >>"$DB_LOG" 2>&1 || die "mariadb-install-db failed; see $DB_LOG"
  say "database files created"
fi
for p in $ALL_PORTS; do
  if [ "$p" = "$DB_PORT" ] && db_alive; then continue; fi
  if [ "$p" != "$DB_PORT" ] && [ -f "$BENCH_PIDFILE" ] && pid_alive "$BENCH_PIDFILE"; then continue; fi
  if port_open "$p"; then die "port $p is already in use by another program"; fi
done
start_db
write_client_cnf
if root_sql -e "SELECT 1" >/dev/null 2>&1; then
  say "database root password already set"
else
  say "setting the database root password"
  pw="$(cat "$SECRETS_DIR/mariadb-root.txt")"
  printf "%s\n" \
    "ALTER USER 'root'@'localhost' IDENTIFIED BY '$pw';" \
    "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '$pw';" \
    "GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;" \
    "DELETE FROM mysql.global_priv WHERE User='';" \
    "FLUSH PRIVILEGES;" \
    | mariadb --no-defaults --socket="$DB_SOCKET" -uroot
  unset pw
  root_sql -e "SELECT 1" >/dev/null || die "root password did not take effect"
fi
# mariadb-install-db also makes password-less root accounts for ::1 and the
# machine's host name; keep only the two that have the password.
root_sql -e "DELETE FROM mysql.global_priv WHERE User='' OR (User='root' AND Host NOT IN ('localhost','127.0.0.1')); FLUSH PRIVILEGES;"

# --- 5. The bench ------------------------------------------------------------
if [ -d "$BENCH_DIR/apps/frappe" ] && [ -x "$BENCH_DIR/env/bin/python" ] \
   && grep -qx frappe "$BENCH_DIR/sites/apps.txt" 2>/dev/null; then
  say "bench already created in $BENCH_DIR"
else
  need_disk "bench init (frappe version-16)"
  rm -rf "$BENCH_DIR"
  (cd "$BOOKS_HOME" && bench init --frappe-branch version-16 --python "$PY" \
    --skip-assets --no-backups --skip-redis-config-generation "$BENCH_DIR")
  clean_caches
  report_disk
fi

# Ports, redis config and the Procfile (cheap; done every run).
bench_in set-config -g webserver_port "$WEB_PORT" >/dev/null
bench_in set-config -g socketio_port "$SOCKETIO_PORT" >/dev/null
bench_in set-config -g redis_queue "redis://127.0.0.1:$REDIS_QUEUE_PORT" >/dev/null
bench_in set-config -g redis_cache "redis://127.0.0.1:$REDIS_CACHE_PORT" >/dev/null
bench_in set-config -g redis_socketio "redis://127.0.0.1:$REDIS_CACHE_PORT" >/dev/null
bench_in setup redis >/dev/null
rm -f "$BENCH_DIR/Procfile"
bench_in setup procfile >/dev/null
# No asset watcher (not needed). The web server is started through
# serve_local.py so that it listens on this Mac only; `bench serve` listens on
# every network interface. No socket server either: it also listens on every
# interface, and only the bench's own desk pages use it (for live refresh).
cp "$HERE/serve_local.py" "$BENCH_DIR/serve_local.py"
sed -i '' -e '/^watch:/d' -e '/^socketio:/d' \
  -e 's|^web: .*$|web: env/bin/python serve_local.py '"$WEB_PORT"' '"$SITE"'|' "$BENCH_DIR/Procfile"
grep -q '^watch:' "$BENCH_DIR/Procfile" && die "could not remove the watch line from the Procfile"
grep -q '^socketio:' "$BENCH_DIR/Procfile" && die "could not remove the socketio line from the Procfile"
grep -q '^web: env/bin/python serve_local.py ' "$BENCH_DIR/Procfile" || die "could not set the web line in the Procfile"
say "bench config: web $WEB_PORT, socketio $SOCKETIO_PORT, redis queue $REDIS_QUEUE_PORT, redis cache $REDIS_CACHE_PORT"
mkdir -p "$STATE_DIR"

# --- 6. The site -------------------------------------------------------------
start_install_redis
if site_ready; then
  say "site $SITE already created"
else
  need_disk "bench new-site $SITE"
  force=""
  if [ -d "$BENCH_DIR/sites/$SITE" ]; then force="--force"; say "re-creating half-made site $SITE"; fi
  conf_secrets add
  bench_in new-site "$SITE" --db-host 127.0.0.1 --db-port "$DB_PORT" \
    --db-root-username root --set-default ${force:+"$force"}
  conf_secrets remove
  site_ready || die "site $SITE was not created"
fi
if grep -q '"admin_password"\|"root_password"' "$BENCH_DIR/sites/$SITE/site_config.json" "$COMMON_CONF"; then
  die "a password was left in the bench config"
fi
# the site's own database password lives here; keep it private to this user
chmod 600 "$BENCH_DIR/sites/$SITE/site_config.json"
bench_in use "$SITE" >/dev/null
build_app frappe
report_disk

# --- 7. Apps, one at a time ----------------------------------------------------
skipped=""
while IFS='|' read -r name src branch; do
  [ -n "$name" ] || continue
  if [ -n "$skipped" ]; then skipped="$skipped $name"; continue; fi
  say "app $name ($branch)"
  if app_fetched "$name"; then
    say "$name already fetched"
  elif ! disk_ok; then
    say "only $(free_gb) GB free; skipping $name and every app after it"
    skipped="$name"; continue
  else
    rm -rf "${BENCH_DIR:?}/apps/$name"
    bench_in get-app --branch "$branch" --skip-assets "$src"
  fi
  if app_installed "$name"; then
    say "$name already installed on $SITE"
  else
    bench_in --site "$SITE" install-app "$name"
  fi
  if ! disk_ok; then
    say "only $(free_gb) GB free; not building $name; skipping every app after it"
    skipped="$name:assets-not-built"; continue
  fi
  build_app "$name"
  clean_caches
  report_disk
done <<EOF
$APPS
EOF
if [ -n "$skipped" ]; then
  printf '%s\n' $skipped > "$SKIPPED_FILE"
  say "skipped (not enough disk): $skipped; listed in $SKIPPED_FILE"
else
  rm -f "$SKIPPED_FILE"
  say "all apps installed"
fi
bench_in --site "$SITE" set-maintenance-mode off >/dev/null 2>&1 || true

# --- 8. Start it, finish first-run setup, owner API key ----------------------
stop_install_redis
"$HERE/start.sh"
(cd "$BENCH_DIR/sites" && "$BENCH_DIR/env/bin/python" "$HERE/books_setup.py" setup "$SITE")
if [ -s "$SECRETS_DIR/bench-owner-api.txt" ]; then
  say "owner API key already exists"
else
  (cd "$BENCH_DIR/sites" && "$BENCH_DIR/env/bin/python" "$HERE/books_setup.py" owner-key "$SITE" \
    "$SECRETS_DIR/bench-owner-api.txt")
fi
chmod 600 "$SECRETS_DIR"/*.txt

clean_caches
report_disk
say "install complete; books running at http://127.0.0.1:$WEB_PORT (site $SITE)"
