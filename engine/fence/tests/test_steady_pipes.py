"""steady-pipes.py: a command behind the relay delivers all its output to a
slow reader even when the pipe it was handed is in non-blocking mode (what the
Node programs above Codex do to it). Without the relay the same write breaks.

Run: /usr/bin/python3 -m unittest discover -s engine/fence/tests -p 'test_*.py'
"""
import fcntl
import os
import subprocess
import sys
import threading
import time
import unittest

FENCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELAY = os.path.join(FENCE, "steady-pipes.py")
TOTAL = 5000000
WRITER = [sys.executable, "-c",
          "import sys; sys.stdout.buffer.write(b'x' * %d); sys.stdout.buffer.flush()" % TOTAL]


def run_with_slow_reader(argv):
    """Starts argv with stdout on a non-blocking pipe and reads it slowly.
    Returns (bytes received, exit code)."""
    r, w = os.pipe()
    flags = fcntl.fcntl(w, fcntl.F_GETFL)
    fcntl.fcntl(w, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    proc = subprocess.Popen(argv, stdout=w, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    os.close(w)
    got = [0]

    def reader():
        time.sleep(0.3)  # let the pipe fill up first
        while True:
            chunk = os.read(r, 16384)
            if not chunk:
                break
            got[0] += len(chunk)
            time.sleep(0.0005)

    t = threading.Thread(target=reader)
    t.start()
    code = proc.wait(timeout=120)
    t.join(timeout=120)
    os.close(r)
    return got[0], code


class SteadyPipesTests(unittest.TestCase):
    def test_slow_reader_gets_everything(self):
        got, code = run_with_slow_reader([sys.executable, RELAY] + WRITER)
        self.assertEqual(code, 0)
        self.assertEqual(got, TOTAL)

    def test_without_relay_the_write_breaks(self):
        # Shows the test reproduces the problem the relay exists for.
        got, code = run_with_slow_reader(WRITER)
        self.assertTrue(got < TOTAL or code != 0, "the unrelayed write should fail")

    def test_exit_code_passes_through(self):
        r = subprocess.run([sys.executable, RELAY, sys.executable, "-c", "import sys; sys.exit(7)"])
        self.assertEqual(r.returncode, 7)

    def test_stderr_is_relayed(self):
        r = subprocess.run([sys.executable, RELAY, sys.executable, "-c",
                            "import sys; sys.stderr.write('oops')"], capture_output=True)
        self.assertEqual(r.stderr, b"oops")


if __name__ == "__main__":
    unittest.main()
