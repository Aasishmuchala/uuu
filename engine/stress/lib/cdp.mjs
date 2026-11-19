// The browser client (PLAN-STRESS, pinned interfaces): hidden headless Chrome on its own temporary profile, over the
// DevTools protocol with Node's built-in WebSocket. No dependency. The pattern of .router/tools/shoot.mjs.
//   openBrowser({ profileDir }) -> { page(), close() }
//   page = { send(method, params), on(fn), goto(url), metrics(), close(), sessionId }
// Chrome may resolve no name and reach no address but 127.0.0.1 (--host-resolver-rules), downloads are refused, and
// nothing of Chrome's own (updates, sync, metrics, safe browsing) goes out. The profile folder is made under
// /private/tmp with the stage's prefix when none is given, and removed by close(), which also ends Chrome's group.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { STAGE_PREFIX } from "./stage.mjs";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function openBrowser({ profileDir } = {}) {
  if (!existsSync(CHROME)) throw new Error(`stage: Chrome is not at ${CHROME}`);
  const made = !profileDir;
  const dir = profileDir ? (mkdirSync(profileDir, { recursive: true }), realpathSync(profileDir)) : realpathSync(mkdtempSync(join("/private/tmp", `${STAGE_PREFIX}chrome-`)));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", `--user-data-dir=${dir}`, "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--disable-default-apps", "--disable-extensions", "--metrics-recording-only", "--no-pings",
    "--disable-domain-reliability", "--disable-client-side-phishing-detection", "--safebrowsing-disable-auto-update",
    "--disable-features=OptimizationHints,MediaRouter,Translate,AutofillServerCommunication,InterestFeedContentSuggestions",
    "--password-store=basic", "--use-mock-keychain", "--window-size=1280,900", "about:blank",
  ], { detached: true, stdio: "ignore" });
  chrome.on("error", () => {});
  chrome.unref();
  const pid = chrome.pid;

  let port = null;
  for (let i = 0; i < 150 && !port; i += 1) {
    await sleep(100);
    try {
      const text = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n");
      if (/^\d+$/.test(text[0]) && text[1]) port = { port: Number(text[0]), path: text[1] };
    } catch { /* not yet */ }
  }
  const endChrome = async () => {
    // Only Chrome's own group, and only while its command line still names this profile folder.
    let cmd = "";
    try { cmd = execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { cmd = ""; }
    if (cmd.includes(dir)) {
      try { process.kill(-pid, "SIGTERM"); } catch { /* gone */ }
      for (let i = 0; i < 50 && alive(pid); i += 1) await sleep(100);
      if (alive(pid)) { try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } }
    }
  };
  if (!port) {
    await endChrome();
    if (made) rmSync(dir, { recursive: true, force: true });
    throw new Error("stage: Chrome did not open its DevTools port");
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port.port}${port.path}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("stage: Chrome's DevTools socket did not open")), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Map(); // sessionId|"" -> Set(fn)
  ws.addEventListener("message", (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(Object.assign(new Error(`${method}: ${m.error.message}`), { cdp: m.error }));
      else resolve(m.result || {});
      return;
    }
    if (m.method) for (const fn of listeners.get(m.sessionId || "") || []) { try { fn(m); } catch { /* a listener's fault */ } }
  });
  ws.addEventListener("close", () => {
    for (const { reject, method } of pending.values()) reject(new Error(`${method}: Chrome went away`));
    pending.clear();
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: Chrome went away`));
    const id = ++seq;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  await send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  const pages = new Set();

  async function page() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const own = new Set();
    listeners.set(sessionId, own);
    const s = (method, params) => send(method, params, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Network.enable");
    await s("Log.enable");
    await s("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
    const loads = [];
    own.add((m) => { if (m.method === "Page.loadEventFired") for (const r of loads.splice(0)) r(); });
    const p = {
      sessionId, targetId,
      send: s,
      on(fn) { own.add(fn); return () => own.delete(fn); },
      // Navigates and waits for the load event (or 30 s); -> { url, ms, errorText }.
      async goto(url, { timeoutMs = 30000 } = {}) {
        const t0 = Date.now();
        let timer;
        const loaded = new Promise((r) => { loads.push(r); timer = setTimeout(r, timeoutMs); });
        const nav = await s("Page.navigate", { url });
        if (!nav.errorText) await loaded;
        clearTimeout(timer);
        return { url, ms: Date.now() - t0, errorText: nav.errorText || null };
      },
      async metrics() {
        await s("Performance.enable").catch(() => {});
        const { metrics } = await s("Performance.getMetrics");
        return Object.fromEntries((metrics || []).map((x) => [x.name, x.value]));
      },
      async close() {
        pages.delete(p);
        listeners.delete(sessionId);
        await send("Target.closeTarget", { targetId }).catch(() => {});
      },
    };
    pages.add(p);
    return p;
  }

  let closed = false;
  return {
    page,
    pid,
    profileDir: dir,
    async close() {
      if (closed) return;
      closed = true;
      // The socket is closed from this side first (a socket Chrome drops keeps Node waiting about 30 s), then
      // Chrome's own group is ended by its process id.
      for (const p of [...pages]) await p.close().catch(() => {});
      await new Promise((r) => {
        if (ws.readyState === WebSocket.CLOSED) return r();
        const t = setTimeout(r, 3000);
        ws.addEventListener("close", () => { clearTimeout(t); r(); }, { once: true });
        try { ws.close(); } catch { clearTimeout(t); r(); }
      });
      await endChrome();
      if (made) rmSync(dir, { recursive: true, force: true });
    },
  };
}
