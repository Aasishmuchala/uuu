// The viewer's own proxy: the wall around the hidden Chrome (PLAN-V5 K15, and the findings of
// prototype p2: with --proxy-bypass-list=<-loopback> every address, local ones included, goes
// through here). It passes exactly one destination, the throwaway site at
// http://127.0.0.1:<sitePort>, and only GET and HEAD to it. Everything else is refused and
// told to `onBlocked` as "host:port": any other host or port, CONNECT (so every https, wss
// and tunnelled way), upgrades, a request that is not in a proxy's absolute form. It never
// resolves a name and never opens a socket anywhere but the site's port. Zero dependencies.
import http from "node:http";

// Plain capped text of where a refused request wanted to go.
export function blockedAddress(target, method) {
  const text = String(target || "");
  if (method === "CONNECT") return text.replace(/[^\x21-\x7e]/g, "?").slice(0, 140);
  try {
    const u = new URL(text);
    const port = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
    return `${u.hostname}${port ? `:${port}` : ""}`.replace(/[^\x21-\x7e]/g, "?").slice(0, 140);
  } catch {
    return `(not an address: ${text.replace(/[^\x21-\x7e]/g, "?").slice(0, 60)})`;
  }
}

// The one destination this proxy passes, as the request names it; null for anything else.
export function passes(target, method, sitePort) {
  if (method !== "GET" && method !== "HEAD") return null;
  if (typeof target !== "string" || !target.startsWith("http://127.0.0.1:")) return null;
  let u;
  try { u = new URL(target); } catch { return null; }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.port !== String(sitePort)) return null;
  if (u.username || u.password) return null;
  return u.pathname + u.search;
}

// Starts the proxy on a free 127.0.0.1 port. -> { port, close() }.
export function startProxy({ sitePort, onBlocked = () => {}, onPassed = () => {} } = {}) {
  if (!Number.isInteger(sitePort) || sitePort < 1 || sitePort > 65535) throw new Error("startProxy: sitePort");
  const sockets = new Set();
  const block = (how, to) => { try { onBlocked(to, how); } catch { /* a listener's failure changes nothing */ } };
  const refuseSocket = (sock) => {
    sock.on("error", () => {});
    if (!sock.writable) return void sock.destroy();
    sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", () => sock.destroy());
  };
  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    const path = passes(req.url, req.method, sitePort);
    if (path === null) {
      block(req.method, blockedAddress(req.url, req.method));
      res.writeHead(403, { "Content-Type": "text/plain", "Content-Length": 8, Connection: "close" });
      return void res.end("refused\n");
    }
    onPassed(req.method, path);
    // A fresh request to the site with none of the page's headers but the ones a static
    // file needs; the answer is copied back as the site sent it.
    const headers = { host: `127.0.0.1:${sitePort}` };
    for (const k of ["accept", "accept-language", "if-none-match", "if-modified-since"]) {
      if (typeof req.headers[k] === "string") headers[k] = req.headers[k];
    }
    const up = http.request({ host: "127.0.0.1", port: sitePort, method: req.method, path, headers, agent: false }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) { res.writeHead(502, { Connection: "close" }); } res.end(); });
    up.setTimeout(15_000, () => up.destroy());
    req.resume();
    up.end();
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  server.on("clientError", (_e, sock) => sock.destroy());
  server.on("connect", (req, sock) => { block("CONNECT", blockedAddress(req.url, "CONNECT")); refuseSocket(sock); });
  server.on("upgrade", (req, sock) => { block("UPGRADE", blockedAddress(req.url, "UPGRADE")); refuseSocket(sock); });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => {
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
      });
    });
  });
}
