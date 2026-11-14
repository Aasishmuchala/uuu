// The viewer's REAL Chrome and a page that asks the Mac to open another program (T57 F3): `mailto:` is one of the
// few addresses Chrome hands on without asking, and it never becomes a request, so neither the proxy nor the
// request interception sees it. The viewer uses up Chrome's one such address per start on an address no program
// answers to, before any page runs. PASS = Chrome never asks the Mac to open another program.
// Nothing can open on the owner's screen: Chrome runs here under an outer rule that refuses and logs every such
// launch (sandbox-exec, deny lsopen), and the kernel's log says whether Chrome tried. Only for this probe, Chrome's
// own sandbox is off (it cannot start inside any outer rule on this Mac); the viewer's own start never turns it off.
// Skipped, saying why, when Chrome or sandbox-exec is not there. Only processes this file started are ended, by
// their group id.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { CHROME_PATH, chromeInstalled, groupOf, readPs } from "../chrome.mjs";
import { writeTar } from "../tar.mjs";
import { createViewer } from "../viewer.mjs";

const SECRET = "3".repeat(64);
const skip = !chromeInstalled(CHROME_PATH) ? `Chrome is not installed at ${CHROME_PATH}`
  : !existsSync("/usr/bin/sandbox-exec") ? "sandbox-exec is not on this Mac" : false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let dir; let paths;
const groups = [];
const pidsSeen = new Set();

before(() => {
  dir = mkdtempSync(join(tmpdir(), "viewer-other-program-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
  chmodSync(paths.ids, 0o644);
});
after(() => {
  for (const g of groups) { try { process.kill(-g, "SIGKILL"); } catch { /* ended already */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// The viewer's own start, under the probe's outer rule. Every process of the group is noted, to match the log.
function probeLaunch(program, args, env) {
  const child = spawn("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny lsopen)", program, "--no-sandbox", ...args],
    { detached: true, env, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  child.stderr.on("error", () => {});
  groups.push(child.pid);
  const watch = setInterval(async () => { const rows = await readPs(); if (rows) for (const r of groupOf(rows, child.pid).members) pidsSeen.add(r.pid); }, 200);
  child.on("exit", () => clearInterval(watch));
  return { child, toChrome: child.stdio[3], fromChrome: child.stdio[4] };
}

async function render(page) {
  const v = createViewer({ listenPort: 0, paths, config: { doors: { viewer: { agents: [] } } }, log: () => {}, chrome: { path: CHROME_PATH, launch: probeLaunch } });
  const port = await v.listen();
  const body = writeTar([
    { name: "index.html", data: Buffer.from("<!doctype html><title>plain</title><h1>Nothing asked</h1>") },
    { name: "mail.html", data: Buffer.from(`<!doctype html><title>mail</title><h1>Another program</h1><script>
      setTimeout(() => { location.href = "mailto:viewer-canary@example.invalid?subject=canary"; }, 300);
      setTimeout(() => { location.href = "mailto:viewer-canary-2@example.invalid"; }, 900);
    </script>`) },
  ]);
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: `/view/shots?pages=${page}`, agent: false,
        headers: { Authorization: `Bearer ${mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600)}`, "Content-Type": "application/x-tar" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end(body);
    });
  } finally {
    await v.close();
  }
}

const stamp = () => {
  const d = new Date(Date.now() - 2000);
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
};
// The launches the outer rule refused since `since`, by process id.
function refusedLaunches(since) {
  let out = "";
  try {
    out = execFileSync("/usr/bin/log", ["show", "--start", since, "--style", "compact", "--predicate", 'eventMessage CONTAINS "deny(1) lsopen"'], { encoding: "utf8", timeout: 90000 });
  } catch (e) { out = String(e.stdout || ""); }
  return out.split("\n").map((l) => /Sandbox: (.+?)\((\d+)\) deny\(1\) lsopen/.exec(l)).filter(Boolean).map((m) => Number(m[2]));
}

test("a page's mailto: never makes the viewer's Chrome ask the Mac for another program", { skip, timeout: 240000 }, async () => {
  const since = stamp();
  assert.equal(await render("mail.html"), 200);
  await wait(2500);
  const tried = refusedLaunches(since).filter((pid) => pidsSeen.has(pid));
  assert.deepEqual(tried, [], "Chrome asked the Mac to open another program (refused here only by the probe's outer rule)");
});
