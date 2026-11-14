// The page viewer (PLAN-V5 K15) against a stand-in Chrome: every row of the table, the one
// render at a time, the time limit, the answer's tar, and that nothing is left behind. The
// stand-in is a real process group (/bin/sleep) with an in-process debugging pipe that
// fetches each page through the viewer's own proxy, as Chrome would. Made-up secrets and ids
// in a temp state folder; every socket is on 127.0.0.1.
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { mintToken } from "../../relay/token.mjs";
import { readPs } from "../chrome.mjs";
import { SITE_POLICY } from "../sitefiles.mjs";
import { writeTar } from "../tar.mjs";
import { CODES, SPENT_ADDRESS, createViewer, parseTarget } from "../viewer.mjs";

const VIEW_SECRET = "5".repeat(64);
const WEB_SECRET = "6".repeat(64);
const BUILDER = "11111111-2222-4333-8444-555555555555";
const ART = "22222222-2222-4333-8444-555555555555";
const RESEARCHER = "33333333-2222-4333-8444-555555555555";
const MB = 1024 * 1024;

let dir; let paths; let lines; let viewer; let port; let behaviour; let seen;
const groups = new Set();

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const agent = (id = BUILDER, secret = VIEW_SECRET) => mintToken(secret, "a", id, exp());
const owner = () => mintToken(VIEW_SECRET, "t", "owner", exp());
const put = (p, text, mode = 0o600) => { rmSync(p, { force: true }); writeFileSync(p, text); chmodSync(p, mode); };
const setViewer = (on) => put(paths.doorsState, JSON.stringify({ version: 1, viewer: { on } }));
const workLeft = () => { try { return readdirSync(join(paths.doorWork, "view")); } catch { return []; } };

// A tiny PNG of the right width (the viewer checks the signature only).
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

// The stand-in Chrome. behaviour: { hasDark, hang, report }.
function launch(program, args) {
  const child = spawn("/bin/sleep", ["120"], { detached: true, stdio: "ignore" });
  groups.add(child.pid);
  const proxyPort = Number(/--proxy-server=http:\/\/127\.0\.0\.1:(\d+)/.exec(args.join(" "))[1]);
  seen.args = args;
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  child.on("exit", () => fromChrome.end());
  const emit = (m) => { if (!fromChrome.writableEnded) fromChrome.write(`${JSON.stringify(m)}\0`); };
  let width = 0;
  let n = 0;
  let buf = "";
  toChrome.on("data", async (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const ok = (result = {}) => emit({ id: m.id, sessionId: m.sessionId, result });
      seen.methods.push(m.method);
      switch (m.method) {
        case "Browser.getVersion": ok({ product: "Chrome/0.0 stand-in" }); break;
        case "Target.createTarget": {
          n += 1;
          ok({ targetId: `T${n}` });
          emit({ method: "Target.attachedToTarget", params: { sessionId: `S${n}`, targetInfo: { type: "page", targetId: `T${n}`, url: "about:blank" } } });
          break;
        }
        case "Emulation.setDeviceMetricsOverride": width = m.params.width; seen.widths.push([m.params.width, m.params.mobile]); ok(); break;
        case "Page.navigate": {
          ok({ frameId: "F" });
          const url = m.params.url;
          // An address of another program is never fetched: Chrome hands it to the Mac (T57 F3).
          if (!/^https?:/.test(url)) { seen.spent.push(url); break; }
          if (behaviour.hang) break;
          // fetched through the viewer's proxy, as Chrome is made to
          const r = await new Promise((resolve) => {
            http.get({ host: "127.0.0.1", port: proxyPort, path: url, agent: false }, (res) => { res.resume(); res.on("end", () => resolve(res)); })
              .on("error", () => resolve(null));
          });
          seen.pages.push({ url, status: r && r.statusCode, csp: r && r.headers["content-security-policy"], type: r && r.headers["content-type"] });
          emit({ method: "Runtime.consoleAPICalled", sessionId: m.sessionId, params: { type: "error", args: [{ value: `planted error at ${url}` }] } });
          emit({ method: "Page.loadEventFired", sessionId: m.sessionId, params: {} });
          break;
        }
        case "Page.getFrameTree": ok({ frameTree: { frame: { id: "F", url: seen.pages.at(-1) ? seen.pages.at(-1).url : "about:blank" } } }); break;
        case "Page.createIsolatedWorld": ok({ executionContextId: 9 }); break;
        case "Runtime.evaluate":
          if (/document\.fonts/.test(m.params.expression)) ok({ result: { value: true } });
          else ok({ result: { value: { hasDark: behaviour.hasDark === true, height: 1200, wider: [{ tag: "div", cls: "x\u0000y", width: 1500 }], missing: [], a11y: { noAlt: 1, noLabel: 0, noLang: false, noTitle: false, headingSkips: 0, smallTargets: 2 }, contrast: [{ text: "faint", fg: "#A9A9A9", bg: "#BBBBBB", ratio: 1.22 }], fonts: [{ family: "Georgia", minPx: 12 }], colours: ["#1E2A33", "not a colour"], ...(behaviour.report || {}) } } });
          break;
        case "DOM.getDocument": ok({ root: { nodeId: 1 } }); break;
        case "DOM.querySelectorAll": ok({ nodeIds: [2] }); break;
        case "CSS.getPlatformFontsForNode": ok({ fonts: [{ familyName: "Georgia" }] }); break;
        case "Page.captureScreenshot": ok({ data: png(width, m.params.clip.height).toString("base64") }); break;
        case "Browser.close": ok(); try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } break;
        default: ok();
      }
    }
  });
  return { child, toChrome, fromChrome };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "viewer-door-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  mkdirSync(join(dir, "secrets"), { mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "secrets", "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  put(paths.viewerSecret, `${VIEW_SECRET}\n`);
  put(paths.ids, JSON.stringify({ agents: { builder: BUILDER, "art-director": ART, researcher: RESEARCHER } }), 0o644);
  lines = [];
  viewer = createViewer({
    listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder", "art-director"] } } }, log: (l) => lines.push(l),
    chrome: { path: "/bin/sleep", launch }, limits: { pageMs: 3000 },
  });
  port = await viewer.listen();
});
beforeEach(() => { behaviour = {}; seen = { methods: [], widths: [], pages: [], args: [], spent: [] }; setViewer(true); });
after(async () => {
  await viewer.close();
  for (const g of groups) { try { process.kill(-g, "SIGKILL"); } catch { /* gone */ } }
  rmSync(dir, { recursive: true, force: true });
});

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString("utf8")); } catch { /* a tar */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const site = (extra = []) => writeTar([{ name: "index.html", data: Buffer.from("<!doctype html><title>t</title><h1>Hi</h1>") },
  { name: "about.html", data: Buffer.from("<p>about</p>") }, ...extra]);
const shots = (body = site(), { token = agent(), query = "", type = "application/x-tar" } = {}) => request("POST", `/view/shots${query}`, {
  headers: { Authorization: `Bearer ${token}`, ...(type ? { "Content-Type": type } : {}) }, body,
});
// The files of the viewer's own answer.
function untar(buf) {
  const out = {};
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.subarray(off, off + 100).toString("latin1").replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(buf.subarray(off + 124, off + 136).toString("latin1"), 8);
    out[name] = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
const raw = (text) => new Promise((resolve) => {
  const sock = net.connect(port, "127.0.0.1");
  let got = "";
  const timer = setTimeout(() => { sock.destroy(); resolve(got); }, 1500);
  sock.on("data", (c) => { got += c; });
  sock.on("close", () => { clearTimeout(timer); resolve(got); });
  sock.on("error", () => {});
  sock.write(text);
});
const code = (r) => r.json && r.json.code;

test("parseTarget: /view/shots with nothing, or pages= of at most 3 plain .html names", () => {
  assert.deepEqual(parseTarget("/view/shots"), { pages: ["index.html"] });
  assert.deepEqual(parseTarget("/view/shots?pages=index.html,a/b.html"), { pages: ["index.html", "a/b.html"] });
  for (const q of ["?pages=a.html,b.html,c.html,d.html", "?pages=../x.html", "?pages=a.css", "?pages=a.html,a.html", "?pages=a_b.html,a/b.html",
    "?pages=%2e%2e.html", "?x=1", "?pages=a.html&x=1", "?", "?pages="]) assert.equal(parseTarget(`/view/shots${q}`), "refused", q);
  for (const p of ["/view/shot", "/view/shots/", "/VIEW/SHOTS", "/view/health"]) assert.equal(parseTarget(p), null, p);
});

test("row 2: health says only whether it is on and whether Chrome is there", async () => {
  setViewer(false);
  const r = await request("GET", "/view/health");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ["status", "part", "on", "chrome", "version"]);
  assert.deepEqual({ ...r.json, version: undefined }, { status: "ok", part: "viewer", on: false, chrome: true, version: undefined });
  setViewer(true);
  assert.equal((await request("GET", "/view/health")).json.on, true);
});

test("row 1: upgrades and CONNECT are refused; unknown paths 404; any query but pages= 403", async () => {
  assert.match(await raw("CONNECT 127.0.0.1:3110 HTTP/1.1\r\nHost: 127.0.0.1:3110\r\n\r\n"), /^HTTP\/1\.1 403[\s\S]*view_refused/);
  assert.match(await raw(`GET /view/health HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`), /^HTTP\/1\.1 403[\s\S]*view_refused/);
  for (const [m, p] of [["GET", "/"], ["GET", "/view/shots"], ["POST", "/view/shot"], ["POST", "/web/fetch"], ["PUT", "/view/shots"], ["POST", "/view/health"]]) {
    const r = await request(m, p, { headers: { Authorization: `Bearer ${agent()}` } });
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.equal(code(r), "view_not_found");
  }
  for (const q of ["?x=1", "?pages=a.html,b.html,c.html,index.html", "?pages=../../etc/passwd.html"]) {
    const r = await shots(site(), { query: q });
    assert.equal(r.status, 403, q);
    assert.equal(code(r), "view_refused");
  }
});

test("row 3: no token, a bad one, another door's, an agent not listed; the switch off or unreadable", async () => {
  const cases = [
    [{}, "none"], [{ Authorization: "Bearer nope" }, "bad"], [{ Authorization: `Bearer ${agent(BUILDER, WEB_SECRET)}` }, "another door's secret"],
    [{ Authorization: `Bearer ${agent(RESEARCHER)}` }, "not listed"]
  ];
  for (const [headers, why] of cases) {
    const r = await request("POST", "/view/shots", { headers: { ...headers, "Content-Type": "application/x-tar" }, body: site() });
    assert.equal(r.status, 401, why);
    assert.equal(code(r), "view_no_token", why);
  }
  const two = await raw(`POST /view/shots HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${agent()}\r\nAuthorization: Bearer ${agent()}\r\nContent-Type: application/x-tar\r\nContent-Length: 0\r\n\r\n`);
  assert.match(two, /^HTTP\/1\.1 401[\s\S]*view_no_token/, "two tokens");
  setViewer(false);
  assert.equal(code(await shots()), "view_off");
  put(paths.doorsState, "{not json");
  assert.equal(code(await shots()), "view_off");
  put(paths.doorsState, JSON.stringify({ viewer: { on: true } }), 0o666);
  assert.equal(code(await shots()), "view_off", "an untrusted state file");
  rmSync(paths.doorsState);
  assert.equal(code(await shots()), "view_off", "no state file: off");
  const asOwner = await shots(site(), { token: owner() });
  assert.equal(asOwner.status, 200, "the owner's token passes with the switch off");
  assert.equal(code(await shots(site(), { token: agent(ART) })), "view_off");
});

test("row 4: bad archives are view_bad_site and leave nothing on disk", async () => {
  const link = (() => {
    const t = writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "hosts.txt", data: Buffer.alloc(0) }]);
    const h = t.subarray(512 + 512); // the second header
    h[156] = "2".charCodeAt(0);
    Buffer.from("/etc/hosts").copy(h, 157);
    h.fill(0x20, 148, 156);
    let sum = 0; for (let i = 0; i < 512; i++) sum += h[i];
    Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `).copy(h, 148);
    return t;
  })();
  const bad = [
    ["../x", writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "../x.html", data: Buffer.from("x") }])],
    ["an absolute name", writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "/tmp/x.html", data: Buffer.from("x") }])],
    ["a link", link],
    ["a name with a space", writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "my page.html", data: Buffer.from("x") }])],
    ["a .php file", writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "x.php", data: Buffer.from("x") }])],
    ["an 11 MB file", writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "big.png", data: Buffer.alloc(11 * MB) }])],
    ["no index.html", writeTar([{ name: "about.html", data: Buffer.from("x") }])],
    ["301 entries", writeTar(Array.from({ length: 301 }, (_, i) => ({ name: i ? `f${i}.txt` : "index.html", data: Buffer.from("x") })))],
    ["a gzip bomb", gzipSync(Buffer.alloc(100 * MB))],
    ["not a tar", Buffer.from("hello")],
    // T57 F5: two folders that differ only in letter case are one folder on this disk.
    ["folders differing in case", writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "A/x.html", data: Buffer.from("x") }, { name: "a/y.html", data: Buffer.from("x") }])],
  ].filter(([, b]) => b);
  for (const [why, body] of bad) {
    const r = await shots(body);
    assert.equal(r.status, 400, why);
    assert.equal(code(r), "view_bad_site", why);
    assert.deepEqual(workLeft(), [], why);
  }
  assert.equal(code(await shots(site(), { type: "application/json" })), "view_bad_site");
  assert.equal(code(await shots(site(), { type: null })), "view_bad_site");
  const big = await shots(Buffer.alloc(20 * MB + 1));
  assert.equal(big.status, 413);
  assert.equal(code(big), "view_bad_site");
  const clash = await shots(writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "Img/a.png", data: Buffer.from("x") }, { name: "img/b.png", data: Buffer.from("x") }]));
  assert.match(clash.json.error.message, /differ only in letter case/);
  const notThere = await shots(site(), { query: "?pages=index.html,gone.html" });
  assert.equal(notThere.status, 400);
  assert.equal(seen.methods.length, 0, "Chrome was never started for a refused archive");
});

test("a render: shots at both true widths, light only when the CSS asks for nothing more, and the report", async () => {
  const r = await shots(gzipSync(site()), { query: "?pages=index.html,about.html" });
  assert.equal(r.status, 200, r.raw.toString().slice(0, 200));
  assert.equal(r.headers["content-type"], "application/x-tar");
  const files = untar(r.raw);
  assert.deepEqual(Object.keys(files).sort(), ["report.json", "shot-about-1280-light.png", "shot-about-390-light.png", "shot-index-1280-light.png", "shot-index-390-light.png"]);
  assert.equal(files["shot-index-390-light.png"].readUInt32BE(16), 390);
  assert.deepEqual(seen.widths, [[1280, false], [390, false], [1280, false], [390, false]], "mobile: false for true widths");
  const report = JSON.parse(files["report.json"]);
  assert.equal(report.version, 1);
  assert.equal(report.pages.length, 2);
  const p = report.pages[0];
  assert.equal(p.page, "index.html");
  for (const k of ["errors", "wider", "missing", "blocked", "a11y", "contrast", "fonts", "colours"]) assert.ok(k in p, k);
  assert.deepEqual(p.wider[0], { tag: "div", cls: "x y", width: 1500, at: 1280 }, "page text is made plain");
  assert.deepEqual(p.colours, ["#1E2A33"], "only real colours");
  assert.ok(p.errors.some((e) => /planted error at \/index\.html/.test(e)), "the site's address is taken out of errors");
  assert.equal(p.dark, false);
  // every page went through the proxy and came with the content policy and a fixed type
  assert.equal(seen.pages.length, 4);
  assert.deepEqual(seen.spent, [SPENT_ADDRESS], "Chrome's one address of another program is used up first, on nothing");
  for (const s of seen.pages) {
    assert.equal(s.status, 200);
    assert.equal(s.csp, SITE_POLICY);
    assert.equal(s.type, "text/html; charset=utf-8");
  }
  assert.ok(seen.methods.includes("Fetch.enable") && seen.methods.includes("Browser.setDownloadBehavior") && seen.methods.includes("Page.createIsolatedWorld"));
  assert.deepEqual(workLeft(), []);
  assert.equal((await readPs()).some((x) => groups.has(x.pgid)), false, "the stand-in's group is ended");
});

test("dark shots only when the site's CSS holds prefers-color-scheme", async () => {
  behaviour = { hasDark: true };
  const files = untar((await shots()).raw);
  assert.deepEqual(Object.keys(files).filter((n) => n.endsWith(".png")).sort(),
    ["shot-index-1280-dark.png", "shot-index-1280-light.png", "shot-index-390-dark.png", "shot-index-390-light.png"]);
  assert.equal(JSON.parse(files["report.json"]).pages[0].dark, true);
});

test("row 5: one render at a time; a page that never loads is cut at its time and the next render works", async () => {
  behaviour = { hang: true };
  const t0 = Date.now();
  const first = shots();
  await new Promise((r) => setTimeout(r, 300));
  const second = await shots();
  assert.equal(second.status, 403);
  assert.equal(code(second), "view_busy");
  assert.equal(second.json.retryAfterSec, 30);
  const r = await first;
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 9000, "cut at the page's time");
  const page = JSON.parse(untar(r.raw)["report.json"]).pages[0];
  assert.equal(page.cut, "time");
  assert.deepEqual(page.shots, []);
  assert.ok(page.errors.some((e) => /did not finish/.test(e)));
  behaviour = {};
  assert.equal((await shots()).status, 200);
  assert.deepEqual(workLeft(), []);
});

test("row 5: Chrome missing", async () => {
  const v = createViewer({ listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, chrome: { path: "/nope/Google Chrome", launch } });
  const p = await v.listen();
  try {
    const r = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: p, method: "POST", path: "/view/shots", agent: false,
        headers: { Authorization: `Bearer ${agent()}`, "Content-Type": "application/x-tar" } }, (res) => {
        let t = ""; res.on("data", (c) => { t += c; }); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t) }));
      });
      req.end(site());
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "view_no_chrome");
    assert.equal(r.json.error.message, CODES.view_no_chrome[1]);
  } finally {
    await v.close();
  }
});

test("close() during a render ends its Chrome and removes its folder", async () => {
  behaviour = { hang: true };
  const v = createViewer({ listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, chrome: { path: "/bin/sleep", launch }, limits: { pageMs: 20_000 } });
  const p = await v.listen();
  const req = http.request({ host: "127.0.0.1", port: p, method: "POST", path: "/view/shots", agent: false,
    headers: { Authorization: `Bearer ${agent()}`, "Content-Type": "application/x-tar" } });
  req.on("error", () => {});
  req.end(site());
  for (let i = 0; i < 40 && !seen.methods.includes("Page.navigate"); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(workLeft().length, 1);
  const t0 = Date.now();
  await v.close();
  assert.ok(Date.now() - t0 < 8000);
  assert.deepEqual(workLeft(), []);
  assert.equal((await readPs()).some((x) => groups.has(x.pgid)), false);
});

test("log lines hold no token, no file name and no page text; the status file is written", async () => {
  const text = lines.join("\n");
  assert.equal(/v1\.[at]\./.test(text), false);
  assert.equal(/index\.html|about|planted|Georgia/.test(text), false);
  assert.match(text, /shots builder pages=2 shots=4/);
  assert.match(text, /refused view_bad_site/);
  assert.equal(existsSync(paths.viewerStatus), true);
});
