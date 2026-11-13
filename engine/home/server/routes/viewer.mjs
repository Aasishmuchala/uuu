// PLAN-V5 K15 (the home server's part, T52b): the Page viewer section of Settings. The switch and the viewer's own
// state: whether it runs, whether it found Chrome and which version, and what it counted today. The switch is the
// only door here into two agents' fences (the Builder's and the Art director's), so it is written only through
// lib/doors.mjs (updateDoors), only by the owner's same-origin POST (the core refuses any other), and on only while
// the viewer answers, has Chrome and both agents are set up; off is always taken. Everything read from the viewer
// (its health answer, its status file) is checked and capped: the version is cut to plain letters, digits and a few
// marks; the counts are whole numbers. The owner's Test, the pictures and the preview are T52's (routes/sites.mjs).
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { readIds } from "../../../relay/state.mjs";
import { callDoor, readDoors, readTrustedText, updateDoors } from "../lib/doors.mjs";

const HEALTH_TIMEOUT_MS = 1000;
const STATUS_MAX_BYTES = 64 * 1024;
const VERSION_MAX = 60;
// The two agents the viewer lets in (config.json doors.viewer.agents).
export const VIEWER_AGENTS = Object.freeze(["builder", "art-director"]);

export const DOOR_SENTENCES = {
  on: "The page viewer is running.",
  off: "The page viewer is off. Run: engine start",
  unhealthy: "The page viewer is running but not answering. Run: engine stop, then engine start.",
  not_installed: "The page viewer is not installed yet.",
};
export const PROBLEM_SENTENCES = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
};
// Why the switch cannot be turned on, in the order they are checked.
export const BLOCKER_SENTENCES = {
  door_off: "The page viewer is off. Run: engine start",
  no_chrome: "No Chrome was found on this Mac.",
  no_agents: "Run engine setup first, then try again.",
};

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bodyOf = (ctx) => (obj(ctx.body) ? ctx.body : {});
const count = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 1e9) : 0);
// The engine's day, as the viewer counts it (Asia/Kolkata).
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));

function installed(config) {
  try { return lstatSync(join(config.engineDir, "viewer", "READY")).isFile(); } catch { return false; }
}

// Chrome's version as the viewer said it, cut to [A-Za-z0-9 ./()-] and 60 characters; null when nothing is left.
export function plainVersion(v) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[^A-Za-z0-9 ./()-]/g, "").trim().slice(0, VERSION_MAX).trim();
  return t || null;
}

// The viewer's own state (on, off, unhealthy or not installed) and Chrome as its health says, asked for at most one
// second without a token. Chrome is unknown (null) while the viewer does not answer. A null address (a stub home)
// is off and nothing is called.
async function doorOf(ctx) {
  const r = await callDoor(ctx, "viewer", "/view/health", null, { auth: false, timeoutMs: HEALTH_TIMEOUT_MS, maxBytes: 4096 });
  let state;
  if (r.ok) state = r.status === 200 && obj(r.json) && r.json.part === "viewer" ? "on" : "unhealthy";
  else if (r.reason === "cut") state = "unhealthy";
  else if (r.reason === "no_address") state = "off";
  else state = installed(ctx.config) ? "off" : "not_installed";
  const chrome = state === "on"
    ? { found: r.json.chrome === true, version: r.json.chrome === true ? plainVersion(r.json.version) : null }
    : { found: null, version: null };
  return { door: { state, sentence: DOOR_SENTENCES[state] }, chrome };
}

function agentsSetUp(config) {
  const ids = readIds(config.paths.ids);
  return !!ids && VIEWER_AGENTS.every((slug) => typeof ids[slug] === "string");
}

// What the viewer counted today and whether it is opening a site now, from its status file: zeros when the file
// is missing, untrusted, too large, odd or of another day. `busy` only while the viewer answers (a viewer that
// stopped mid-render leaves `busy` in its file).
function statusOf(config, running) {
  const zero = { today: { renders: 0, refused: 0 }, busy: false };
  const text = readTrustedText(config.paths.viewerStatus, STATUS_MAX_BYTES);
  if (typeof text !== "string" || text === "missing") return zero;
  let d;
  try { d = JSON.parse(text); } catch { return zero; }
  if (!obj(d)) return zero;
  const busy = running && d.busy === true;
  if (!obj(d.today) || d.today.day !== dayOf(Date.now())) return { ...zero, busy };
  return { today: { renders: count(d.today.renders), refused: count(d.today.refused) }, busy };
}

export async function buildViewerView(ctx) {
  const config = ctx.config;
  const { state, problem } = readDoors(config);
  const { door, chrome } = await doorOf(ctx);
  const { today, busy } = statusOf(config, door.state === "on");
  const blockers = [];
  if (door.state !== "on") blockers.push("door_off");
  else if (chrome.found !== true) blockers.push("no_chrome");
  if (!agentsSetUp(config)) blockers.push("no_agents");
  return {
    on: problem ? false : state.viewer.on,
    door,
    chrome,
    today,
    busy,
    canSwitchOn: blockers.length === 0,
    blockers,
    whyNot: blockers.length ? BLOCKER_SENTENCES[blockers[0]] : null,
    problem: problem || null,
    problemSentence: problem ? PROBLEM_SENTENCES[problem] || null : null,
  };
}

// ---- the routes --------------------------------------------------------------------------------------------------

export default function register(app) {
  app.get("/api/viewer", (ctx) => buildViewerView(ctx));

  app.post("/api/viewer/switch", async (ctx) => {
    const on = bodyOf(ctx).on;
    if (typeof on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Switch the page viewer on or off.", "bad_switch");
    if (on) {
      const view = await buildViewerView(ctx);
      if (!view.canSwitchOn) {
        return {
          status: 409,
          body: { error: { message: "The page viewer cannot be switched on yet.", next: view.whyNot, code: "cannot_switch_on", blockers: view.blockers } },
        };
      }
    }
    // updateDoors forgets the jobs' needs at once, so "The page viewer is off" on a job follows the switch.
    updateDoors(ctx.config, (s) => { s.viewer.on = on; });
    ctx.log(`viewer: switched ${on ? "on" : "off"}`);
    return buildViewerView(ctx);
  });
}
