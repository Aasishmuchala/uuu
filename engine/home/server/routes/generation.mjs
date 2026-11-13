// PLAN-V5 K13 (the home server's part, T41): the Generation section of Settings. The switch, the Runway key, the
// two spending limits, the four models, the owner's Test through the generation door, "Start again" after the
// door paused itself, the approved batches and what was spent. Every change is the owner's same-origin POST (the
// core refuses any other); the switches file and the key are written only through lib/doors.mjs. The key comes in
// here from the owner's typing and goes out nowhere: no answer, no error and no log line holds it, and nothing the
// owner typed is ever sent back. Money is read only from the door's ledger and priced only with the door's table
// (lib/generation.mjs); the home server never writes the ledger. The automatic allowance for small jobs is not
// offered (C5): every write here keeps it at 0, so nothing is made without the owner's yes.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { readGenState } from "../../../generate/state.mjs";
import { readIds } from "../../../relay/state.mjs";
import { callDoor, doorKeySaved, holdsSavedKey, readDoors, removeDoorKey, saveDoorKey, updateDoors, validDoorKey } from "../lib/doors.mjs";
import {
  BATCHES_SHOWN, MODEL_FIELDS, batchView, exampleSentence, isDay, ledgerPage, modelChoices, moneyOf, plain, readBatches,
  readLedgerFile, spentByBatch,
} from "../lib/generation.mjs";
import { loadIssues } from "../lib/goals.mjs";

const TEST_TIMEOUT_MS = 45000;
const HEALTH_TIMEOUT_MS = 1000;
export const MAX_CAP = 1_000_000;

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
  return { state, sentence: DOOR_SENTENCES[state] };
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
  const blockers = [];
  if (!keySaved) blockers.push("no_key");
  if (door.state !== "on") blockers.push("door_off");
  if (!artistSetUp(config)) blockers.push("no_artist");
  return guarded(config, {
    on: problem ? false : g.on,
    key: { saved: keySaved },
    door,
    canSwitchOn: blockers.length === 0,
    blockers,
    whyNot: blockers.length ? BLOCKER_SENTENCES[blockers[0]] : null,
    caps: { daily: g.dailyCredits, monthly: g.monthlyCredits },
    models: { ...g.models },
    choices: modelChoices(),
    spent: money.spent,
    paused: money.paused,
    example: exampleSentence(g.models),
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
            error: { message: `"${CAP_WORDS[field]}" must be a whole number of credits from 0 to 1,000,000.`, next: "Type a whole number, such as 300.", code: "bad_cap" },
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
    const choices = modelChoices();
    for (const field of MODEL_FIELDS) {
      if (!Object.hasOwn(b, field)) continue;
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
    const page = ledgerPage(lines, { before: before ?? null, taskOf: (batch) => goals.get(batch) || null });
    const tasks = await tasksById(ctx, new Set(page.days.flatMap((d) => d.rows.map((r) => r.task)).filter(Boolean)));
    for (const d of page.days) {
      for (const row of d.rows) {
        const t = row.task === null ? undefined : tasks.get(row.task);
        row.task = t ? { id: t.id, identifier: t.identifier } : null;
      }
    }
    return guarded(ctx.config, { ok: true, sentence: null, ...page });
  });
}
