// Test helpers for the home server's tests (and the next wave's). Not used by the running server.
import http from "node:http";

// One HTTP call with full control of headers. Non-GET calls get the home screen's own headers
// (Content-Type: application/json and X-Engine: 1) unless `bare` is set.
// -> { status, headers, text, json, buffer }
export function call(base, method, path, { body, headers = {}, bare = false, raw } = {}) {
  const u = new URL(base);
  const h = { host: `127.0.0.1:${u.port}`, ...headers };
  if (!bare && method !== "GET" && method !== "HEAD") {
    if (!("content-type" in h)) h["content-type"] = "application/json";
    if (!("x-engine" in h)) h["x-engine"] = "1";
  }
  let data = null;
  if (raw !== undefined) data = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  else if (body !== undefined) data = Buffer.from(JSON.stringify(body));
  if (data && !("content-length" in h)) h["content-length"] = data.length;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: u.port, method, path, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buffer });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// The non-GET requests the stub board saw, as "METHOD /path".
export function writes(stub) {
  return stub.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`);
}
