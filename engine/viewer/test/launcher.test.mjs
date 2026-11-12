// chrome.mjs without a browser: the flags, the profile's rule, the environment, the pipe,
// the watchdog's arithmetic, and ending a process group by its id. The "browser" here is a
// stand-in: real processes (/bin/sleep) in a group of their own, so the kill path is real but
// can only ever reach what this test started. Temp folders only, removed at the end.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  CHROME_LIMITS, PROFILE_PREFERENCES, Pipe, chromeEnv, chromeFlags, chromeInstalled, endGroup, groupOf, overCap, parsePs,
  prepareRoot, readPs, startChrome,
} from "../chrome.mjs";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const folder = () => { const d = mkdtempSync(join(tmpdir(), "viewer-launch-")); dirs.push(d); return d; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("the flags are p2's working line: the proxy for every address, no name lookups, the pipe, no port", () => {
  const f = chromeFlags({ root: "/x/r", proxyPort: 4321 });
  for (const want of ["--headless=new", "--remote-debugging-pipe", "--user-data-dir=/x/r/profile", "--proxy-server=http://127.0.0.1:4321",
    "--proxy-bypass-list=<-loopback>", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1", "--block-new-web-contents",
    "--disable-component-extensions-with-background-pages", "--use-mock-keychain", "--disable-gpu", "--deny-permission-prompts",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-background-networking", "--disable-sync", "--disable-extensions",
    "--no-first-run", "--disable-component-update"]) assert.ok(f.includes(want), want);
  assert.equal(f.at(-1), "about:blank");
  // no flag NAME (the part before "=") touches the sandbox, a port, web security or files
  assert.equal(f.some((x) => /remote-debugging-port|sandbox|single-process|disable-web-security|allow-file-access/i.test(x.split("=")[0])), false);
  assert.throws(() => chromeFlags({ root: "rel", proxyPort: 1 }));
  assert.throws(() => chromeFlags({ root: "/x", proxyPort: 0 }));
});

test("the environment is four fixed names, nothing of the viewer's own", () => {
  process.env.UUU_SHOULD_NOT_PASS = "1";
  assert.deepEqual(chromeEnv("/r"), { PATH: "/usr/bin:/bin", HOME: "/r/home", TMPDIR: "/r/tmp/", MAC_CHROMIUM_TMPDIR: "/r/tmp" });
  delete process.env.UUU_SHOULD_NOT_PASS;
});

test("the profile's Preferences hold the WebRTC rule before Chrome starts; folders are 0700", () => {
  const root = join(folder(), "r");
  mkdirSync(root, { mode: 0o700 });
  prepareRoot(root);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "profile", "Default", "Preferences"), "utf8")), PROFILE_PREFERENCES);
  assert.deepEqual(PROFILE_PREFERENCES.webrtc, { ip_handling_policy: "disable_non_proxied_udp", multiple_routes_enabled: false, nonproxied_udp_enabled: false });
  for (const d of ["profile", "crash", "home", "tmp"]) assert.equal(statSync(join(root, d)).mode & 0o777, 0o700, d);
  assert.throws(() => prepareRoot(root), "never over an existing profile");
});

test("chromeInstalled is false for a relative path, a folder, a missing file", () => {
  assert.equal(chromeInstalled("chrome"), false);
  assert.equal(chromeInstalled("/"), false);
  assert.equal(chromeInstalled("/nope/Google Chrome"), false);
  assert.equal(chromeInstalled("/bin/sleep"), true);
});

test("the watchdog's arithmetic: the group and its runaway children, added up, against 2 GB", () => {
  const rows = parsePs([
    "  100     1   100  500000 /Applications/Google Chrome.app/... --user-data-dir=/w/doors/work/view/a/profile",
    "  101   100   100  900000 Google Chrome Helper (Renderer) --type=renderer",
    "  102   100   100  600000 Google Chrome Helper --type=gpu-process",
    "  103   101   555  200000 a child that left the group",
    "  200     1   200 9000000 /Applications/Google Chrome.app/... the owner's own Chrome",
    "  201   200   200 9000000 the owner's renderer",
    "garbage line",
  ].join("\n"));
  assert.equal(rows.length, 6);
  const g = groupOf(rows, 100);
  assert.deepEqual(g.members.map((r) => r.pid).sort(), [100, 101, 102, 103]);
  assert.equal(g.kb, 2_200_000);
  assert.equal(CHROME_LIMITS.memCapKb, 2 * 1024 * 1024);
  assert.equal(overCap(rows, 100, CHROME_LIMITS.memCapKb), true);   // 2,200,000 KB > 2,097,152 KB
  assert.equal(overCap(rows.filter((r) => r.pid !== 103), 100, CHROME_LIMITS.memCapKb), false); // 2,000,000 KB
  assert.equal(groupOf(rows, 999).members.length, 0);
});

test("endGroup ends only the group it was given, by id, and never a pid of 0, 1 or this process", async () => {
  const mine = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const other = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  try {
    await wait(100);
    assert.equal(await endGroup(0, "/x"), 0);
    assert.equal(await endGroup(1, "/x"), 0);
    assert.equal(await endGroup(process.pid, "/x"), 0);
    assert.equal(await endGroup(mine.pid, "/nowhere"), 0);
    const rows = await readPs();
    assert.equal(rows.some((r) => r.pid === mine.pid), false, "the group is gone");
    assert.equal(rows.some((r) => r.pid === other.pid), true, "the other group still runs");
  } finally {
    try { process.kill(-other.pid, "SIGKILL"); } catch { /* gone */ }
    try { process.kill(-mine.pid, "SIGKILL"); } catch { /* gone */ }
  }
});

// A stand-in Chrome: a real process group (/bin/sleep) and an in-process debugging pipe.
function standIn({ answer = true } = {}) {
  let child;
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  let buf = "";
  toChrome.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (!answer) continue;
      if (m.method === "Browser.close") { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }
      fromChrome.write(`${JSON.stringify({ id: m.id, result: m.method === "Browser.getVersion" ? { product: "Stand-in/1" } : {} })}\0`);
    }
  });
  return (program, args, env) => {
    child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    child.on("exit", () => fromChrome.end());
    standIn.last = { child, args, env };
    return { child, toChrome, fromChrome };
  };
}

test("startChrome: the version from the pipe, then end() leaves no process", async () => {
  const root = join(folder(), "r");
  const s = await startChrome({ program: "/x", root, proxyPort: 4000, launch: standIn() });
  assert.equal(s.version, "Stand-in/1");
  assert.ok(standIn.last.args.includes("--proxy-server=http://127.0.0.1:4000"));
  assert.deepEqual(Object.keys(standIn.last.env).sort(), ["HOME", "MAC_CHROMIUM_TMPDIR", "PATH", "TMPDIR"]);
  await s.end();
  assert.equal((await readPs()).some((r) => r.pgid === s.pid), false);
});

test("startChrome: no answer within the start-up time ends the group and throws", async () => {
  const root = join(folder(), "r");
  await assert.rejects(startChrome({ program: "/x", root, proxyPort: 4000, launch: standIn({ answer: false }), limits: { startMs: 300 } }), /did not answer/);
  assert.equal((await readPs()).some((r) => r.pgid === standIn.last.child.pid), false);
});

test("the watchdog ends the group when its memory passes the cap", async () => {
  const root = join(folder(), "r");
  let leader = 0;
  const fakePs = async () => {
    const rows = await readPs();
    // the stand-in's group, made to look like 3 GB
    return rows.map((r) => (r.pgid === leader ? { ...r, rss: 3 * 1024 * 1024 } : r));
  };
  const launch = standIn();
  const s = await startChrome({ program: "/x", root, proxyPort: 4000, launch: (...a) => { const o = launch(...a); leader = o.child.pid; return o; }, ps: fakePs, limits: { watchEveryMs: 50 } });
  for (let i = 0; i < 40 && !s.gone; i++) await wait(50);
  assert.equal(s.why, "memory");
  assert.equal(s.gone, true);
  await s.end();
});

test("the pipe: NUL-framed answers matched by id, split chunks joined, timeouts, closing rejects", async () => {
  const to = new PassThrough();
  const from = new PassThrough();
  const p = new Pipe(to, from, { maxMessageBytes: 1000 });
  const events = [];
  p.on((m) => events.push(m.method));
  const a = p.send("A.one", {}, undefined, 1000);
  const b = p.send("B.two", {}, "S1", 50);
  const msg = Buffer.from(`${JSON.stringify({ id: 1, result: { ok: 1 } })}\0${JSON.stringify({ method: "Ev.x", params: {} })}\0`);
  from.write(msg.subarray(0, 7));
  from.write(msg.subarray(7));
  assert.deepEqual(await a, { ok: 1 });
  await assert.rejects(b, /timed out/);
  assert.deepEqual(events, ["Ev.x"]);
  const c = p.send("C.three");
  from.write("x".repeat(2000)); // a message past the cap closes the pipe
  await assert.rejects(c, /gone/);
  await assert.rejects(p.send("D.four"), /gone/);
});
