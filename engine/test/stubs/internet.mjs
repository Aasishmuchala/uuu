// A stand-in internet for the web door's tests (PLAN-V5 T26). Nothing leaves 127.0.0.1.
//
//   const net = await startInternet({ sites: { "site.test": { addresses: ["93.184.216.34"], handler } } });
//   createWebDoor({ ..., net: net.net })
//
// `net.resolve(name)` answers each made-up name with the addresses the test chose (public
// looking ones included; a function of the lookup's number lets an answer change between
// lookups); an unknown name does not resolve. `net.connect({ address, port, ... })` lands an
// address a site was given on that site's own server on 127.0.0.1, and refuses every other
// address, so the door's real checks run unmodified and no socket ever goes anywhere else.
// `seen` records every lookup, every connection and every request a site received (with its
// raw headers). The behaviours below make sites that redirect, stall, drip, send too much,
// send a compressed bomb or the wrong type.
import http from "node:http";
import { connect as tcpConnect } from "node:net";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";

const MB = 1024 * 1024;

export async function startInternet({ sites = {} } = {}) {
  const seen = { lookups: [], connects: [], requests: [] };
  const servers = new Map(); // name -> { server, port, site }
  const lookupsOf = new Map();

  for (const [name, site] of Object.entries(sites)) {
    const server = http.createServer((req, res) => {
      seen.requests.push({ site: name, method: req.method, url: req.url, rawHeaders: [...req.rawHeaders] });
      req.resume();
      try {
        (site.handler || ok("<p>ok</p>"))(req, res, { name });
      } catch {
        res.destroy();
      }
    });
    server.keepAliveTimeout = 100;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.set(name, { server, port: server.address().port, site });
  }

  const addressesOf = (name, n) => {
    const s = servers.get(name);
    if (!s) return null;
    const a = s.site.addresses;
    return typeof a === "function" ? a(n) : a || ["93.184.216.34"];
  };

  const net = {
    async resolve(host) {
      seen.lookups.push(host);
      const n = (lookupsOf.get(host) || 0) + 1;
      lookupsOf.set(host, n);
      const list = addressesOf(host, n);
      if (!list || list.length === 0) {
        const err = new Error("not found");
        err.code = "ENOTFOUND";
        throw err;
      }
      return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    connect(opts) {
      const { address, port, hostname, secure } = opts;
      seen.connects.push({ address, port, hostname, secure });
      // The site this address was handed out for (any lookup so far).
      // The site of that name first, so two sites may share an address.
      const handedOut = (name) => {
        const all = new Set();
        const count = Math.max(1, lookupsOf.get(name) || 0);
        for (let i = 1; i <= count; i += 1) for (const a of addressesOf(name, i) || []) all.add(a);
        return all.has(address);
      };
      let target = servers.has(hostname) && handedOut(hostname) ? servers.get(hostname) : null;
      for (const [name, s] of servers) {
        if (target) break;
        if (handedOut(name)) target = s;
      }
      // Only ever 127.0.0.1: an address no site was given gets a socket that fails.
      return tcpConnect({ host: "127.0.0.1", port: target ? target.port : 1 });
    },
  };

  return {
    net,
    seen,
    port: (name) => (servers.get(name) || {}).port,
    close() {
      return Promise.all([...servers.values()].map(({ server }) => new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })));
    },
  };
}

// ---- behaviours -------------------------------------------------------------

export function ok(body, { type = "text/html; charset=utf-8", status = 200, headers = {} } = {}) {
  return (_req, res) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    res.writeHead(status, { "Content-Type": type, "Content-Length": buf.length, ...headers });
    res.end(buf);
  };
}

export function redirect(location, { status = 302, headers = {} } = {}) {
  return (_req, res) => {
    res.writeHead(status, { Location: location, "Content-Length": 0, ...headers });
    res.end();
  };
}

// Never answers.
export function stall() {
  return () => {};
}

// Sends the head, then one byte every `everyMs`, forever.
export function drip(everyMs = 50) {
  return (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    const t = setInterval(() => res.write("a"), everyMs);
    res.on("close", () => clearInterval(t));
    req.on("close", () => clearInterval(t));
  };
}

// `bytes` of text, with or without a declared length.
export function big(bytes = 6 * MB, { declare = true, type = "text/html" } = {}) {
  return (_req, res) => {
    res.writeHead(200, { "Content-Type": type, ...(declare ? { "Content-Length": bytes } : {}) });
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let left = bytes;
    const pump = () => {
      while (left > 0) {
        const n = Math.min(left, chunk.length);
        left -= n;
        if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return void res.once("drain", pump);
      }
      res.end();
    };
    res.on("error", () => {});
    pump();
  };
}

// A small compressed body that unpacks to `unpacked` bytes.
let bombs = null;
export function bomb(kind = "gzip", unpacked = 64 * MB) {
  bombs = bombs || new Map();
  const key = `${kind}-${unpacked}`;
  if (!bombs.has(key)) {
    const plainBytes = Buffer.alloc(unpacked, 0x20);
    bombs.set(key, kind === "br"
      ? brotliCompressSync(plainBytes, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } })
      : gzipSync(plainBytes, { level: 9 }));
  }
  const packed = bombs.get(key);
  return ok(packed, { type: "text/html", headers: { "Content-Encoding": kind } });
}
