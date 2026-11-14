// Direct checks of each part, for GET /api/health and GET /api/state.
// Sentences are for the owner; tool names, ports and addresses go only in `technical`.
import { execFile } from "node:child_process";
import { closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { readManifests } from "../../../apps/manifest.mjs";
import { readDoorsState } from "../../../doors/common.mjs";
import { readModelState } from "../../../relay/state.mjs";
import { httpRequest, parseJson } from "./httpclient.mjs";

const TIMEOUT = 2000;
const DOOR_ANSWER_MAX = 64 * 1024;
const INDEX_MAX = 4 * 1024 * 1024;
const PLAYBOOK_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

async function probe(url) {
  if (!url) return { offline: true };
  try {
    const res = await httpRequest(url, { timeoutMs: TIMEOUT, headers: { accept: "application/json" } });
    return { status: res.status, json: parseJson(res.text) };
  } catch {
    return { offline: true };
  }
}

export async function boardState(env) {
  const r = await probe(env.urls.board && `${env.urls.board}/api/health`);
  const technical = `paperclip on ${env.urls.board || "(none)"}`;
  if (r.offline) return { id: "board", name: "Board", state: "off", sentence: "The board is off, so agents are not working. Run: engine start", technical };
  if (r.status === 200 && r.json?.status === "ok") return { id: "board", name: "Board", state: "on", sentence: "The board is on. Agents can take work.", technical };
  return { id: "board", name: "Board", state: "unhealthy", sentence: "The board answers but says something is wrong. Restart the engine: engine stop, then engine start.", technical: `${technical}; /api/health answered ${r.status}` };
}

export async function gateState(env) {
  const r = await probe(env.urls.gate && `${env.urls.gate}/gate/health`);
  const technical = `gate on ${env.urls.gate || "(none in stubs mode)"}, forwarding to the board`;
  if (r.offline) return { id: "gate", name: "Gate", state: "off", sentence: "The gate is off, so agents cannot reach the board. Run: engine start", technical };
  if (r.status === 200) return { id: "gate", name: "Gate", state: "on", sentence: "The gate is on. Agents reach the board only through it, with their own limited rights.", technical };
  return { id: "gate", name: "Gate", state: "unhealthy", sentence: "The gate answers but its check fails. Restart the engine: engine stop, then engine start.", technical: `${technical}; /gate/health answered ${r.status}` };
}

// The model relay (CONTRACTS-V4 C4): idle in plans mode, the only way to the provider in provider mode.
export async function relayState(env) {
  const r = await probe(env.urls.relay && `${env.urls.relay}/relay/health`);
  const technical = `model relay on ${env.urls.relay || "(none in stubs mode)"}, forwarding to the provider`;
  const st = readModelState(env.config.paths.modelsState);
  const provider = st.ok && st.mode === "provider";
  if (r.offline) {
    const sentence = provider
      ? "The model relay is off, so your agents cannot reach their models. Run: engine start"
      : "The model relay is off. Run: engine start";
    return { id: "relay", name: "Model relay", state: "off", sentence, technical };
  }
  if (r.status === 200 && r.json?.part === "relay") {
    const sentence = provider
      ? "The model relay is on. Your agents reach Omega Plus only through it."
      : "The model relay is on. It is idle: your agents use your Claude and Codex plans.";
    return { id: "relay", name: "Model relay", state: "on", sentence, technical };
  }
  return { id: "relay", name: "Model relay", state: "unhealthy", sentence: "The model relay answers but its check fails. Restart the engine: engine stop, then engine start.", technical: `${technical}; /relay/health answered ${r.status}` };
}

// ---- the three doors (PLAN-V5 K12) and the playbooks ----------------------------------------------------------

const DOORS = [
  { id: "web", name: "Web door", the: "The web door", path: "/web/health", part: "web", folder: "web", who: "Only the Researcher can reach it." },
  { id: "generate", name: "Generation door", the: "The generation door", path: "/gen/health", part: "generate", folder: "generate", who: "Only the Artist and your apps can reach it." },
  { id: "viewer", name: "Page viewer", the: "The page viewer", path: "/view/health", part: "viewer", folder: "viewer", who: "Only the Builder and the Art director can reach it." },
];

// One GET of a door's health on its local address: 2 seconds and 64 KB at most, so a stranger on the port can
// neither hold Health nor fill it. -> { status, json } or { offline: true }.
function probeDoor(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve({ offline: true }); }
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return resolve({ offline: true });
    let done = false;
    const chunks = [];
    let size = 0;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = http.request({ host: "127.0.0.1", port: u.port || 80, path: u.pathname, method: "GET", headers: { accept: "application/json" }, agent: false }, (res) => {
      res.on("data", (c) => {
        size += c.length;
        if (size > DOOR_ANSWER_MAX) { finish({ status: res.statusCode, json: null }); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => finish({ status: res.statusCode, json: parseJson(Buffer.concat(chunks).toString("utf8")) }));
      res.on("error", () => finish({ offline: true }));
    });
    const timer = setTimeout(() => { finish({ offline: true }); req.destroy(); }, TIMEOUT);
    req.on("error", () => finish({ offline: true }));
    req.end();
  });
}

// A door counts as installed once its own live task wrote `engine/<folder>/READY` (K12), or while it answers.
function doorInstalled(env, folder) {
  try { return lstatSync(join(env.config.engineDir, folder, "READY")).isFile(); } catch { return false; }
}

async function doorState(env, d, switches) {
  const base = env.urls?.[d.id] || null;
  const technical = `${d.name.toLowerCase()} on ${base || "(none in stubs mode)"}`;
  const off = { id: d.id, name: d.name, state: "off", sentence: `${d.the} is off. Run: engine start`, technical };
  if (!base) return off;
  const r = await probeDoor(`${base}${d.path}`);
  if (r.offline) {
    if (!doorInstalled(env, d.folder)) return { ...off, state: "not_installed", sentence: `${d.the} is not installed yet.` };
    return off;
  }
  const j = r.json && typeof r.json === "object" ? r.json : null;
  if (r.status !== 200 || !j || j.part !== d.part) {
    return { id: d.id, name: d.name, state: "unhealthy", sentence: `${d.the} answers but its check fails. Restart the engine: engine stop, then engine start.`, technical: `${technical}; ${d.path} answered ${r.status}` };
  }
  let extra = "";
  if (d.id === "generate") extra = j.key === true ? "; a Runway key is saved" : "; no Runway key";
  if (d.id === "viewer") {
    const version = typeof j.version === "string" ? j.version.replace(/[^A-Za-z0-9 ./()-]/g, "").slice(0, 60) : "";
    extra = j.chrome === true ? `; Chrome${version ? ` ${version}` : ""}` : "; no Chrome";
    if (j.chrome !== true) {
      return { id: d.id, name: d.name, state: "unhealthy", sentence: `${d.the} is on, but no Chrome was found on this Mac.`, technical: `${technical}${extra}` };
    }
  }
  let sentence;
  if (!switches.ok) sentence = `${d.the} is on. It lets no agent in: its switches could not be read. Open Settings.`;
  else if (switches[d.id].on === true) sentence = `${d.the} is on. ${d.who}`;
  else sentence = `${d.the} is on. It is idle: the switch in Settings is off.`;
  return { id: d.id, name: d.name, state: "on", sentence, technical: `${technical}${extra}` };
}

// doorStates(env) -> the three Health lines of K12, in the order web, generation, viewer. A null address (stub
// homes) is "off" with nothing called; a door that does not answer and has no READY marker is "not installed".
export function doorStates(env) {
  const path = env.config?.paths?.doorsState;
  const switches = typeof path === "string" ? readDoorsState(path) : { ok: false };
  return Promise.all(DOORS.map((d) => doorState(env, d, switches)));
}

// ---- App Studio (PLAN-V5 K17, T78) --------------------------------------------------------------------------------

const APP_STATES = new Set(["off", "starting", "on", "failed", "not_installed", "damaged"]);
const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const STATUS_MAX = 256 * 1024;

// The names of a list of apps as the owner reads them: "A", "A and B", "A, B and C".
function nameList(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Why each failed app stopped, from the host's status file (read without following a link, capped): Map(slug -> why).
function failedWhys(path) {
  const out = new Map();
  if (typeof path !== "string") return out;
  let fd;
  try { fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); } catch { return out; }
  let text = null;
  try {
    const st = fstatSync(fd);
    if (st.isFile() && st.uid === process.getuid() && (st.mode & 0o022) === 0 && st.size <= STATUS_MAX) {
      const buf = Buffer.alloc(st.size);
      let at = 0;
      while (at < st.size) { const n = readSync(fd, buf, at, st.size - at, null); if (n === 0) break; at += n; }
      text = buf.subarray(0, at).toString("utf8");
    }
  } catch { text = null; } finally { closeSync(fd); }
  const data = parseJson(text);
  for (const a of data && Array.isArray(data.apps) ? data.apps.slice(0, 100) : []) {
    if (a && typeof a.slug === "string" && APP_SLUG.test(a.slug) && a.state === "failed" && typeof a.why === "string") out.set(a.slug, a.why);
  }
  return out;
}

// appsState(env) -> App Studio's Health line (K17): the host's own state from its health address (a null address is
// "off" with nothing called), and while it is on, which apps are open, starting or stopped, by their names.
export async function appsState(env) {
  const base = env.urls?.apps || null;
  const technical = `app studio host on ${base || "(none in stubs mode)"}`;
  const off = { id: "apps", name: "App Studio", state: "off", sentence: "App Studio is off. Run: engine start", technical };
  if (!base) return off;
  const r = await probeDoor(`${base}/apps/health`);
  if (r.offline) {
    if (!doorInstalled(env, "apps")) return { ...off, state: "not_installed", sentence: "App Studio is not installed yet." };
    return off;
  }
  const j = r.json && typeof r.json === "object" ? r.json : null;
  if (r.status !== 200 || !j || j.part !== "apps" || !Array.isArray(j.apps)) {
    return { id: "apps", name: "App Studio", state: "unhealthy", sentence: "App Studio answers but its check fails. Restart the engine: engine stop, then engine start.", technical: `${technical}; /apps/health answered ${r.status}` };
  }
  let names = new Map();
  try {
    names = new Map(readManifests(env.config).filter((e) => e.ok).map((e) => [e.app.slug, e.app.name]));
  } catch { names = new Map(); }
  const by = { on: [], starting: [], failed: [] };
  const failedSlugs = [];
  for (const a of j.apps.slice(0, 100)) {
    if (!a || typeof a.slug !== "string" || !names.has(a.slug) || !APP_STATES.has(a.state) || !by[a.state]) continue;
    by[a.state].push(names.get(a.slug));
    if (a.state === "failed") failedSlugs.push(a.slug);
  }
  const parts = [];
  if (by.on.length) parts.push(`Open: ${nameList(by.on)}.`);
  if (by.starting.length) parts.push(`Starting: ${nameList(by.starting)}.`);
  if (failedSlugs.length) {
    const whys = failedWhys(env.config?.paths?.appsStatus);
    const exits = failedSlugs.filter((s) => whys.get(s) === "exits").map((s) => names.get(s));
    const other = failedSlugs.filter((s) => whys.get(s) !== "exits").map((s) => names.get(s));
    const it = (list) => (list.length === 1 ? "it" : "each");
    if (exits.length) parts.push(`${nameList(exits)} stopped three times; switch ${it(exits)} off and on in App Studio.`);
    if (other.length) parts.push(`${nameList(other)} could not start; switch ${it(other)} off and on in App Studio.`);
  }
  if (!parts.length) parts.push("No app is switched on.");
  return { id: "apps", name: "App Studio", state: "on", sentence: `App Studio is on. ${parts.join(" ")}`, technical };
}

// How many playbooks the installer put in place, from `<state>/playbooks/index.json` (read without following a
// link, capped); 0 when it cannot be read.
function playbookCount(dir) {
  try { if (!lstatSync(dir).isDirectory()) return 0; } catch { return 0; }
  let fd;
  try { fd = openSync(join(dir, "index.json"), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); } catch { return 0; }
  let text = null;
  try {
    const st = fstatSync(fd);
    if (st.isFile() && st.size <= INDEX_MAX) {
      const buf = Buffer.alloc(st.size);
      let at = 0;
      while (at < st.size) { const n = readSync(fd, buf, at, st.size - at, null); if (n === 0) break; at += n; }
      text = buf.subarray(0, at).toString("utf8");
    }
  } catch { text = null; } finally { closeSync(fd); }
  const data = parseJson(text);
  const rows = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray(data.playbooks) ? data.playbooks : [];
  const names = new Set(rows.slice(0, 200).filter((r) => r && typeof r === "object" && typeof r.name === "string" && PLAYBOOK_NAME.test(r.name)).map((r) => r.name));
  return names.size;
}

// playbooksState(env) -> the Health line of the playbooks (K12).
export function playbooksState(env) {
  const dir = env.config?.paths?.playbooks;
  const n = typeof dir === "string" ? playbookCount(dir) : 0;
  const technical = `playbooks in ${dir || "(none)"}, from engine/playbooks/manifest.json`;
  if (n > 0) return { id: "playbooks", name: "Playbooks", state: "on", sentence: `Playbooks: ${n} in place.`, technical };
  return { id: "playbooks", name: "Playbooks", state: "not_installed", sentence: "Playbooks are not in place. Run: engine/playbooks/install.sh", technical };
}

export async function booksState(env) {
  const technical = `Frappe bench (ERPNext, India Compliance, CRM, Helpdesk, HRMS) on ${env.urls.bench}, site ${env.config.bench.site}, MariaDB on port ${env.config.ports.benchDb}`;
  if (!env.bench.installed()) return { id: "books", name: "Books", state: "not_installed", sentence: "The books are not installed on this Mac yet.", technical };
  const r = await probe(`${env.urls.bench}/api/method/ping`);
  if (r.offline) return { id: "books", name: "Books", state: "off", sentence: "The books are off. Run: engine start", technical };
  if (r.status === 200 && r.json?.message === "pong") return { id: "books", name: "Books", state: "on", sentence: "The books are on.", technical };
  return { id: "books", name: "Books", state: "unhealthy", sentence: "The books answer but their check fails. Restart the engine: engine stop, then engine start.", technical: `${technical}; ping answered ${r.status}` };
}

export function homeState(env) {
  return { id: "home", name: "Home screen", state: "on", sentence: "The home screen is on.", technical: `home server on 127.0.0.1:${env.port()}` };
}

export function readProof(file) {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

export function proofSentence(p) {
  if (!p) return "The fence has not been checked yet. Run the proof to check it.";
  if (p.result === "holds") return "The fence held at its last check.";
  if (p.result === "holds-with-todo") return "The fence held at its last check, with something still for you to do.";
  return "The fence failed its last check. Do not give agents work until it holds again.";
}

const CONNECT = "Connect an account to turn this on.";
const FIXED_NOT_CONNECTED = [
  { id: "codex_login", label: "The Checker's own login", explain: "The Checker uses your own Codex login for now. It should have one of its own.", how: "Run: engine/fence/login-wizard.sh codex" },
  { id: "board_login", label: "A sign-in for the board", explain: "Other programs on this Mac can reach the board as you. A sign-in would stop that.", how: "Not built yet. It will be a one-time step for you." },
  { id: "publishing", label: "Publishing posts", explain: "Approved posts and newsletters stay here. Nothing is posted.", how: CONNECT },
  { id: "email", label: "Email", explain: "Agents draft replies. Nothing is emailed to anyone.", how: CONNECT },
  { id: "whatsapp", label: "WhatsApp", explain: "No message goes to customers on WhatsApp.", how: CONNECT },
  { id: "gst_portal", label: "The GST portal", explain: "E-invoices and e-way bills are not sent to the portal.", how: CONNECT },
  { id: "renderer", label: "Pictures of CAD parts", explain: "Parts come as files with their sizes. No pictures are made.", how: "Not connected. It is added only if a free one fits this Mac." },
];
const APP_NAMES = {
  erpnext: "Books", india_compliance: "Indian GST", crm: "Customers", helpdesk: "Support", hrms: "People", telephony: "Support calls",
};

export function notConnected(skippedAppsFile) {
  const out = FIXED_NOT_CONNECTED.map((x) => ({ ...x }));
  let lines = [];
  try { lines = readFileSync(skippedAppsFile, "utf8").split("\n"); } catch { lines = []; }
  const seen = new Set();
  for (const line of lines) {
    const app = line.trim().split(/[\s:,]+/)[0];
    if (!app || app.startsWith("#") || !/^[a-z0-9_]+$/i.test(app) || seen.has(app)) continue;
    seen.add(app);
    const name = APP_NAMES[app.toLowerCase()] || "One part of the books";
    out.push({
      id: `app_${app.toLowerCase()}`, label: `${name} (not installed)`,
      explain: "This part of the books was skipped to save disk space, so its page stays empty.",
      how: "Free some disk space, then run: engine/books/install.sh",
    });
  }
  return out;
}

export function freeDisk(dir, floorGb) {
  const target = existsSync(dir) ? dir : "/";
  return new Promise((resolve) => {
    execFile("/bin/df", ["-k", target], { timeout: 5000 }, (err, stdout) => {
      const cols = !err && String(stdout).trim().split("\n").pop().trim().split(/\s+/);
      const kb = cols ? Number(cols[3]) : NaN;
      const freeGb = Number.isFinite(kb) ? Math.round((kb / 1024 / 1024) * 10) / 10 : null;
      resolve({ freeGb, floorGb, ok: freeGb === null ? false : freeGb >= floorGb });
    });
  });
}
