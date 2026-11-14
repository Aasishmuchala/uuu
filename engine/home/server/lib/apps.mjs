// App Studio's home-server part (PLAN-V5 K17, K22, K23; T78): the list of apps, the owner's switches, each app's
// daily allowance, the model it thinks with, and its icon. The home server is the only writer of the switches file
// (`<state>/apps/state.json`) and of the allowances (`<state>/doors/allowances/<slug>.json`): each is written only
// from the owner's own same-origin POST (the core refuses any other), never from anything an app or an agent wrote
// (docs/adr/0007). An allowance is money: its amount is checked here against the door's own ledger and the owner's
// caps, and the door checks it again at every job.
// What is read: the apps' manifests (engine/apps/manifest.mjs, the trust rule), the switches with the host's own
// strict reader (so both always agree), the host's status file (trust rule, capped) and its health address (1.8
// seconds, 64 KB, Host 127.0.0.1:<port>; a null address, as in stub homes, is never called), the door's ledger
// (readLedger, totalsOf) and its status file (only whether Higgsfield is signed in), and the Models state (the
// saved list of models and the `app-<slug>` picks the relay reads).
import {
  chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, readSync, realpathSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { dirname, join } from "node:path";
import { readAppsState } from "../../../apps/host.mjs";
import { openNoLinks } from "../../../lib/nolinks.mjs";
import { ICON_MAX_BYTES, SLUG_RE, readManifests } from "../../../apps/manifest.mjs";
import { readLedger, totalsOf } from "../../../generate/ledger.mjs";
import { ALLOWANCE_MAX_CENTS, readAllowance, readGenState } from "../../../generate/state.mjs";
import { doorKeySaved, readDoors, readTrustedText } from "./doors.mjs";
import { HomeError } from "./errors.mjs";
import { readState, updateState } from "./models.mjs";
import { PICK, picksOf } from "./picks.mjs";
import { keptShots, siteInfo, sitesOf } from "./siteshots.mjs";
import { needIds } from "./goals.mjs";
import { loadTaskContext } from "./tasks.mjs";
import { kindOfTask } from "../routes/pieces.mjs";

// The host's health is a tiny answer, but on a busy Mac (ffmpeg, a build) the T85 review measured 1.3 seconds. 1.8
// seconds leaves room for that and stays under the 2 seconds the app's page waits between asks while an app starts,
// so each answer still arrives before the next ask replaces it.
export const HEALTH_TIMEOUT_MS = 1800;
const HEALTH_MAX_BYTES = 64 * 1024;
const STATUS_MAX_BYTES = 256 * 1024;
const SWITCHES_MAX_BYTES = 64 * 1024;
export const ALLOWANCE_MIN_CENTS = 100;
export { ALLOWANCE_MAX_CENTS };
const DAY_MS = 24 * 3600 * 1000;
// Asia/Kolkata keeps +05:30 all year (no summer time), so its midnight is a fixed offset from UTC's.
const KOLKATA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const APP_STATES = new Set(["off", "starting", "on", "failed", "not_installed", "damaged"]);
const LOCAL_ADDRESS = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
// The Art director's pick is the first one an app's thinking gets (PLAN-V5 S8).
export const FIRST_THINKER = "art-director";

// K23's words.
export const APP_SENTENCES = Object.freeze({
  off: "Off",
  starting: "Starting…",
  on: "On",
  failed: "Stopped. It could not start.",
  not_installed: "Not ready yet.",
  damaged: "This app's description is damaged.",
});
export const HOST_SENTENCES = Object.freeze({
  on: "App Studio is on.",
  off: "App Studio is off. Run: engine start",
  unhealthy: "App Studio is running but not answering. Run: engine stop, then engine start.",
  not_installed: "App Studio is not installed yet.",
});
export const PROBLEM_SENTENCES = Object.freeze({
  apps_state_unreadable: "Your app switches could not be read, so every app is off. Turning an app on or off writes them again.",
});
export const SPENDING_NONE = "This app cannot spend anything right now.";
export const NO_PROVIDER = "Add a Runway key or sign in to Higgsfield in Settings first.";
export const LEDGER_UNREADABLE = "The spending ledger cannot be read, so nothing can be allowed. Health shows what to do.";

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };

// Cents as the owner reads them: dollars(120) -> "$1.20".
export function dollars(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

// The next midnight in Asia/Kolkata after `ms`, as an ISO time. At 23:59 it is a minute away; at 00:01, a day less a
// minute.
export function nextMidnightKolkata(ms) {
  const local = ms + KOLKATA_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - KOLKATA_OFFSET_MS).toISOString();
}

// `app-<slug>`: the subject of an app's tokens, and the name of its pick in the Models state.
export const appPickName = (slug) => `app-${slug}`;

// ---- the apps --------------------------------------------------------------------------------------------------

// The apps' folders as the host reads them: [ { slug, ok, app, installed, problem } ], at most 20, in the order of
// their names. Never throws: an apps folder that cannot be read lists nothing.
export function listApps(config) {
  let list;
  try { list = readManifests(config); } catch { list = []; }
  return list.map((e) => (e.ok
    ? { slug: e.app.slug, ok: true, app: e.app, installed: e.installed === true, problem: null }
    : { slug: e.slug, ok: false, app: null, installed: false, problem: e.problem }));
}

// The one app a route's `:slug` names, matched only against the manifests' list; 404 otherwise.
export function appOf(config, slug) {
  const found = typeof slug === "string" && SLUG_RE.test(slug) ? listApps(config).find((e) => e.slug === slug) : undefined;
  if (!found) throw new HomeError(404, "App Studio has no app by that name.", "Open App Studio again.", "no_app");
  return found;
}

// The ports of the good manifests, for the home page's content policy (`frame-src`).
export function appFramePorts(config) {
  return [...new Set(listApps(config).filter((e) => e.ok).map((e) => e.app.port))].sort((a, b) => a - b);
}

// ---- the owner's switches (K17's state.json) -----------------------------------------------------------------

// -> { on: { slug: true }, changedAt, problem }. No file: every app off. A file the host would not read: every app
// off and problem "apps_state_unreadable" (the next save writes a fresh one).
export function readSwitches(config) {
  const st = readAppsState(config.paths.appsState);
  return st.ok
    ? { on: { ...st.on }, changedAt: st.changedAt, problem: null }
    : { on: {}, changedAt: null, problem: "apps_state_unreadable" };
}

const unsafe = () => new HomeError(409, "The engine's private folder for App Studio is not safe to write to.",
  "Run engine setup again, then try again.", "folder_unsafe");

// A folder of ours, made 0700 when missing; refused when it is a link, not a folder or not this user's.
function privateFolder(path) {
  if (!lstatOrNull(path)) {
    try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e?.code !== "EEXIST") throw unsafe(); }
  }
  const st = lstatOrNull(path);
  if (!st || !st.isDirectory() || st.uid !== process.getuid()) throw unsafe();
  chmodSync(path, 0o700);
}

// Written whole through a new temp file in the same folder (0600, `wx`, never through a link), then renamed over the
// old one. A link planted at the name is replaced itself (rename never follows it); a folder there is refused.
function writePrivate(file, content) {
  const cur = lstatOrNull(file);
  if (cur && cur.isDirectory()) throw unsafe();
  const tmp = join(dirname(file), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    if (e instanceof HomeError) throw e;
    throw unsafe();
  }
}

// Sets one app's switch and writes the whole file again: { version: 1, apps: { slug: { on } }, changedAt } with a new
// changedAt every time (the host starts a failed app again only when it changes). A file that could not be read is
// replaced by one holding only this switch.
export function saveSwitch(config, slug, on) {
  if (!SLUG_RE.test(slug) || typeof on !== "boolean") throw new Error("saveSwitch: not a switch");
  const { on: current } = readSwitches(config);
  const apps = {};
  for (const s of Object.keys(current).sort()) if (SLUG_RE.test(s)) apps[s] = { on: true };
  apps[slug] = { on };
  privateFolder(config.paths.apps);
  writePrivate(config.paths.appsState, `${JSON.stringify({ version: 1, apps, changedAt: new Date().toISOString() }, null, 2)}\n`);
}

// ---- the host ----------------------------------------------------------------------------------------------------

function hostInstalled(config) {
  try { return lstatSync(join(config.engineDir, "apps", "READY")).isFile(); } catch { return false; }
}

// One GET of the host's health on its local address, sent with Host 127.0.0.1:<port>: at most one second and 64 KB.
// -> { status, json } | { offline: true } | { cut: true }. A null or non-local address is offline and nothing is called.
export function probeHost(base, timeoutMs = HEALTH_TIMEOUT_MS) {
  const m = typeof base === "string" ? LOCAL_ADDRESS.exec(base) : null;
  if (!m || Number(m[1]) > 65535) return Promise.resolve({ offline: true, called: false });
  const port = Number(m[1]);
  return new Promise((resolve) => {
    let done = false;
    let began = false;
    const chunks = [];
    let size = 0;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = http.request({
      host: "127.0.0.1", port, path: "/apps/health", method: "GET", agent: false,
      headers: { host: `127.0.0.1:${port}`, accept: "application/json" },
    }, (res) => {
      began = true;
      res.on("data", (c) => {
        size += c.length;
        if (size > HEALTH_MAX_BYTES) { finish({ cut: true }); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { json = null; }
        finish({ status: res.statusCode, json });
      });
      res.on("error", () => finish({ cut: true }));
    });
    const timer = setTimeout(() => { finish(began ? { cut: true } : { offline: true }); req.destroy(); }, timeoutMs);
    req.on("error", () => finish(began ? { cut: true } : { offline: true }));
    req.end();
  });
}

// Each app's state as the host's health says it: Map(slug -> state), only well-formed entries.
function healthStates(json) {
  const out = new Map();
  if (!obj(json) || !Array.isArray(json.apps)) return out;
  for (const a of json.apps.slice(0, 100)) {
    if (obj(a) && typeof a.slug === "string" && SLUG_RE.test(a.slug) && APP_STATES.has(a.state)) out.set(a.slug, a.state);
  }
  return out;
}

// The host's status file (trust rule, capped): Map(slug -> { state, why }); empty when it cannot be used.
export function readHostStatus(config) {
  const out = new Map();
  const text = readTrustedText(config.paths.appsStatus, STATUS_MAX_BYTES);
  if (typeof text !== "string" || text === "missing") return out;
  let d;
  try { d = JSON.parse(text); } catch { return out; }
  if (!obj(d) || d.version !== 1 || !Array.isArray(d.apps)) return out;
  for (const a of d.apps.slice(0, 100)) {
    if (!obj(a) || typeof a.slug !== "string" || !SLUG_RE.test(a.slug) || !APP_STATES.has(a.state)) continue;
    out.set(a.slug, { state: a.state, why: typeof a.why === "string" && /^[a-z_]{1,40}$/.test(a.why) ? a.why : null });
  }
  return out;
}

// The host: { state: on | off | unhealthy | not_installed, sentence, apps: Map(slug -> state) } (apps only while on).
// One answer, as it came: the list uses steadyStates below.
export async function hostOf(config, base) {
  const r = await probeHost(base);
  let state;
  if (r.offline) state = r.called === false ? "off" : hostInstalled(config) ? "off" : "not_installed";
  else if (r.cut) state = "unhealthy";
  else state = r.status === 200 && obj(r.json) && r.json.part === "apps" && r.json.status === "ok" ? "on" : "unhealthy";
  return { state, sentence: HOST_SENTENCES[state], apps: state === "on" ? healthStates(r.json) : new Map() };
}

// One app's state: what its folder says when it cannot run (damaged, not installed); else the running host's word
// (its health, then its status file), and "off" while the host is not on.
function appState(entry, host, status) {
  if (!entry.ok) return "damaged";
  if (!entry.installed) return "not_installed";
  if (host.state !== "on") return "off";
  const s = host.apps.get(entry.slug) || status.get(entry.slug)?.state || "off";
  return s === "damaged" || s === "not_installed" ? "off" : s;
}

// One bad answer does not take an open app away (T85 finding 8). An app the owner switched on that was "on" at the
// last answer and is "off" now (the host slow, closed, or not listing it) stays "on" for this one answer; the next
// answer that says off is believed. An app switched off is never held. The host's own state is held with it, only
// while it holds an app. Remembered per host address: Map(base -> { host, apps: Map(slug -> { state, held }) }).
const steady = new Map();
const STEADY_MAX = 50;

// steadyStates(base, host, fresh, on) -> { host, states }: `fresh` is Map(slug -> state) from this answer, `on` the
// owner's switches ({ slug: true }).
export function steadyStates(base, host, fresh, on) {
  const key = String(base || "");
  const before = steady.get(key) || { host: null, apps: new Map() };
  const apps = new Map();
  const states = new Map();
  let holding = false;
  for (const [slug, state] of fresh) {
    const last = before.apps.get(slug);
    if (state === "off" && on[slug] === true && last && last.state === "on" && !last.held) {
      apps.set(slug, { state: "on", held: true });
      states.set(slug, "on");
      holding = true;
    } else {
      apps.set(slug, { state, held: false });
      states.set(slug, state);
    }
  }
  const shown = holding && host.state !== "on" && before.host && before.host.state === "on" ? before.host : host;
  steady.delete(key);
  steady.set(key, { host: shown, apps });
  if (steady.size > STEADY_MAX) steady.delete(steady.keys().next().value);
  return { host: shown, states };
}

// For tests.
export function forgetSteady() {
  steady.clear();
}

// ---- money ---------------------------------------------------------------------------------------------------------

// What is left of the owner's caps now, from the door's ledger: { ok, lines, dayLeft, monthLeft, left } (cents).
// The ledger unreadable: ok false and nothing left.
export function capsLeft(config, now = Date.now()) {
  const g = readDoors(config).state.generate;
  const r = readLedger(config.paths.ledger);
  if (!r.ok) return { ok: false, lines: null, dayLeft: 0, monthLeft: 0, left: 0 };
  const gs = readGenState(config.paths.doorsState, now);
  const t = totalsOf(r.lines, now, { resumedAt: gs.ok ? gs.resumedAt : null });
  const dayLeft = Math.max(0, g.dailyCredits - t.day);
  const monthLeft = Math.max(0, g.monthlyCredits - t.month);
  return { ok: true, lines: r.lines, dayLeft, monthLeft, left: Math.min(dayLeft, monthLeft) };
}

// Whether each service can make anything now: Runway when its key is saved; Higgsfield when its switch is on and the
// door says it is signed in (its status file; the token file is never read here).
export function providersReady(config, now = Date.now()) {
  const runway = doorKeySaved(config, "runway");
  const gs = readGenState(config.paths.doorsState, now);
  let higgsfield = false;
  if (gs.ok && gs.higgsfield.on) {
    const text = readTrustedText(config.paths.generateStatus, STATUS_MAX_BYTES);
    let d = null;
    try { d = typeof text === "string" && text !== "missing" ? JSON.parse(text) : null; } catch { d = null; }
    higgsfield = obj(d) && obj(d.higgsfield) && d.higgsfield.signedIn === true && d.higgsfield.refused !== true;
  }
  return { runway, higgsfield };
}

// One app's spending: { open, budget, spent, left, expiresAt, words, limitLeft, limitWords } in cents. `left` is held
// to what is left of the caps too, as the door holds it.
export function spendingOf(config, slug, caps, now = Date.now()) {
  const limitLeft = Math.min(caps.left, ALLOWANCE_MAX_CENTS);
  const base = { limitLeft, limitWords: `What is left of today's limit: ${dollars(limitLeft)}.` };
  const a = readAllowance(config.paths.allowances, slug, now);
  if (!a.ok) return { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: SPENDING_NONE, ...base };
  const budget = a.allowance.budgetCents;
  const spent = caps.ok ? totalsOf(caps.lines, now, { batch: a.allowance.id }).batch : 0;
  const left = caps.ok ? Math.max(0, Math.min(budget - spent, caps.dayLeft, caps.monthLeft)) : 0;
  return {
    open: true, budget, spent, left, expiresAt: a.allowance.expiresAt,
    words: caps.ok ? `Allowed today: ${dollars(budget)}. Spent: ${dollars(spent)}.` : `Allowed today: ${dollars(budget)}. ${LEDGER_UNREADABLE}`,
    ...base,
  };
}

// Writes the owner's allowance for one app: { version: 1, id: "a" + 20 hex, app, approvedAt, expiresAt (the next
// midnight in Asia/Kolkata), budgetCents (whole dollars, K22) }, 0600 in 0700 folders, a new id every time. -> the
// allowance written.
export function writeAllowance(config, slug, cents, now = Date.now()) {
  if (!SLUG_RE.test(slug) || !Number.isInteger(cents) || cents < 0 || cents % 100 !== 0 || cents > ALLOWANCE_MAX_CENTS) throw new Error("writeAllowance: not an allowance");
  const allowance = {
    version: 1, id: `a${randomBytes(10).toString("hex")}`, app: slug,
    approvedAt: new Date(now).toISOString(), expiresAt: nextMidnightKolkata(now), budgetCents: cents,
  };
  privateFolder(config.paths.doors);
  privateFolder(config.paths.allowances);
  writePrivate(join(config.paths.allowances, `${slug}.json`), `${JSON.stringify(allowance)}\n`);
  return allowance;
}

// Ends an app's allowance: its file is removed (nothing there is fine). A folder or anything else that is not a plain
// file at the name is refused.
export function stopAllowance(config, slug) {
  if (!SLUG_RE.test(slug)) throw new Error("stopAllowance: not an app");
  const file = join(config.paths.allowances, `${slug}.json`);
  const st = lstatOrNull(file);
  if (!st) return false;
  if (st.isDirectory()) throw unsafe();
  try { unlinkSync(file); } catch (e) { if (e?.code !== "ENOENT") throw unsafe(); }
  return true;
}

// ---- the app's model ------------------------------------------------------------------------------------------------

// What an app thinks with, for an app whose manifest names the relay: { model, name, choices: [ { id, name } ] }
// from the Models state (its saved list of models and the pick `app-<slug>`); null for any other app.
export function thinksOf(models, entry) {
  if (!entry.ok || !entry.app.engine.includes("relay")) return null;
  const pick = models.picks[appPickName(entry.slug)] || null;
  const nameOf = new Map(models.catalogue.models.map((m) => [m.id, m.name]));
  return {
    model: pick ? pick.model : null,
    name: pick ? nameOf.get(pick.model) || pick.model : null,
    choices: models.catalogue.models.map((m) => ({ id: m.id, name: m.name })),
  };
}

// Saves the Art director's pick for `app-<slug>` when the app has none yet. Changes nothing when it has one or the Art
// director has none. -> whether a pick was saved.
export function copyFirstPick(config, slug) {
  const { state, problem } = readState(config);
  const name = appPickName(slug);
  const art = state.picks[FIRST_THINKER];
  if (problem || state.picks[name] || !art) return false;
  updateState(config, (s) => { if (!s.picks[name] && s.picks[FIRST_THINKER]) s.picks[name] = { model: s.picks[FIRST_THINKER].model, source: "ranked" }; });
  return true;
}

// The owner's own choice of model for an app: one of the saved list, else false (nothing written).
export function saveAppModel(config, slug, model) {
  const { state } = readState(config);
  if (typeof model !== "string" || !state.catalogue.models.some((m) => m.id === model)) return false;
  updateState(config, (s) => { s.picks[appPickName(slug)] = { model, source: "owner" }; });
  return true;
}

// ---- the icon ------------------------------------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The manifest's icon: { bytes, type } or null. `lstat` first, then opened with no link anywhere on its path (under
// the apps folder's real path; lib/nolinks.mjs) and checked on the handle (a regular file of this user, at most
// 256 KB); its type by its ending, and a PNG by its first bytes.
export function readIcon(config, entry) {
  if (!entry.ok) return null;
  let root;
  try { root = realpathSync(config.paths.appsCode); } catch { return null; }
  const file = join(root, entry.slug, entry.app.icon);
  const type = entry.app.icon.endsWith(".png") ? "image/png" : entry.app.icon.endsWith(".svg") ? "image/svg+xml" : null;
  const pre = lstatOrNull(file);
  if (type === null || !pre || !pre.isFile() || pre.size > ICON_MAX_BYTES) return null;
  let fd;
  try { fd = openNoLinks(file); } catch { return null; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || st.size > ICON_MAX_BYTES || st.ino !== pre.ino) return null;
    const buf = Buffer.alloc(st.size);
    let size = 0;
    while (size < st.size) {
      const n = readSync(fd, buf, size, st.size - size, null);
      if (n === 0) break;
      size += n;
    }
    if (size !== st.size || size === 0) return null;
    if (type === "image/png" && !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
    return { bytes: buf, type };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// ---- the sites the team made (T88) ----------------------------------------------------------------------------------

// "Made by the team": the sites of finished and accepted page tasks, newest first, at most SITES_MAX. Read only through
// lib/siteshots.mjs (the checked readers: a task's identifier comes from the board's own list, a site is matched only
// against the task's own list of sites, files are read with the viewer's rules); nothing here takes a path from an
// agent's text. The pictures are the home server's own, by their /api/sites/shot/ address; a site with none shows none.
export const SITES_MAX = 30;
const SITE_WORDS = {
  ready: "Pictures ready",
  none: "No pictures yet",
  problem: "Cannot be shown",
};
const FIRST_PICTURES = ["shot-index-1280-light.png", "shot-index-1280-dark.png", "shot-index-390-light.png", "shot-index-390-dark.png"];

const timeOf = (v) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

// The one site of a task that App Studio shows: the version the owner picked, else the only site; null otherwise.
function shownSite(ctx, goal, listed) {
  const picks = picksOf(ctx.decisions, goal.id).filter((p) => p.action === PICK);
  const picked = picks.length ? picks[picks.length - 1].variant : null;
  if (picked) {
    const s = listed.find((x) => x.variant === picked);
    if (s) return s;
  }
  return listed.length === 1 ? listed[0] : null;
}

function siteEntry(ctx, goal, site) {
  const info = siteInfo(ctx.config, goal.identifier, site.rel);
  const kept = info.ok ? keptShots(ctx.config, info.key) : null;
  const first = kept ? FIRST_PICTURES.find((n) => kept.names.includes(n)) || kept.names.slice().sort()[0] || null : null;
  const state = !info.ok ? "problem" : kept ? "ready" : "none";
  return {
    task: { id: goal.id, identifier: goal.identifier, title: typeof goal.title === "string" ? goal.title : "" },
    ref: site.ref,
    name: site.variant ? site.ref.slice(0, -2) : site.ref,
    direction: site.direction && typeof site.direction.title === "string" ? site.direction.title : null,
    finishedAt: typeof goal.updatedAt === "string" ? goal.updatedAt : null,
    pages: info.ok ? info.pages : [],
    files: info.files,
    picture: first ? `/api/sites/shot/${info.key}/${first}` : null,
    state,
    sentence: state === "problem" ? info.problem : SITE_WORDS[state],
    opens: `#/tasks/${encodeURIComponent(goal.id)}`,
  };
}

// sitesFrom(ctx, tctx) -> the list. Never throws: a task whose folder cannot be read is left out.
export function sitesFrom(ctx, tctx) {
  const done = (tctx.goals || [])
    .filter((g) => g && g.status === "done" && typeof g.identifier === "string" && tctx.accepted(g.id))
    .filter((g) => { try { return kindOfTask(ctx, g) === "page"; } catch { return false; } })
    .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))
    .slice(0, SITES_MAX);
  const out = [];
  for (const g of done) {
    try {
      const listed = sitesOf(ctx.config, g.identifier);
      if (listed.problem) continue;
      const site = shownSite(ctx, g, listed.sites);
      if (site) out.push(siteEntry(ctx, g, site));
    } catch { /* one task's folder cannot break the list */ }
  }
  return out;
}

// The board's part of the list (its tasks, agents, runs and routines: four requests) is kept a few seconds, because
// App Studio's pages ask for the whole view every 2 to 10 seconds (T85 finding 9). Only that is kept: whether the
// owner accepted a task is read fresh from the home screen's own decisions at every call, and the owner's switches,
// the allowances and the host's health are never kept. Keyed by the board, the state folder and the company.
export const SITES_BOARD_TTL_MS = 8000;
const boardCache = new Map(); // key -> { at, value: Promise<tctx> }

function boardPart(ctx) {
  const ids = needIds(ctx);
  const key = [ctx.home?.urls?.board || "", ctx.config?.paths?.state || "", ids.companyId, ids.projectId].join("\n");
  const now = Date.now();
  const hit = boardCache.get(key);
  if (hit && now - hit.at < SITES_BOARD_TTL_MS) return hit.value;
  const value = loadTaskContext(ctx, { withInbox: false, withComments: false });
  boardCache.set(key, { at: now, value });
  value.catch(() => { if (boardCache.get(key)?.value === value) boardCache.delete(key); });
  if (boardCache.size > 20) for (const k of boardCache.keys()) { boardCache.delete(k); if (boardCache.size <= 10) break; }
  return value;
}

// For tests.
export function forgetSitesBoard() {
  boardCache.clear();
}

// listSites(ctx) -> the list, or [] on any problem (the board off, the company not set up, a folder unreadable).
export async function listSites(ctx) {
  try {
    const tctx = await boardPart(ctx);
    const decisions = ctx.decisions;
    const accepted = (id) => !!(decisions && decisions.get(`acknowledged:goal:${id}`)) || tctx.accepted(id);
    return sitesFrom(ctx, { ...tctx, accepted });
  } catch {
    return [];
  }
}

// ---- the view -------------------------------------------------------------------------------------------------------

// GET /api/apps: { host: { state, sentence }, apps: [ … ], sites: [ … ], problem, problemSentence }.
export async function buildAppsView(ctx, now = Date.now()) {
  const config = ctx.config;
  const entries = listApps(config);
  const switches = readSwitches(config);
  const base = ctx.home?.urls?.apps;
  const answer = await hostOf(config, base);
  const status = answer.state === "on" ? readHostStatus(config) : new Map();
  const fresh = new Map(entries.filter((e) => e.ok && e.installed).map((e) => [e.slug, appState(e, answer, status)]));
  const { host, states } = steadyStates(base, answer, fresh, switches.on);
  const caps = capsLeft(config, now);
  const ready = providersReady(config, now);
  const { state: models } = readState(config);
  const closed = { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: SPENDING_NONE, limitLeft: 0, limitWords: null };
  const apps = entries.map((e) => {
    const state = states.get(e.slug) || appState(e, answer, status);
    const spends = e.ok && e.app.engine.includes("generate");
    return {
      slug: e.slug,
      name: e.ok ? e.app.name : e.slug,
      about: e.ok ? e.app.about : "",
      icon: `/api/apps/${e.slug}/icon`,
      state,
      sentence: APP_SENTENCES[state],
      on: switches.on[e.slug] === true,
      port: e.ok ? e.app.port : null,
      spending: spends ? spendingOf(config, e.slug, caps, now) : { ...closed },
      ready: { ...ready },
      thinks: thinksOf(models, e),
    };
  });
  const problem = switches.problem;
  return {
    host: { state: host.state, sentence: host.sentence },
    apps,
    sites: await listSites(ctx),
    problem,
    problemSentence: problem ? PROBLEM_SENTENCES[problem] : null,
  };
}

// Why an app cannot be switched on, or null: its description, its packages, then the host.
export async function switchOnBlocker(ctx, entry) {
  if (!entry.ok) return { code: "damaged", sentence: APP_SENTENCES.damaged };
  if (!entry.installed) return { code: "not_installed", sentence: APP_SENTENCES.not_installed };
  const host = await hostOf(ctx.config, ctx.home?.urls?.apps);
  if (host.state !== "on") return { code: "host_off", sentence: host.state === "off" ? HOST_SENTENCES.off : host.sentence };
  return null;
}
