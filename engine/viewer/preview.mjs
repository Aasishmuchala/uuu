// The owner's preview (PLAN-V5 K15): one built site at a time, from memory, for the owner's
// own browser, on its own local address (127.0.0.1:3160), so it is another origin than the
// home screen, the gate, the relay and every door. Only the home server loads a site (POST
// /preview/load with an owner token of the viewer's secret, the same tar rules as the
// viewer's), from a file list it read itself with collectSite. Every answer carries the
// content policy that lets a page reach nothing but itself, and the other headers of
// sitefiles.mjs; no cookie is ever set. A Host other than this address is refused, so a
// name pointed at 127.0.0.1 by someone else's site cannot read the preview.
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

export function createPreview({ listenPort, paths, log } = {}) {
  const p = paths || {};
  const secret = typeof p.viewerSecret === "string" && p.viewerSecret ? p.viewerSecret : p.secret;
  const ids = typeof p.ids === "string" && p.ids ? p.ids : null;
  if (!secret) throw new Error("createPreview: paths.viewerSecret is needed");
  const say = (line) => {
    try {
      if (typeof log === "function") log(line);
      else if (typeof log === "string" && log) appendFileSync(log, `${line}\n`);
    } catch {
      // A log failure changes nothing.
    }
  };
  const iso = () => new Date().toISOString();
  let site = null; // Map name -> Buffer, or null
  const serve = siteHandler(() => site);
  let port = null;

  function no(res, code, detail, status) {
    say(`${iso()} preview refused ${code}`);
    const [st, sentence] = PREVIEW_CODES[code];
    return previewRefuse(res, status || st, code, detail ? `${sentence} ${detail}` : sentence);
  }
  const owner = (req) => {
    const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath: secret, idsPath: ids, agents: [], now: Date.now() });
    return typeof who === "object" && who !== null && who.kind === "t";
  };

  async function onRequest(req, res) {
    if (wantsUpgrade(req.rawHeaders)) return no(res, "view_refused");
    const hosts = headerValues(req.rawHeaders, "host");
    if (hosts.length !== 1 || (hosts[0] !== `127.0.0.1:${port}` && hosts[0] !== `localhost:${port}`)) return no(res, "view_refused");
    const target = typeof req.url === "string" ? req.url : "";
    if (req.method === "POST") {
      if (target !== "/preview/load" && target !== "/preview/clear") return no(res, "view_not_found");
      if (!owner(req)) return no(res, "view_no_token");
      if (target === "/preview/clear") {
        site = null;
        say(`${iso()} preview cleared`);
        const text = JSON.stringify({ loaded: false });
        res.writeHead(200, { ...SITE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), Connection: "close" });
        return void res.end(text);
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
      site = new Map(tar.entries.filter((e) => e.type === "file").map((e) => [e.name, Buffer.from(e.data)]));
      say(`${iso()} preview loaded files=${site.size} bytes=${tar.bytes}`);
      const text = JSON.stringify({ loaded: true, files: site.size, bytes: tar.bytes, url: `http://127.0.0.1:${port}/` });
      res.writeHead(200, { ...SITE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), Connection: "close" });
      return void res.end(text);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return no(res, "view_refused");
    if (site === null) {
      const text = "Nothing to preview. Open it again from the home screen.";
      res.writeHead(404, { ...SITE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
      return void res.end(req.method === "HEAD" ? undefined : text);
    }
    return serve(req, res);
  }

  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    onRequest(req, res).catch(() => { if (!res.headersSent) no(res, "view_bad_site"); else res.destroy(); });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  const onRaw = (_req, socket) => {
    say(`${iso()} preview refused view_refused`);
    socket.on("error", () => {});
    if (!socket.writable) return void socket.destroy();
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  };
  server.on("upgrade", onRaw);
  server.on("connect", onRaw);

  return {
    server,
    get port() { return port; },
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
    close() {
      site = null;
      return new Promise((resolve) => {
        if (!server.listening) return void resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
