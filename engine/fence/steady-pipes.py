#!/usr/bin/env python3
# Runs a command with pipes of its own and copies its output to ours. The Codex
# wrapper starts Codex through this, inside the fence.
#
# Why: the Node programs above us (paperclip, sandbox-runtime) share our output
# pipe and can switch it to non-blocking mode at any moment. Codex is a Rust
# program that expects a blocking pipe; on a large write it then gets "Resource
# temporarily unavailable (os error 35)" and crashes mid-task. Seen twice on the
# Checker on 2026-11-11, the second time after merely resetting the mode at
# start-up, so the command must not share the pipe at all.
# Tested against a deliberately slow reader (tests/test_steady_pipes.py):
# 5,000,000 of 5,000,000 bytes arrive through the relay.
import fcntl, os, select, signal, subprocess, sys


def write_all(fd, data):
    view = memoryview(data)
    while view:
        try:
            view = view[os.write(fd, view):]
        except BlockingIOError:
            select.select([], [fd], [], 1.0)   # the pipe is full: wait for the reader
        except BrokenPipeError:
            return


if len(sys.argv) < 2:
    sys.stderr.write("steady-pipes: no command given\n")
    sys.exit(64)
flags = fcntl.fcntl(0, fcntl.F_GETFL)
if flags & os.O_NONBLOCK:
    fcntl.fcntl(0, fcntl.F_SETFL, flags & ~os.O_NONBLOCK)
proc = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, lambda number, frame: proc.send_signal(number))
streams = {proc.stdout.fileno(): 1, proc.stderr.fileno(): 2}
while streams:
    ready, _, _ = select.select(list(streams), [], [])
    for fd in ready:
        data = os.read(fd, 65536)
        if data:
            write_all(streams[fd], data)
        else:
            del streams[fd]
code = proc.wait()
sys.exit(code if code >= 0 else 128 - code)
