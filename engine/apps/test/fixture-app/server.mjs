// The fixture app of the App Studio host's tests (engine/apps/test/host-*.test.mjs). It listens
// only on APP_SOCKET, as every app must, and does what a real app and a hostile one might: echoes
// what reached it, sets a cookie and a content policy of its own, calls its engine socket, starts
// helpers, takes its time, exits. Its mode (FIXTURE_MODE, or `mode` in $APP_DATA/fixture.json,
// which a fenced run can read) changes how it starts: exit, silent, link (APP_SOCKET a link to
// FIXTURE_TARGET), late.
import http from "node:http";
import { spawn } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, renameSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

let opts = {};
try { opts = JSON.parse(readFileSync(join(process.env.APP_DATA || "/nonexistent", "fixture.json"), "utf8")); } catch { /* none */ }
const mode = process.env.FIXTURE_MODE || opts.mode || "";
const target = process.env.FIXTURE_TARGET || opts.target || "";
console.log(`fixture ${mode || "plain"} starting`);
if (mode === "exit") process.exit(3);
if (mode === "silent" || mode === "link") setInterval(() => {}, 60_000);
if (mode === "link") symlinkSync(target, process.env.APP_SOCKET);

const json = (res, value, headers = {}) => { res.writeHead(200, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(value)); };
const read = (req) => new Promise((ok) => {
  let n = 0;
  const parts = [];
  req.on("data", (c) => { n += c.length; if (n < 65536) parts.push(c); });
  req.on("end", () => ok({ n, text: Buffer.concat(parts).toString() }));
  req.on("close", () => { if (!req.complete) console.log(`fixture cut after ${n} bytes`); });
});

function engine({ method, path, body, type }) {
  return new Promise((ok) => {
    const headers = { accept: "application/json", cookie: "c=1", authorization: "Bearer stolen", "x-evil": "1" };
    if (body !== undefined) headers["content-type"] = type || "application/json";
    const req = http.request({ socketPath: process.env.ENGINE_SOCKET, method, path, headers, agent: false }, (res) => {
      read(res).then(({ text }) => ok({ status: res.statusCode, headers: res.rawHeaders, body: text }));
    });
    req.on("error", (e) => ok({ status: 0, error: e.code }));
    req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname !== "/healthz") console.log(`fixture saw ${req.method} ${req.url}`);
  if (url.pathname === "/healthz") return void res.end("ok");
  if (url.pathname === "/slow") return void setTimeout(() => res.end("slow"), Number(url.searchParams.get("ms") || 3000));
  if (url.pathname === "/exit") { res.end("bye"); return void setTimeout(() => process.exit(1), 30); }
  if (url.pathname === "/env") return json(res, { pid: process.pid, ...Object.fromEntries(["APP_SOCKET", "ENGINE_SOCKET", "APP_DATA", "FFMPEG", "FFPROBE", "NODE_ENV"].map((k) => [k, process.env[k] ?? null])) });
  // What a hostile app would try on its own run folder, and the name the host took its socket from.
  const tried = (f) => { try { f(); return "ok"; } catch (e) { return e.code || "error"; } };
  const run = dirname(process.env.APP_SOCKET || "/nonexistent/x");
  if (url.pathname === "/plant") return json(res, { plant: tried(() => symlinkSync(target, process.env.APP_SOCKET)) });
  if (url.pathname === "/attack") {
    return json(res, {
      renameRun: tried(() => renameSync(run, join(process.env.APP_DATA, "stash"))),
      rmdirRun: tried(() => { for (const n of ["engine.sock", "app.sock"]) tried(() => unlinkSync(join(run, n))); rmdirSync(run); }),
      linkOverRun: tried(() => symlinkSync(dirname(target), run)),
      folderOverRun: tried(() => { mkdirSync(join(process.env.APP_DATA, "e"), { recursive: true }); renameSync(join(process.env.APP_DATA, "e"), run); }),
      hardLink: tried(() => linkSync(target, join(run, "hard.sock"))),
    });
  }
  if (url.pathname === "/x") return json(res, await engine(JSON.parse((await read(req)).text)));
  if (url.pathname === "/deaf") {
    const deaf = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
    return json(res, { deaf: deaf.pid });
  }
  if (url.pathname === "/child") {
    const kid = spawn("/bin/sleep", ["300"], { stdio: "ignore" });
    const away = spawn("/bin/sleep", ["301"], { stdio: "ignore", detached: true });
    return json(res, { kid: kid.pid, away: away.pid });
  }
  const { n } = await read(req);
  json(res, { method: req.method, url: req.url, headers: req.rawHeaders, bytes: n }, {
    "Set-Cookie": "sid=planted; Path=/", "Content-Security-Policy": "default-src *", "X-Content-Type-Options": "sniff",
    Connection: "X-Hop", "X-Hop": "1", "Keep-Alive": "timeout=99", "X-Kept": "yes",
  });
});
const go = () => { try { unlinkSync(process.env.APP_SOCKET); } catch { /* none */ } server.listen(process.env.APP_SOCKET, () => console.log("fixture listening")); };
if (mode !== "silent" && mode !== "link") setTimeout(go, mode === "late" ? 800 : 0);
