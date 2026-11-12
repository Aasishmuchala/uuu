// The hidden Chrome of the page viewer (PLAN-V5 K15 and the corrections after prototype p2).
// Chrome's own sandbox stays on: no flag here turns it off. Every start gets a throwaway
// profile with the WebRTC rule written into its Preferences first, a throwaway HOME and
// TMPDIR, the viewer's own proxy for every address (local ones included), no name lookups of
// its own, and is driven over the debugging pipe (file descriptors 3 and 4, no port). It runs
// in a process group of its own, watched for memory (the whole group, every 200 ms, ended at
// 2 GB) and ended by its process id, never by a program's name: the owner's own Chrome and
// its profile are never looked at or touched. Zero dependencies.
import { execFile, spawn } from "node:child_process";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const CHROME_LIMITS = Object.freeze({
  startMs: 30_000,                 // to the first answer on the pipe (over 10 s seen on a busy Mac)
  memCapKb: 2 * 1024 * 1024,       // the whole group's resident memory
  watchEveryMs: 200,
  maxMessageBytes: 64 * 1024 * 1024,
});

// The rule that stopped WebRTC's STUN packets in p2 (the command-line flag alone did not).
export const PROFILE_PREFERENCES = Object.freeze({
  webrtc: { ip_handling_policy: "disable_non_proxied_udp", multiple_routes_enabled: false, nonproxied_udp_enabled: false },
});

// The working line of p2's findings, in its order.
export function chromeFlags({ root, proxyPort }) {
  if (typeof root !== "string" || !root.startsWith("/")) throw new Error("chromeFlags: root");
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new Error("chromeFlags: proxyPort");
  return [
    "--headless=new",
    "--remote-debugging-pipe",
    `--user-data-dir=${root}/profile`,
    `--disk-cache-dir=${root}/profile/cache`,
    `--crash-dumps-dir=${root}/crash`,
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-component-extensions-with-background-pages",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-pings",
    "--metrics-recording-only",
    "--use-mock-keychain",
    "--password-store=basic",
    "--deny-permission-prompts",
    "--block-new-web-contents",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
    "--disable-features=Translate,OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication,CertificateTransparencyComponentUpdater,InterestFeedContentSuggestions,PrivacySandboxSettings4,DnsOverHttps,NetworkTimeServiceQuerying",
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    "about:blank",
  ];
}

// Nothing of the viewer's own environment reaches Chrome.
export function chromeEnv(root) {
  return { PATH: "/usr/bin:/bin", HOME: `${root}/home`, TMPDIR: `${root}/tmp/`, MAC_CHROMIUM_TMPDIR: `${root}/tmp` };
}

// The throwaway folders of one start, inside `root` (made 0700 by the caller), and the
// profile's Preferences written before Chrome ever reads it.
export function prepareRoot(root) {
  for (const d of ["profile", "profile/Default", "crash", "home", "tmp"]) mkdirSync(join(root, d), { mode: 0o700 });
  writeFileSync(join(root, "profile", "Default", "Preferences"), JSON.stringify(PROFILE_PREFERENCES), { mode: 0o600, flag: "wx" });
}

export function chromeInstalled(program) {
  if (typeof program !== "string" || !program.startsWith("/")) return false;
  try {
    const st = statSync(program);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// Chrome's version from its app's Info.plist (read with a cap, no program run), or null.
export function chromeVersion(program) {
  if (typeof program !== "string") return null;
  const plist = join(dirname(dirname(program)), "Info.plist");
  let fd;
  try { fd = openSync(plist, constants.O_RDONLY | constants.O_NONBLOCK); } catch { return null; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 512 * 1024) return null;
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([0-9.]{1,32})<\/string>/.exec(buf.toString("utf8"));
    return m ? m[1] : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// The real start: its own process group, no stdin or stdout, the pipe on fds 3 and 4.
export function defaultLaunch(program, args, env) {
  const child = spawn(program, args, { detached: true, env, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  child.stderr.on("data", () => {}); // read and dropped: a full pipe would stall Chrome
  child.stderr.on("error", () => {});
  return { child, toChrome: child.stdio[3], fromChrome: child.stdio[4] };
}

// ---- the pipe: NUL-terminated JSON each way ------------------------------------------------
export class Pipe {
  constructor(toChrome, fromChrome, { maxMessageBytes = CHROME_LIMITS.maxMessageBytes } = {}) {
    this.w = toChrome;
    this.id = 0;
    this.waiting = new Map();
    this.listeners = [];
    this.closed = false;
    let chunks = [];
    let held = 0;
    toChrome.on("error", () => this.close());
    fromChrome.on("error", () => this.close());
    fromChrome.on("close", () => this.close());
    fromChrome.on("end", () => this.close());
    fromChrome.on("data", (d) => {
      let start = 0;
      for (let i = d.indexOf(0); i >= 0; i = d.indexOf(0, start)) {
        chunks.push(d.subarray(start, i));
        const text = Buffer.concat(chunks).toString("utf8");
        chunks = [];
        held = 0;
        start = i + 1;
        this.deliver(text);
      }
      if (start < d.length) {
        chunks.push(d.subarray(start));
        held += d.length - start;
        if (held > maxMessageBytes) { chunks = []; held = 0; this.close(); }
      }
    });
  }
  deliver(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (typeof m.id === "number" && this.waiting.has(m.id)) {
      const w = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.error) w.reject(new Error(`${w.method}: ${String(m.error.message || "error").slice(0, 120)}`));
      else w.resolve(m.result || {});
    } else if (typeof m.method === "string") {
      for (const f of this.listeners) { try { f(m); } catch { /* a listener's failure changes nothing */ } }
    }
  }
  on(f) { this.listeners.push(f); }
  send(method, params = {}, sessionId, ms = 10_000) {
    if (this.closed) return Promise.reject(new Error(`${method}: chrome is gone`));
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method}: timed out`)); }, Math.max(1, ms));
      this.waiting.set(id, { resolve, reject, timer, method });
      try { this.w.write(`${JSON.stringify(msg)}\0`); } catch { clearTimeout(timer); this.waiting.delete(id); reject(new Error(`${method}: chrome is gone`)); }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.reject(new Error(`${w.method}: chrome is gone`)); }
    this.waiting.clear();
    try { this.w.destroy(); } catch { /* already closed */ }
  }
}

// ---- the process group ---------------------------------------------------------------------
// `ps -A -o pid=,ppid=,pgid=,rss=,command=` as rows.
export function parsePs(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], rss: +m[4], cmd: m[5] });
  }
  return rows;
}

// The processes of the group started as `leader` (its process group, and any child of a
// member that left the group) and their resident memory added up, in KB.
export function groupOf(rows, leader) {
  const set = new Set();
  for (const r of rows) if (r.pgid === leader || r.pid === leader) set.add(r.pid);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) if (!set.has(r.pid) && set.has(r.ppid)) { set.add(r.pid); grew = true; }
  }
  const members = rows.filter((r) => set.has(r.pid));
  return { members, kb: members.reduce((s, r) => s + r.rss, 0) };
}

export function overCap(rows, leader, capKb) {
  return groupOf(rows, leader).kb > capKb;
}

export function readPs() {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-A", "-o", "pid=,ppid=,pgid=,rss=,command="], { timeout: 3000, maxBuffer: 32 * 1024 * 1024, env: { PATH: "/usr/bin:/bin" } },
      (err, out) => resolve(err ? null : parsePs(out)));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Ends the group by its id. Safe by construction: a process group id cannot be given to
// anything new while a member of the group lives, so when `ps` shows members of `leader`'s
// group they are the ones started here. A child that left the group is ended by its own id
// only when its command line names this start's own folder.
export async function endGroup(leader, root, { ps = readPs, withinMs = 3000 } = {}) {
  if (!Number.isInteger(leader) || leader <= 1 || leader === process.pid) return 0;
  const deadline = Date.now() + withinMs;
  for (;;) {
    const rows = await ps();
    if (rows === null) { try { process.kill(-leader, "SIGKILL"); } catch { /* no such group */ } return -1; }
    const { members } = groupOf(rows, leader);
    if (members.length === 0) return 0;
    if (members.some((r) => r.pgid === leader)) { try { process.kill(-leader, "SIGKILL"); } catch { /* gone already */ } }
    for (const r of members) {
      if (r.pgid !== leader && typeof root === "string" && root.length > 8 && r.cmd.includes(root)) {
        try { process.kill(r.pid, "SIGKILL"); } catch { /* gone already */ }
      }
    }
    if (Date.now() > deadline) return members.length;
    await wait(150);
  }
}

// Starts Chrome for one render. -> a session: { pid, version, send, on, gone, why, end() }.
// `why` says what ended it early: "memory" (the watchdog), "exited", or null.
export async function startChrome({
  program, root, proxyPort, launch = defaultLaunch, ps = readPs, limits = {}, log = () => {},
} = {}) {
  const lim = { ...CHROME_LIMITS, ...limits };
  const started = launch(program, chromeFlags({ root, proxyPort }), chromeEnv(root));
  const { child } = started;
  const pid = child.pid;
  if (!Number.isInteger(pid)) throw new Error("chrome did not start");
  const pipe = new Pipe(started.toChrome, started.fromChrome, { maxMessageBytes: lim.maxMessageBytes });
  const session = {
    pid, version: null, gone: false, why: null, peakKb: 0,
    send: (m, p, s, ms) => pipe.send(m, p, s, ms),
    on: (f) => pipe.on(f),
    end: null,
  };
  child.on("exit", () => { session.gone = true; if (!session.why) session.why = "exited"; pipe.close(); });
  child.on("error", () => { session.gone = true; if (!session.why) session.why = "exited"; pipe.close(); });

  // The watchdog: the group's memory every 200 ms; over the cap, the group is ended.
  let watching = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (!watching || busy) return;
    busy = true;
    try {
      const rows = await ps();
      if (rows && watching) {
        const { kb } = groupOf(rows, pid);
        session.peakKb = Math.max(session.peakKb, kb);
        if (kb > lim.memCapKb) {
          session.why = "memory";
          log("memory");
          try { process.kill(-pid, "SIGKILL"); } catch { /* gone already */ }
        }
      }
    } finally {
      busy = false;
    }
  }, lim.watchEveryMs);
  timer.unref();

  let ended = null;
  session.end = () => {
    if (ended) return ended;
    ended = (async () => {
      watching = false;
      clearInterval(timer);
      if (!session.gone) await pipe.send("Browser.close", {}, undefined, 1500).catch(() => {});
      for (let i = 0; i < 10 && !session.gone; i++) await wait(100);
      const left = await endGroup(pid, root, { ps });
      pipe.close();
      return left;
    })();
    return ended;
  };

  try {
    const v = await pipe.send("Browser.getVersion", {}, undefined, lim.startMs);
    session.version = typeof v.product === "string" ? v.product.replace(/[^\x20-\x7e]/g, "").slice(0, 60) : null;
  } catch (err) {
    await session.end();
    throw new Error(`chrome did not answer: ${err.message}`);
  }
  return session;
}
