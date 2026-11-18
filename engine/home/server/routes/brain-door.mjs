// PLAN-BRAIN T14 (B10, the last three routes): the Brain section of Settings. The switch that lets the eleven
// listed agents ask the brain door, the owner's Test question, and what was asked. The switch is written only through
// lib/doors.mjs (updateDoors), only by the owner's same-origin POST (the core refuses any other); on only while the
// part is installed (`engine/brain/READY`) and answers; off is always taken. Everything read from the door's own
// files (brain-asks.jsonl) is checked and capped again here: a line that is not JSON, or not an object of the known
// shape, is skipped; text is cut to one plain line.
// The tidy-up switch (the owner's answer 1): whether the Chief of staff's routine may leave tidy-up notes in Needs
// you (inbox/brain.mjs setSuggestionsOn), off by default, its words sent from here. It writes nothing to the brain.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { callDoor, readDoors, readTrustedText, updateDoors } from "../lib/doors.mjs";
import { indexFor } from "../brain/indexer.mjs";
import { setSuggestionsOn, suggestionsOn } from "../inbox/brain.mjs";

const HEALTH_TIMEOUT_MS = 1000;
const ASK_TIMEOUT_MS = 20000;
const ASK_MAX_BYTES = 256 * 1024;
const ASKS_FILE_MAX = 4 * 1024 * 1024;
const ASKS_SHOWN = 50;
const Q_MIN = 2;
const Q_MAX = 400;
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const DOOR_SENTENCES = {
  on: "The brain door is running.",
  off: "The brain door is off. Run: engine start",
  unhealthy: "The brain door is running but not answering. Run: engine stop, then engine start.",
  not_installed: "The brain door is not installed yet.",
};
export const PROBLEM_SENTENCES = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
};

export const TIDY_WORDS = {
  label: "Agents may suggest tidy-ups",
  on: "On. The Chief of staff's routine Tidy-up suggestions may leave notes about your files in Needs you. Nothing in your files changes unless you edit them yourself. The routine itself is started and paused on the Routines page.",
  off: "Off. Only the home screen's own checks suggest tidy-ups in Needs you.",
};
const tidyOf = (ctx) => {
  const on = suggestionsOn(ctx);
  return { on, label: TIDY_WORDS.label, say: on ? TIDY_WORDS.on : TIDY_WORDS.off };
};

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bodyOf = (ctx) => (obj(ctx.body) ? ctx.body : {});
const whole = (v, max) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);
// One plain line: control, line-break and invisible characters become spaces, runs squeezed, at most n characters.
const oneLine = (v, n) => String(v ?? "")
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);

function installed(config) {
  try { return lstatSync(join(config.engineDir, "brain", "READY")).isFile(); } catch { return false; }
}

// The door's state asked for at most one second, without a token: on, off, unhealthy or not installed.
async function doorOf(ctx) {
  const r = await callDoor(ctx, "brain", "/brain/health", null, { auth: false, timeoutMs: HEALTH_TIMEOUT_MS, maxBytes: 4096 });
  let state;
  if (r.ok) state = r.status === 200 && obj(r.json) && r.json.part === "brain" ? "on" : "unhealthy";
  else if (r.reason === "cut") state = "unhealthy";
  else state = installed(ctx.config) ? "off" : "not_installed";
  return { state, sentence: DOOR_SENTENCES[state] };
}

// The newest lines of brain-asks.jsonl, newest first, each field checked and capped. A line that is not JSON, not
// an object, or without a time, a known kind or a name is skipped. A file the door's rules would not trust is empty.
export function readAsks(config, limit = ASKS_SHOWN) {
  const text = readTrustedText(config.paths.brainAsks, ASKS_FILE_MAX);
  if (typeof text !== "string" || text === "missing") return [];
  const out = [];
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    if (!lines[i]) continue;
    let d;
    try { d = JSON.parse(lines[i]); } catch { continue; }
    if (!obj(d)) continue;
    const agent = typeof d.agent === "string" ? oneLine(d.agent, 40) : "";
    if (typeof d.at !== "string" || !AGENT_NAME.test(agent) || (d.kind !== "ask" && d.kind !== "notes")) continue;
    out.push({
      at: oneLine(d.at, 40),
      agent,
      kind: d.kind,
      q: typeof d.q === "string" ? oneLine(d.q, 200) : null,
      status: whole(d.status, 999),
      results: whole(d.results, 1000),
    });
  }
  return out;
}

export async function buildBrainDoorView(ctx) {
  const config = ctx.config;
  const { state, problem } = readDoors(config);
  const door = await doorOf(ctx);
  let index = null;
  try { index = indexFor(config).status(); } catch { index = null; }
  const agents = Array.isArray(config.doors?.brain?.agents)
    ? config.doors.brain.agents.filter((a) => typeof a === "string" && AGENT_NAME.test(a)) : [];
  return {
    on: problem ? false : state.brain.on,
    installed: door.state === "on" || installed(config),
    answering: door.state === "on",
    door,
    agents,
    index,
    asks: readAsks(config),
    tidy: tidyOf(ctx),
    canSwitchOn: door.state === "on",
    whyNot: door.state === "on" ? null : door.sentence,
    problem: problem || null,
    problemSentence: problem ? PROBLEM_SENTENCES[problem] || null : null,
  };
}

export default function register(app) {
  app.get("/api/brain-door", (ctx) => buildBrainDoorView(ctx));

  app.post("/api/brain-door/switch", async (ctx) => {
    const on = bodyOf(ctx).on;
    if (typeof on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Switch the brain door on or off.", "bad_switch");
    if (on) {
      const door = await doorOf(ctx);
      if (door.state !== "on") {
        const message = door.state === "not_installed" ? DOOR_SENTENCES.not_installed : "The brain door is not answering.";
        return { status: 409, body: { error: { message, next: door.state === "not_installed" ? null : door.sentence, code: "cannot_switch_on" } } };
      }
    }
    updateDoors(ctx.config, (s) => { s.brain.on = on; });
    ctx.log(`brain door: switched ${on ? "on" : "off"}`);
    return buildBrainDoorView(ctx);
  });

  app.post("/api/brain-door/tidy", (ctx) => {
    const on = bodyOf(ctx).on;
    if (typeof on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Switch tidy-up suggestions on or off.", "bad_switch");
    setSuggestionsOn(ctx, on);
    ctx.log(`brain tidy-ups: agents' suggestions switched ${on ? "on" : "off"}`);
    return buildBrainDoorView(ctx);
  });

  // The owner's question, through the door with the owner's token; the door's answer is passed through.
  app.post("/api/brain-door/test", async (ctx) => {
    const q = bodyOf(ctx).q;
    if (typeof q !== "string" || q.trim().length < Q_MIN || q.length > Q_MAX) {
      throw ctx.fail(400, "Type a question of two to 400 letters.", "Add a few words, then try again.", "bad_question");
    }
    const r = await callDoor(ctx, "brain", "/brain/ask", { q: q.trim() }, { timeoutMs: ASK_TIMEOUT_MS, maxBytes: ASK_MAX_BYTES });
    if (!r.ok) throw ctx.fail(409, "The brain door is not answering.", "Run: engine start", "brain_door_down");
    if (r.status === 200 && obj(r.json)) return r.json;
    const e = obj(r.json) ? r.json : {};
    return {
      status: r.status >= 400 && r.status < 600 ? r.status : 502,
      body: { error: { message: oneLine(e.error, 300) || "The brain door could not answer.", next: null, code: oneLine(e.code, 40) || "brain_door_error" } },
    };
  });
}
