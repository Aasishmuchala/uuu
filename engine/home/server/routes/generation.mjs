// PLAN-V5 K13 (the home server's part, T41): the Generation section of Settings. The switch, the Runway key, the
// two spending limits, the four models, the owner's Test through the generation door, "Start again" after the
// door paused itself, the approved batches and what was spent. Every change is the owner's same-origin POST (the
// core refuses any other); the switches file and the key are written only through lib/doors.mjs. The key comes in
// here from the owner's typing and goes out nowhere: no answer, no error and no log line holds it, and nothing the
// owner typed is ever sent back. Money is read only from the door's ledger and priced only with the door's table
// (lib/generation.mjs); the home server never writes the ledger. The automatic allowance for small jobs is not
// offered (C5): every write here keeps it at 0, so nothing is made without the owner's yes.
//
// Higgsfield (PLAN-V5 K20, K21, K23; T79): its switch (off by default, on only once signed in) and its rate (what one
// of its credits counts as, in cents) live in the same switches file. Its sign-in is the generation door's: the home
// server only passes the owner's browser along (begin answers the door's authorize address, which the page opens; the
// return address hands `code` and `state` to the door's finish and nothing else), so it never sees, keeps or logs a
// Higgsfield token, and the return's query is never logged. Whether Higgsfield is signed in comes from the door (its
// health, else its status file); the door's token file is never read here.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { HF_ORIGIN, HF_PATHS } from "../../../generate/higgsfield.mjs";
import { rowOf } from "../../../generate/registry.mjs";
import { readGenState } from "../../../generate/state.mjs";
import { readIds } from "../../../relay/state.mjs";
import {
  callDoor, doorKeySaved, hfRateOk, holdsSavedKey, readDoors, readTrustedText, removeDoorKey, saveDoorKey, updateDoors, validDoorKey,
} from "../lib/doors.mjs";
import {
  BATCHES_SHOWN, MODEL_FIELDS, appNames, batchView, exampleSentence, isDay, ledgerPage, modelChoices, moneyOf, plain, readBatches,
  readLedgerFile, spentByBatch,
} from "../lib/generation.mjs";
import { loadIssues } from "../lib/goals.mjs";

const TEST_TIMEOUT_MS = 45000;
const HF_TEST_TIMEOUT_MS = 75000;
const HF_CALL_TIMEOUT_MS = 30000;
const HEALTH_TIMEOUT_MS = 1000;
const STATUS_MAX_BYTES = 256 * 1024;
const URL_MAX = 4096;
export const MAX_CAP = 1_000_000;
// K21's patterns for what Higgsfield sends back to the return address: `state` is 32 random bytes in hex.
export const HF_CODE_RE = /^[A-Za-z0-9._~-]{1,512}$/;
export const HF_STATE_RE = /^[0-9a-f]{64}$/;
export const HF_BACK_CONNECTED = "/#/settings?generation=connected";
export const HF_BACK_FAILED = "/#/settings?generation=failed";
// A stand-in Higgsfield in tests listens on 127.0.0.1; anything else is Higgsfield's one origin.
const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;

export const HF_SENTENCES = Object.freeze({
  signedOut: "Not signed in.",
  signedIn: "Signed in.",
  refused: "Higgsfield asked you to sign in again.",
});
export const HF_SWITCH_REFUSED = "Sign in to Higgsfield first.";
export const HF_TEST_SENTENCES = Object.freeze({
  signed_out: "Not signed in to Higgsfield.",
  refused: "Higgsfield asked you to sign in again.",
  door_off: "The generation door is off. Run: engine start",
  no_answer: "Higgsfield did not answer. Try again in a minute.",
});
export const HF_NOT_READY_MODEL = "Higgsfield is off or not signed in, so its models cannot be chosen.";

export const DOOR_SENTENCES = {
  on: "The generation door is running.",
  off: "The generation door is off. Run: engine start",
  unhealthy: "The generation door is running but not answering. Run: engine stop, then engine start.",
  not_installed: "The generation door is not installed yet.",
};
export const PROBLEM_SENTENCES = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
};
// Why the switch cannot be turned on, in the order they are checked.
export const BLOCKER_SENTENCES = {
  no_key: "Paste your Runway key first.",
  door_off: "The generation door is off. Run: engine start",
  no_artist: "Run engine setup first, then try again.",
};
export const TEST_SENTENCES = {
  no_key: "No key yet. Paste the one from your Runway developer account.",
  key_refused: "Runway refused this key.",
  limited: "Runway says too many requests for now. Try again in a minute.",
  door_off: "The generation door is off. Run: engine start",
  no_answer: "Runway did not answer. Try again in a minute.",
};
const CAP_FIELDS = { daily: "dailyCredits", monthly: "monthlyCredits" };
const CAP_WORDS = { daily: "Most to spend in a day", monthly: "Most to spend in a month" };

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bodyOf = (ctx) => (obj(ctx.body) ? ctx.body : {});
const count = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e12;

function installed(config) {
  try { return lstatSync(join(config.engineDir, "generate", "READY")).isFile(); } catch { return false; }
}

// The door's own state: on, off, unhealthy or not installed, from its health for at most one second. A null address
// (a stub home) is off and nothing is called.
async function doorOf(ctx) {
  const r = await callDoor(ctx, "generate", "/gen/health", null, { auth: false, timeoutMs: HEALTH_TIMEOUT_MS, maxBytes: 4096 });
  let state;
  if (r.ok) state = r.status === 200 && obj(r.json) && r.json.part === "generate" ? "on" : "unhealthy";
  else if (r.reason === "cut") state = "unhealthy";
  else if (r.reason === "no_address") state = "off";
  else state = installed(ctx.config) ? "off" : "not_installed";
  return { state, sentence: DOOR_SENTENCES[state], health: state === "on" ? r.json : null };
}

// Whether the door is signed in to Higgsfield: { signedIn, refused }. Its status file (read with the trust rule) says
// both; its health, when it answers, says now whether it is signed in. Neither: signed out.
export function hfAuthOf(config, health = null) {
  let d = null;
  try {
    const text = readTrustedText(config.paths.generateStatus, STATUS_MAX_BYTES);
    d = typeof text === "string" && text !== "missing" ? JSON.parse(text) : null;
  } catch { d = null; }
  const h = obj(d) && obj(d.higgsfield) ? d.higgsfield : {};
  const refused = h.refused === true;
  let signedIn = !refused && h.signedIn === true;
  if (obj(health) && typeof health.higgsfield === "boolean") signedIn = health.higgsfield && !refused;
  return { signedIn, refused: refused && !signedIn };
}

const hfSentence = (a) => (a.refused ? HF_SENTENCES.refused : a.signedIn ? HF_SENTENCES.signedIn : HF_SENTENCES.signedOut);

// Higgsfield's one origin, or a stand-in's loopback origin that a test home names (`home.higgsfieldOrigin`).
function hfOrigin(ctx) {
  const o = ctx?.home?.higgsfieldOrigin;
  return typeof o === "string" && LOOPBACK_ORIGIN.test(o) ? o : HF_ORIGIN;
}

function artistSetUp(config) {
  const ids = readIds(config.paths.ids);
  return !!ids && typeof ids.artist === "string";
}

// The board's tasks of these ids, as { id, identifier, title } in plain text; none when the board cannot be asked.
async function tasksById(ctx, wanted) {
  const out = new Map();
  if (!wanted.size) return out;
  try {
    const known = ctx.ids();
    if (!known || typeof known.companyId !== "string") return out;
    for (const i of await loadIssues(ctx, known.companyId)) {
      if (!obj(i) || typeof i.id !== "string" || !wanted.has(i.id)) continue;
      out.set(i.id, { id: i.id, identifier: typeof i.identifier === "string" ? plain(i.identifier, 40) : null, title: plain(i.title, 200) });
    }
  } catch {
    // The board is off or answered oddly: the batches are listed without their tasks.
  }
  return out;
}

// A last guard on an answer built from files: no string in it holds a saved key or a piece of one. Each value has a
// strict form, so in practice nothing is ever emptied here.
function guarded(config, answer) {
  if (!holdsSavedKey(config, JSON.stringify(answer))) return answer;
  const walk = (v) => {
    if (typeof v === "string") return holdsSavedKey(config, v) ? "" : v;
    if (Array.isArray(v)) return v.map(walk);
    if (obj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(answer);
}

// The money as of `now` (lib/generation.mjs moneyOf), with the pause: the door's own (a ledger line after the owner's
// last "Start again", read as the door reads it) or the switches file's own `paused`.
function moneyNow(config, state, lines, now) {
  const gs = readGenState(config.paths.doorsState, now);
  return moneyOf(lines, now, {
    daily: state.generate.dailyCredits, monthly: state.generate.monthlyCredits,
    resumedAt: gs.ok ? gs.resumedAt : null, ownPause: state.generate.paused !== null,
  });
}

export async function buildGenerationView(ctx, now = Date.now()) {
  const config = ctx.config;
  const { state, problem } = readDoors(config);
  const g = state.generate;
  const ledger = readLedgerFile(config);
  const money = moneyNow(config, state, ledger.lines, now);
  const keySaved = doorKeySaved(config, "runway");
  const all = readBatches(config, now).slice(0, BATCHES_SHOWN);
  const [door, tasks] = await Promise.all([doorOf(ctx), tasksById(ctx, new Set(all.map((b) => b.task).filter(Boolean)))]);
  const spent = ledger.lines === null ? null : spentByBatch(ledger.lines);
  const hfAuth = hfAuthOf(config, door.health);
  const rate = g.higgsfield.centsPerCredit;
  const hfOn = problem ? false : g.higgsfield.on;
  const blockers = [];
  if (!keySaved) blockers.push("no_key");
  if (door.state !== "on") blockers.push("door_off");
  if (!artistSetUp(config)) blockers.push("no_artist");
  return guarded(config, {
    on: problem ? false : g.on,
    key: { saved: keySaved },
    door: { state: door.state, sentence: door.sentence },
    canSwitchOn: blockers.length === 0,
    blockers,
    whyNot: blockers.length ? BLOCKER_SENTENCES[blockers[0]] : null,
    higgsfield: { on: hfOn, signedIn: hfAuth.signedIn, refused: hfAuth.refused, centsPerCredit: rate, sentence: hfSentence(hfAuth) },
    caps: { daily: g.dailyCredits, monthly: g.monthlyCredits },
    models: { ...g.models },
    choices: modelChoices({ centsPerCredit: rate, higgsfield: hfOn && hfAuth.signedIn }),
    spent: money.spent,
    paused: money.paused,
    example: exampleSentence(g.models, { centsPerCredit: rate }),
    ledger: ledger.file,
    batches: all.map((b) => batchView(b, {
      spent: spent === null ? null : spent.get(b.id) || 0,
      task: (b.task && tasks.get(b.task)) || null,
      now,
    })),
    problem: problem || null,
    problemSentence: problem ? PROBLEM_SENTENCES[problem] || null : null,
  });
}

// ---- the owner's test ------------------------------------------------------------------------------------------

// The door's answer to the owner's balance question, in words. Only the door's own codes are read, never its text.
function testOf(r) {
  const no = (outcome) => ({ outcome, answer: { ok: false, balance: null, monthlyMax: null, sentence: TEST_SENTENCES[outcome] } });
  if (!r.ok) return no(["no_address", "no_connection", "no_secret", "nothing"].includes(r.reason) ? "door_off" : "no_answer");
  const j = obj(r.json) ? r.json : {};
  if (r.status === 200 && count(j.creditBalance)) {
    const n = j.creditBalance;
    return {
      outcome: "balance",
      answer: { ok: true, balance: n, monthlyMax: count(j.maxMonthlyCreditSpend) ? j.maxMonthlyCreditSpend : null, sentence: `Runway says you have ${n} credit${n === 1 ? "" : "s"}.` },
    };
  }
  if (j.code === "gen_no_key") return no("no_key");
  if (j.code === "gen_key_refused") return no("key_refused");
  if (j.code === "gen_limited") return no("limited");
  return no("no_answer");
}

const doorOff = (r) => !r.ok && ["no_address", "no_connection", "no_secret", "nothing"].includes(r.reason);

// The door's answer to the owner's Higgsfield balance question (K21 `balance`), in words; only its codes are read.
function hfTestOf(r) {
  const no = (outcome) => ({ outcome, answer: { ok: false, credits: null, plan: null, sentence: HF_TEST_SENTENCES[outcome] } });
  if (!r.ok) return no(doorOff(r) ? "door_off" : "no_answer");
  const j = obj(r.json) ? r.json : {};
  if (r.status === 200 && typeof j.credits === "number" && Number.isFinite(j.credits) && j.credits >= 0 && j.credits <= 1e12) {
    const n = j.credits;
    const plan = typeof j.plan === "string" && /^[A-Za-z0-9 ._-]{1,40}$/.test(j.plan) ? j.plan : null;
    return { outcome: "balance", answer: { ok: true, credits: n, plan, sentence: `Higgsfield says you have ${n} credit${n === 1 ? "" : "s"}.` } };
  }
  if (j.code === "gen_hf_signed_out") return no("signed_out");
  if (j.code === "gen_hf_refused") return no("refused");
  return no("no_answer");
}

// What the generation door said to a Higgsfield call, as a refusal of the home server's own: the door off, or Higgsfield
// not answering as it should.
function hfCallFailed(ctx, r, what) {
  if (doorOff(r)) return ctx.fail(409, "The generation door is off. Run: engine start", "Start the engine, then try again.", "door_off");
  return ctx.fail(502, `Higgsfield did not ${what}. Try again in a minute.`, "If it keeps happening, look at Health.", "higgsfield_failed");
}

// ---- the routes --------------------------------------------------------------------------------------------------

const badRequest = (ctx) => ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");

export default function register(app) {
  app.get("/api/generation", (ctx) => buildGenerationView(ctx));

  app.post("/api/generation/switch", async (ctx) => {
    const on = bodyOf(ctx).on;
    if (typeof on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Switch generation on or off.", "bad_switch");
    if (on) {
      const view = await buildGenerationView(ctx);
      if (!view.canSwitchOn) {
        return {
          status: 409,
          body: { error: { message: "Generation cannot be switched on yet.", next: view.whyNot, code: "cannot_switch_on", blockers: view.blockers } },
        };
      }
    }
    updateDoors(ctx.config, (s) => { s.generate.on = on; s.generate.autoUnderCredits = 0; });
    ctx.log(`generation: switched ${on ? "on" : "off"}`);
    return buildGenerationView(ctx);
  });

  app.post("/api/generation/caps", async (ctx) => {
    const b = bodyOf(ctx);
    const keys = Object.keys(b);
    if (!keys.length || !keys.every((k) => Object.hasOwn(CAP_FIELDS, k))) throw badRequest(ctx);
    for (const field of Object.keys(CAP_FIELDS)) {
      if (!Object.hasOwn(b, field)) continue;
      const v = b[field];
      if (!Number.isInteger(v) || v < 0 || v > MAX_CAP) {
        return {
          status: 400,
          body: {
            error: { message: `"${CAP_WORDS[field]}" must be from $0 to $10,000, in whole cents.`, next: "Type an amount in dollars, such as 3.", code: "bad_cap" },
            field,
          },
        };
      }
    }
    updateDoors(ctx.config, (s) => {
      for (const field of keys) s.generate[CAP_FIELDS[field]] = b[field];
      s.generate.autoUnderCredits = 0;
    });
    ctx.log(`generation: the limits were changed (${keys.map((k) => `${k} ${b[k]}`).join(", ")})`);
    return buildGenerationView(ctx);
  });

  app.post("/api/generation/models", async (ctx) => {
    const b = bodyOf(ctx);
    const keys = Object.keys(b);
    if (!keys.length || !keys.every((k) => MODEL_FIELDS.includes(k))) throw badRequest(ctx);
    // A Higgsfield model only while Higgsfield is on and signed in (K20); the door refuses it at job time anyway.
    const { state, problem } = readDoors(ctx.config);
    const hfReady = !problem && state.generate.higgsfield.on && hfAuthOf(ctx.config, (await doorOf(ctx)).health).signedIn;
    const choices = modelChoices({ centsPerCredit: state.generate.higgsfield.centsPerCredit, higgsfield: hfReady });
    for (const field of MODEL_FIELDS) {
      if (!Object.hasOwn(b, field)) continue;
      if (!hfReady && rowOf(b[field])?.provider === "higgsfield") {
        return {
          status: 400,
          body: { error: { message: HF_NOT_READY_MODEL, next: "Switch Higgsfield on and sign in to it, then choose again.", code: "bad_model" }, field },
        };
      }
      if (typeof b[field] !== "string" || !choices[field].some((c) => c.model === b[field])) {
        return {
          status: 400,
          body: { error: { message: "The door has no price for this model.", next: "Choose one of the models listed.", code: "bad_model" }, field },
        };
      }
    }
    updateDoors(ctx.config, (s) => {
      for (const field of keys) s.generate.models[field] = b[field];
      s.generate.autoUnderCredits = 0;
    });
    ctx.log(`generation: the models were changed (${keys.map((k) => `${k} ${b[k]}`).join(", ")})`);
    return buildGenerationView(ctx);
  });

  app.post("/api/generation/key", async (ctx) => {
    const key = validDoorKey("runway", bodyOf(ctx).key);
    if (key === null) {
      throw ctx.fail(400, "That is not a Runway key. A Runway key starts key_ and has 128 more letters and digits.",
        "Copy the whole key from your Runway developer account and paste it again.", "bad_key");
    }
    saveDoorKey(ctx.config, "runway", key);
    ctx.log("generation: a Runway key was saved");
    return { saved: true };
  });

  app.post("/api/generation/key/remove", async (ctx) => {
    removeDoorKey(ctx.config, "runway");
    ctx.log("generation: the Runway key was removed");
    return { saved: false };
  });

  app.post("/api/generation/test", async (ctx) => {
    const r = await callDoor(ctx, "generate", "/gen/owner/balance", {}, { timeoutMs: TEST_TIMEOUT_MS, maxBytes: 64 * 1024 });
    const { outcome, answer } = testOf(r);
    ctx.log(`generation: tested (${outcome})`);
    return answer;
  });

  app.post("/api/generation/resume", async (ctx) => {
    const now = Date.now();
    const { state } = readDoors(ctx.config);
    const { paused } = moneyNow(ctx.config, state, readLedgerFile(ctx.config).lines, now);
    if (paused === null) throw ctx.fail(409, "Generation is not paused.", "Nothing needs starting again.", "not_paused");
    updateDoors(ctx.config, (s) => {
      s.generate.resumedAt = new Date(now).toISOString();
      s.generate.paused = null;
      s.generate.autoUnderCredits = 0;
    });
    ctx.log("generation: started again after a pause");
    return buildGenerationView(ctx);
  });

  app.get("/api/generation/ledger", async (ctx) => {
    const before = ctx.query.before;
    if (before !== undefined && !isDay(before)) throw ctx.fail(400, "That is not a day this list knows.", "Refresh the page and try again.", "bad_before");
    const { file, lines } = readLedgerFile(ctx.config);
    if (lines === null) return { ok: false, sentence: file.sentence, days: [], more: false };
    // A job's task is its batch's goal, as the board names it; a batch file gone (30 days past its expiry) names none.
    const goals = new Map(readBatches(ctx.config, Date.now()).map((b) => [b.id, b.task]));
    const page = ledgerPage(lines, { before: before ?? null, taskOf: (batch) => goals.get(batch) || null, appNames: appNames(ctx.config) });
    const tasks = await tasksById(ctx, new Set(page.days.flatMap((d) => d.rows.map((r) => r.task)).filter(Boolean)));
    for (const d of page.days) {
      for (const row of d.rows) {
        const t = row.task === null ? undefined : tasks.get(row.task);
        row.task = t ? { id: t.id, identifier: t.identifier } : null;
      }
    }
    return guarded(ctx.config, { ok: true, sentence: null, ...page });
  });

  // ---- Higgsfield (K20, K21, K23) ------------------------------------------------------------------------------

  app.post("/api/generation/higgsfield/switch", async (ctx) => {
    const b = bodyOf(ctx);
    if (Object.keys(b).length !== 1 || typeof b.on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Switch Higgsfield on or off.", "bad_switch");
    if (b.on) {
      const auth = hfAuthOf(ctx.config, (await doorOf(ctx)).health);
      if (!auth.signedIn) {
        return { status: 409, body: { error: { message: HF_SWITCH_REFUSED, next: "Press Sign in to Higgsfield, then switch it on.", code: "cannot_switch_on" } } };
      }
    }
    updateDoors(ctx.config, (s) => { s.generate.higgsfield = { ...s.generate.higgsfield, on: b.on }; s.generate.autoUnderCredits = 0; });
    ctx.log(`generation: Higgsfield switched ${b.on ? "on" : "off"}`);
    return buildGenerationView(ctx);
  });

  app.post("/api/generation/higgsfield/rate", async (ctx) => {
    const b = bodyOf(ctx);
    if (Object.keys(b).length !== 1 || !hfRateOk(b.centsPerCredit)) {
      throw ctx.fail(400, "One Higgsfield credit must count as a whole number of cents from 1 to 50.", "Type a whole number, such as 5.", "bad_rate");
    }
    updateDoors(ctx.config, (s) => { s.generate.higgsfield = { ...s.generate.higgsfield, centsPerCredit: b.centsPerCredit }; s.generate.autoUnderCredits = 0; });
    ctx.log(`generation: one Higgsfield credit now counts as ${b.centsPerCredit} cents`);
    return buildGenerationView(ctx);
  });

  // The door's authorize address for the owner's browser, only when it is Higgsfield's own (K21): the page opens it.
  app.post("/api/generation/higgsfield/begin", async (ctx) => {
    const r = await callDoor(ctx, "generate", "/gen/owner/higgsfield/begin", {}, { timeoutMs: HF_CALL_TIMEOUT_MS, maxBytes: 16 * 1024 });
    const url = r.ok && r.status === 200 && obj(r.json) && typeof r.json.url === "string" ? r.json.url : null;
    if (url === null || url.length > URL_MAX || !url.startsWith(`${hfOrigin(ctx)}${HF_PATHS.authorize}?`)) {
      ctx.log(`generation: the Higgsfield sign-in did not begin (${r.ok ? r.status : r.reason})`);
      throw hfCallFailed(ctx, r, "start the sign-in");
    }
    ctx.log("generation: the Higgsfield sign-in began");
    return { url };
  });

  // Where Higgsfield sends the owner's browser back. `code` and `state`, each by K21's pattern, go to the door's finish
  // and nothing else does; the owner lands on Settings with a notice. The query is never logged (the core logs the path
  // alone, and this route names only the outcome).
  app.get("/api/generation/higgsfield/back", async (ctx) => {
    const { code, state } = ctx.query;
    let connected = false;
    if (typeof code === "string" && HF_CODE_RE.test(code) && typeof state === "string" && HF_STATE_RE.test(state)) {
      const r = await callDoor(ctx, "generate", "/gen/owner/higgsfield/finish", { code, state }, { timeoutMs: HF_CALL_TIMEOUT_MS, maxBytes: 16 * 1024 });
      connected = r.ok && r.status === 200 && obj(r.json) && r.json.connected === true;
    }
    ctx.log(`generation: the Higgsfield sign-in came back (${connected ? "connected" : "failed"})`);
    return { status: 303, location: connected ? HF_BACK_CONNECTED : HF_BACK_FAILED, body: { connected } };
  });

  app.post("/api/generation/higgsfield/forget", async (ctx) => {
    const r = await callDoor(ctx, "generate", "/gen/owner/higgsfield/forget", {}, { timeoutMs: HF_CALL_TIMEOUT_MS, maxBytes: 16 * 1024 });
    if (!(r.ok && r.status === 200 && obj(r.json) && r.json.connected === false)) throw hfCallFailed(ctx, r, "forget the sign-in");
    ctx.log("generation: signed out of Higgsfield");
    return buildGenerationView(ctx);
  });

  app.post("/api/generation/higgsfield/test", async (ctx) => {
    const r = await callDoor(ctx, "generate", "/gen/owner/higgsfield/balance", {}, { timeoutMs: HF_TEST_TIMEOUT_MS, maxBytes: 64 * 1024 });
    const { outcome, answer } = hfTestOf(r);
    ctx.log(`generation: Higgsfield tested (${outcome})`);
    return answer;
  });
}
