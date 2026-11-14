// The owner's preview (PLAN-V5 K15): one built site at a time, from memory, for the owner's
// own browser, on its own local address (127.0.0.1:3160), so it is another origin than the
// home screen, the gate, the relay and every door. Only the home server loads a site (POST
// /preview/load with an owner token of the viewer's secret, the same tar rules as the
// viewer's), from a file list it read itself with collectSite. Every answer carries the
// content policy that lets a page reach nothing but itself, and the other headers of
// sitefiles.mjs; no cookie is ever set. A Host other than this address is refused, so a
// name pointed at 127.0.0.1 by someone else's site cannot read the preview.
// Each load is served on an origin of its own (T57 F2): the next port, in turn, of nine
// (3161-3169, which no agent's fence lets it reach); the last load's port is closed, so an open
// tab of an earlier site reads nothing more, and nothing of it answers for a later one. GET of
// 127.0.0.1:3160 itself sends the browser on to the loaded site's port, so the address the
// home screen gives stays the same. The first page a load's port answers carries
// Clear-Site-Data, so nothing an earlier site on that port kept is still there; no worker can be
// registered at all (sitefiles.mjs). What remains: a tab of a site left open through nine more
// loads is the same origin as the ninth, and reads it while it is loaded (ADR 0015).
import http from "node:http";
import { appendFileSync } from "node:fs";
import { checkCaller, headerValues, readBody, wantsUpgrade } from "../doors/common.mjs";
import { SITE_HEADERS, SITE_LIMITS, siteHandler } from "./sitefiles.mjs";
import { readTar } from "./tar.mjs";

export const PREVIEW_CODES = Object.freeze({
  view_refused: [403, "The preview does not take this kind of request."],
  view_not_found: [404, "The preview has no such address."],
  view_no_token: [401, "Only the home screen can load a site into the preview."],
  view_bad_site: [400, "The site was not taken."],
  view_no_port: [503, "The preview could not open an address for the site. Close what uses 127.0.0.1:3161 to 3169."],
});

// A refusal as `refuse` sends it, with the site's headers too: every answer carries them.
function previewRefuse(res, status, code, sentence) {
  if (res.headersSent) return void res.destroy();
  const text = JSON.stringify({ error: { message: sentence }, code });
  res.writeHead(status, {
    ...SITE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), Connection: "close",
  });
  res.end(text);
}

// The ports a loaded site is served on, in turn: the nine after the preview's own (3161-3169).
export const SITE_PORT_COUNT = 9;

export function createPreview({ listenPort, paths, log, sitePorts } = {}) {
  const p = paths || {};
  const secret = typeof p.viewerSecret === "string" && p.viewerSecret ? p.viewerSecret : p.secret;
  const ids = typeof p.ids === "string" && p.ids ? p.ids : null;
  if (!secret) throw new Error("createPreview: paths.viewerSecret is needed");
  // listenPort 0 (tests): each load gets a free port of the system's.
  const turns = Array.isArray(sitePorts) && sitePorts.length ? [...sitePorts]
    : listenPort > 0 ? Array.from({ length: SITE_PORT_COUNT }, (_, i) => listenPort + 1 + i) : [0];
  const say = (line) => {
    try {
      if (typeof log === "function") log(line);
      else if (typeof log === "string" && log) appendFileSync(log, `${line}\n`);
    } catch {
      // A log failure changes nothing.
    }
  };
  const iso = () => new Date().toISOString();
  let site = null; // { files: Map name -> Buffer, server, port, fresh }, or null
  let turn = 0;
  let port = null;
  let loading = Promise.resolve();

  function no(res, code, detail, status) {
    say(`${iso()} preview refused ${code}`);
    const [st, sentence] = PREVIEW_CODES[code];
    return previewRefuse(res, status || st, code, detail ? `${sentence} ${detail}` : sentence);
  }
  const owner = (req) => {
    const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath: secret, idsPath: ids, agents: [], now: Date.now() });
    return typeof who === "object" && who !== null && who.kind === "t";
  };
  const hostIs = (req, at) => {
    const hosts = headerValues(req.rawHeaders, "host");
    return hosts.length === 1 && (hosts[0] === `127.0.0.1:${at}` || hosts[0] === `localhost:${at}`);
  };
  const answer = (res, status, body, extra = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { ...SITE_HEADERS, ...extra, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), Connection: "close" });
    res.end(text);
  };

  // One load's own listener: its files only, GET and HEAD, its own Host only.
  function siteServer(held) {
    const serve = siteHandler(() => held.files);
    const server = http.createServer((req, res) => {
      req.on("error", () => {});
      if (wantsUpgrade(req.rawHeaders) || !hostIs(req, held.port)) return void no(res, "view_refused");
      if (req.method !== "GET" && req.method !== "HEAD") return void no(res, "view_refused");
      // The first page this port shows for the load clears what an earlier site on it kept.
      if (held.fresh && headerValues(req.rawHeaders, "sec-fetch-mode").includes("navigate")) {
        held.fresh = false;
        res.setHeader("Clear-Site-Data", "\"storage\"");
      }
      return void serve(req, res);
    });
    guard(server);
    return server;
  }
  const listenOn = (server, at) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(at, "127.0.0.1", () => { server.off("error", reject); resolve(server.address().port); });
  });
  const shut = (server) => new Promise((resolve) => {
    if (!server.listening) return void resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
  // The files on the next free port in turn; the last load's port is closed. -> true, or false when none is free.
  async function put(files) {
    const held = { files, server: null, port: null, fresh: true };
    for (let i = 0; i < turns.length; i++) {
      const at = turns[(turn + i) % turns.length];
      const server = siteServer(held);
      try {
        held.port = await listenOn(server, at);
        held.server = server;
        turn = (turn + i + 1) % turns.length;
        break;
      } catch {
        // That port is taken: the next one.
      }
    }
    if (!held.server) return false;
    const last = site;
    site = held;
    if (last) await shut(last.server);
    return true;
  }
  async function drop() {
    const last = site;
    site = null;
    if (last) await shut(last.server);
  }

  async function onRequest(req, res) {
    if (wantsUpgrade(req.rawHeaders)) return no(res, "view_refused");
    if (!hostIs(req, port)) return no(res, "view_refused");
    const target = typeof req.url === "string" ? req.url : "";
    if (req.method === "POST") {
      if (target !== "/preview/load" && target !== "/preview/clear") return no(res, "view_not_found");
      if (!owner(req)) return no(res, "view_no_token");
      if (target === "/preview/clear") {
        await (loading = loading.then(drop, drop));
        say(`${iso()} preview cleared`);
        return void answer(res, 200, { loaded: false });
      }
      const types = headerValues(req.rawHeaders, "content-type");
      if (types.length !== 1 || String(types[0]).split(";")[0].trim().toLowerCase() !== "application/x-tar") {
        return no(res, "view_bad_site", "Send it with Content-Type: application/x-tar.");
      }
      const raw = await readBody(req, SITE_LIMITS.sentBytes);
      if (raw === null) return undefined;
      if (raw === "too-big") return no(res, "view_bad_site", "The archive is over 20 MB.", 413);
      const tar = readTar(raw);
      if (!tar.ok) return no(res, "view_bad_site", `${tar.reason.charAt(0).toUpperCase()}${tar.reason.slice(1)}.`);
      const files = new Map(tar.entries.filter((e) => e.type === "file").map((e) => [e.name, Buffer.from(e.data)]));
      const step = () => put(files);
      const placed = await (loading = loading.then(step, step));
      if (!placed) return no(res, "view_no_port");
      say(`${iso()} preview loaded files=${files.size} bytes=${tar.bytes}`);
      return void answer(res, 200, { loaded: true, files: files.size, bytes: tar.bytes, url: `http://127.0.0.1:${port}/` });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return no(res, "view_refused");
    if (site === null) {
      const text = "Nothing to preview. Open it again from the home screen.";
      res.writeHead(404, { ...SITE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
      return void res.end(req.method === "HEAD" ? undefined : text);
    }
    // On to the loaded site's own origin. Nothing is ever served here, so nothing can run at this address;
    // Clear-Site-Data takes away what a site served here before T57 F2 left (a worker, storage).
    const text = "The preview is at its own address.";
    res.writeHead(302, {
      ...SITE_HEADERS, Location: `http://127.0.0.1:${site.port}/`, "Clear-Site-Data": "\"storage\"",
      "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(text),
    });
    return void res.end(req.method === "HEAD" ? undefined : text);
  }

  const onRaw = (_req, socket) => {
    say(`${iso()} preview refused view_refused`);
    socket.on("error", () => {});
    if (!socket.writable) return void socket.destroy();
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  };
  function guard(server) {
    server.headersTimeout = 10_000;
    server.requestTimeout = 60_000;
    server.on("upgrade", onRaw);
    server.on("connect", onRaw);
  }
  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    onRequest(req, res).catch(() => { if (!res.headersSent) no(res, "view_bad_site"); else res.destroy(); });
  });
  guard(server);

  return {
    server,
    get port() { return port; },
    get sitePort() { return site ? site.port : null; },
    get loaded() { return site !== null; },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", () => {
          server.off("error", reject);
          port = server.address().port;
          resolve(port);
        });
      });
    },
    async close() {
      await (loading = loading.then(drop, drop));
      await shut(server);
    },
  };
}
