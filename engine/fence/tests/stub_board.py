"""A small stand-in for the board's issue answers, for the tests of the walled
run's goal lookup (fence_inputs.goal_identifier). A local HTTP server on a port
the system picks; it records every request and never leaves the machine.

  board = StubBoard(); board.start()          # board.port
  board.issues[id] = {...}                    # answered as 200 JSON
  board.special[id] = ("status", 404) / ("slow", seconds) / ("big", bytes)
                      / ("redirect", location) / ("raw", bytes)
"""
import http.server
import json
import threading
import time

ISSUE_PATH = "/api/issues/"


class StubBoard:
    def __init__(self):
        self.issues = {}
        self.special = {}
        self.seen = []          # (path, authorization header)
        stub = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_GET(self):
                stub.seen.append((self.path, self.headers.get("Authorization")))
                key = self.path[len(ISSUE_PATH):] if self.path.startswith(ISSUE_PATH) else None
                kind, arg = stub.special.get(key, (None, None))
                if kind == "slow":
                    time.sleep(arg)
                if kind == "status":
                    return self.send(arg, b"{}")
                if kind == "redirect":
                    self.send_response(302)
                    self.send_header("Location", arg)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if kind == "big":
                    return self.send(200, b'{"pad":"' + b"x" * arg + b'"}')
                if kind == "raw":
                    return self.send(200, arg)
                if key in stub.issues:
                    return self.send(200, json.dumps(stub.issues[key]).encode())
                self.send(404, b'{"error":"Issue not found"}')

            def send(self, code, body):
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except OSError:
                    pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
