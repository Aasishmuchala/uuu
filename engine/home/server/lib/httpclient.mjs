// A small HTTP client on node:http for local services only (board, gate, bench).
// It ignores proxy variables, adds no header of its own beyond the ones given, and never logs.
import http from "node:http";

// -> { status, text } ; throws { offline: true } when nothing answers or the call times out.
export function httpRequest(url, { method = "GET", headers = {}, body, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname)) {
      reject(Object.assign(new Error("only local addresses are allowed"), { offline: true }));
      return;
    }
    const data = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const h = { ...headers };
    if (data) h["content-length"] = data.length;
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers: h, agent: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => reject(Object.assign(new Error("connection lost"), { offline: true })));
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timed out"), { offline: true })));
    req.on("error", (e) => reject(Object.assign(new Error(e.message), { offline: true })));
    if (data) req.write(data);
    req.end();
  });
}

export function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return undefined; }
}
