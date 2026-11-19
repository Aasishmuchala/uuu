#!/usr/bin/env bash
# part-name: Remote door
# The remote door (PLAN-DESKTOP DW2): this Mac's own /usr/sbin/sshd, run as the owner with a configuration the
# engine rebuilds at every start. It lets in only the PCs the owner allowed, from the office's network, gives no
# shell and no files, and forwards only to their own 127.0.0.1 ports. It is off until the owner runs
# `engine remote on` in Terminal; `engine start` starts it only when that marker is there.
#   41-remote.sh start|stop|health|installed
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DOOR="$ENGINE_DIR/remote/door.mjs"
SSHD=/usr/sbin/sshd
SSHD_CONFIG="$CFG_STATE/remote/sshd_config"
PID_PATTERN="remote/sshd_config"
AWAKE_PIDFILE="$CFG_RUN/remote-awake.pid"

door_port() { "$NODE24_BIN/node" "$DOOR" port 2>/dev/null || echo 3220; }

# The door's log is the owner's alone (mode 600, never through a link), and every line in it has its time: the
# lines written here, and sshd's own, which go through a writer that adds it (REVIEW-DESKTOP L4).
private_log() {
  mkdir -p "$CFG_LOGS"
  if [ -L "$PART_LOG" ]; then rm -f "$PART_LOG"; fi
  (umask 077; : >>"$PART_LOG")
  chmod 600 "$PART_LOG"
}
log_line() { private_log; printf '%s %s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >>"$PART_LOG"; }

# As detach (_lib.sh), but the command's output goes through a writer that puts the time (UTC) before each line and
# appends it to <logfile>, opened 600 and never through a link. The writer runs in a session of its own, outside the
# command's process group, and ends by itself once the command and every process sharing its output have ended.
#   detach_stamped <pidfile> <logfile> <command> [args...]
detach_stamped() {
  local pidfile="$1" logfile="$2" i=0
  shift 2
  mkdir -p "$(dirname "$pidfile")"
  rm -f "$pidfile"
  /usr/bin/python3 -I -c '
import os, sys
STAMP = """
import os, sys, time
log = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
src = os.fdopen(0, "rb")
while True:
    line = src.readline(4096)
    if not line:
        break
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()).encode()
    os.write(log, stamp + b" " + line.rstrip(b"\\n") + b"\\n")
"""
r, w = os.pipe()
pid = os.fork()
if pid == 0:
    os.close(w)
    if os.fork() != 0:
        os._exit(0)
    os.setsid()
    os.dup2(r, 0)
    os.close(r)
    nul = os.open(os.devnull, os.O_WRONLY)
    os.dup2(nul, 1)
    os.dup2(nul, 2)
    os.execv("/usr/bin/python3", ["/usr/bin/python3", "-I", "-c", STAMP, sys.argv[2]])
os.waitpid(pid, 0)
os.close(r)
os.setsid()
with open(sys.argv[1], "w") as f:
    f.write(str(os.getpid()) + "\n")
os.dup2(w, 1)
os.dup2(w, 2)
os.close(w)
nul = os.open(os.devnull, os.O_RDONLY)
os.dup2(nul, 0)
os.execvp(sys.argv[3], sys.argv[3:])
' "$pidfile" "$logfile" "$@" </dev/null >/dev/null 2>&1 &
  while [ ! -s "$pidfile" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
}

part_installed() {
  if [ -f "$DOOR" ] && [ -f "$ENGINE_DIR/remote/remote.mjs" ] && [ -x "$SSHD" ]; then return 0; fi
  echo "The remote door is not installed yet."
  return 1
}

part_health() {
  local pid port
  pid="$(our_pid "$PART_PIDFILE" "$PID_PATTERN")"
  port="$(door_port)"
  if [ -n "$pid" ] && port_open "$port"; then
    echo "The remote door is on."
    return 0
  fi
  if [ -n "$pid" ]; then
    echo "The remote door is running but not answering; run engine stop, then engine start."
    return 2
  fi
  echo "The remote door is off."
  return 1
}

part_start() {
  local out pid
  part_installed || return 1
  health_now
  if [ "$HEALTH_CODE" = 0 ]; then echo "$HEALTH_SENTENCE"; return 0; fi
  if [ -z "$(our_pid "$PART_PIDFILE" "$PID_PATTERN")" ]; then
    if port_open "$(door_port)"; then
      echo "Another program is using the place the remote door needs, so it was not started."
      return 1
    fi
    # The seats, the template and sshd's own check; prints the one fixed reason when the door may not start.
    if ! out="$("$NODE24_BIN/node" "$DOOR" prepare)"; then
      echo "$out"
      return 1
    fi
    private_log
    detach_stamped "$PART_PIDFILE" "$PART_LOG" /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin \
      "$SSHD" -D -e -f "$SSHD_CONFIG"
  fi
  if ! wait_until 10 part_health_ok; then
    health_now
    echo "$HEALTH_SENTENCE"
    return 1
  fi
  pid="$(our_pid "$PART_PIDFILE" "$PID_PATTERN")"
  # Keeps the Mac awake while the door runs and the Mac is on power (O8); it ends with the door.
  if [ -n "$pid" ] && [ -z "$(our_pid "$AWAKE_PIDFILE" caffeinate)" ]; then
    detach "$AWAKE_PIDFILE" /dev/null /usr/bin/caffeinate -s -w "$pid"
  fi
  log_line "the remote door started"
  echo "The remote door is on."
}

# Each connection runs in a session of its own under sshd, so the door's children are found before it stops and
# stopped too: closing the door ends every PC's connection.
part_stop() {
  local pid kids k
  pid="$(our_pid "$PART_PIDFILE" "$PID_PATTERN")"
  kids=""
  if [ -n "$pid" ]; then kids="$(/usr/bin/pgrep -P "$pid" 2>/dev/null || true)"; fi
  stop_group "$PART_PIDFILE" "$PID_PATTERN" 10
  for k in $kids; do
    kill -TERM -- "-$k" 2>/dev/null || kill -TERM "$k" 2>/dev/null || true
  done
  for k in $kids; do
    wait_until 5 group_gone "$k" || kill -KILL -- "-$k" 2>/dev/null || true
  done
  stop_group "$AWAKE_PIDFILE" caffeinate 5
  [ -z "$pid" ] || log_line "the remote door stopped"
  if wait_until 5 port_closed "$(door_port)"; then return 0; fi
  echo "Something is still answering where the remote door runs."
  return 1
}

part_main "$@"
