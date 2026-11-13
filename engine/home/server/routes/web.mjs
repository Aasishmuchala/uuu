// PLAN-V5 K11 (the home server's part): the Web section of Settings. The switch, the owner's three lists, the
// search choice and its key, the owner's Test through the web door, the list of what was opened, and what is
// shared with the Researcher. Every change is the owner's same-origin POST (the core refuses any other); the
// switches file and the key are written only through lib/doors.mjs, the shared folder only through
// lib/shared-brain.mjs. The search key comes in here from the owner's typing and goes out nowhere: no answer, no
// error and no log line holds it. What the door wrote (its status file, the visits) is read with the trust rule
// and capped, and every address in it is the Researcher's or a site's: it goes out only as plain capped text.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { readIds } from "../../../relay/state.mjs";
import { SLUG_RE } from "../../../relay/token.mjs";
import { readVisits } from "../../../web/state.mjs";
import {
  MAX_HOSTS, callDoor, doorKeySaved, holdsSavedKey, hostName, readDoors, readTrustedText, removeDoorKey, saveDoorKey, updateDoors,
  validDoorKey,
} from "../lib/doors.mjs";
import { listShared, share } from "../lib/shared-brain.mjs";

export const VISITS_PAGE = 100;
const VISIT_LINE_MAX = 4096;
const STATUS_MAX_BYTES = 64 * 1024;
const TEST_TIMEOUT_MS = 45000;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const WEB_CODE = /^web_[a-z_]{1,40}$/;
const KINDS = new Set(["fetch", "search", "watch"]);
const LIST_KEYS = ["allow", "block", "watchHosts"];
const LIST_WORDS = { allow: "Only these sites", block: "Never these sites", watchHosts: "Video sites it may watch" };

export const DOOR_SENTENCES = {
  on: "The web door is running.",
  off: "The web door is off. Run: engine start",
  unhealthy: "The web door is running but not answering. Run: engine stop, then engine start.",
  not_installed: "The web door is not installed yet.",
};
export const PROBLEM_SENTENCES = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
  folder_unsafe: "The folder shared with the Researcher is not a plain folder, so nothing more can be shared.",
  shared_unreadable: "The list of files shared with the Researcher could not be read.",
};
const NO_RESEARCHER = "Run engine setup first, then try again.";

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bodyOf = (ctx) => (obj(ctx.body) ? ctx.body : {});
const count = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 1e9) : 0);
const plain = (v, max) => String(v ?? "").replace(/[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/g, "").slice(0, max);
// The engine's day, as the web door counts it (Asia/Kolkata).
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));
// Owner test results, kept while the home server runs (never in the switches file the doors read).
const lastTests = new WeakMap();

function installed(config) {
  try { return lstatSync(join(config.engineDir, "web", "READY")).isFile(); } catch { return false; }
}

// The door's own state: on, off, unhealthy or not installed. A null address (a stub home) is off and nothing is called.
async function doorOf(ctx) {
  const r = await callDoor(ctx, "web", "/web/health", null, { auth: false, timeoutMs: 2000, maxBytes: 4096 });
  let state;
  if (r.ok) state = r.status === 200 && obj(r.json) && r.json.part === "web" ? "on" : "unhealthy";
  else if (r.reason === "cut") state = "unhealthy";
  else if (r.reason === "no_address") state = "off";
  else state = installed(ctx.config) ? "off" : "not_installed";
  return { state, sentence: DOOR_SENTENCES[state] };
}

function researcherSetUp(config) {
  const ids = readIds(config.paths.ids);
  return !!ids && typeof ids.researcher === "string";
}

// What the door counted today, from its status file: zeros when it is missing, untrusted, odd or of another day.
function todayOf(config) {
  const zero = { fetches: 0, searches: 0, watches: 0, refused: 0, lastAt: null };
  const text = readTrustedText(config.paths.webStatus, STATUS_MAX_BYTES);
  if (typeof text !== "string" || text === "missing") return zero;
  let d;
  try { d = JSON.parse(text); } catch { return zero; }
  const lastAt = obj(d) && typeof d.lastAt === "string" && ISO_TIME.test(d.lastAt) ? d.lastAt : null;
  if (!obj(d) || !obj(d.today) || d.today.day !== dayOf(Date.now())) return { ...zero, lastAt };
  const t = d.today;
  return { fetches: count(t.fetches), searches: count(t.searches), watches: count(t.watches), refused: count(t.refused), lastAt };
}

export async function buildWebView(ctx) {
  const config = ctx.config;
  const { state, problem } = readDoors(config);
  const w = state.web;
  const [door, shared] = await Promise.all([doorOf(ctx), Promise.resolve(listShared(config))]);
  const blockers = [];
  if (!researcherSetUp(config)) blockers.push("no_researcher");
  if (door.state !== "on") blockers.push("door_off");
  const code = problem || shared.problem || null;
  return {
    on: problem ? false : w.on,
    door,
    canSwitchOn: blockers.length === 0,
    blockers,
    whyNot: blockers.includes("no_researcher") ? NO_RESEARCHER : blockers.length ? door.sentence : null,
    search: w.search,
    searchKeySaved: doorKeySaved(config, "search"),
    allow: [...w.allow],
    block: [...w.block],
    watchHosts: [...w.watchHosts],
    caps: { perHour: w.perHour, perDay: w.perDay },
    today: todayOf(config),
    shared: shared.files,
    sharedTotals: { files: shared.totals.files, bytes: shared.totals.bytes, maxFiles: shared.limits.files, maxBytes: shared.limits.bytes },
    lastTest: lastTests.get(config) || null,
    changedAt: state.changedAt,
    problem: code,
    problemSentence: code ? PROBLEM_SENTENCES[code] || null : null,
  };
}

// ---- the visits ----------------------------------------------------------------------------------------------

// One line of the door's list as the page shows it, or null. The address is the Researcher's or a site's: plain
// text, invisible and control characters removed, at most 1024 characters. `calls` is how many calls the line
// stands for: 1, or for the door's line that counts an agent's further calls refused over its cap, that count.
function visitOf(line) {
  if (typeof line !== "string" || line.length > VISIT_LINE_MAX) return null;
  let v;
  try { v = JSON.parse(line); } catch { return null; }
  if (!obj(v) || typeof v.at !== "string" || !ISO_TIME.test(v.at) || !Number.isFinite(Date.parse(v.at)) || !KINDS.has(v.kind)) return null;
  let status = null;
  let code = null;
  let result;
  if (Number.isInteger(v.status) && v.status >= 100 && v.status <= 599) {
    status = v.status;
    result = status < 400 ? "ok" : "site_error";
  } else if (typeof v.status === "string" && WEB_CODE.test(v.status)) {
    code = v.status;
    result = code === "web_unreachable" ? "unreachable" : "refused";
  } else return null;
  return {
    at: v.at, kind: v.kind,
    slug: typeof v.slug === "string" && SLUG_RE.test(v.slug) ? v.slug : "unknown",
    url: plain(v.url, 1024),
    status, code, result,
    bytes: count(v.bytes),
    calls: Number.isInteger(v.calls) && v.calls >= 1 ? Math.min(v.calls, 1e9) : 1,
  };
}

// 100 visits older than `before` (all, without it), newest first. A page that ends inside a run of visits of the
// same time takes the rest of that run too, so "Show older" never skips one. The door's list (newest last) is read
// with the trust rule (a file of this user no one else may write, never through a link), and only its last 8 MB:
// a larger file still shows its newest visits.
function visitsPage(config, before) {
  const lines = readVisits(config.paths.webVisits, { strict: true }).lines;
  const limit = before === null ? Infinity : Date.parse(before);
  const out = [];
  let i = lines.length - 1;
  for (; i >= 0; i -= 1) {
    const v = visitOf(lines[i]);
    if (!v || !(Date.parse(v.at) < limit)) continue;
    if (out.length >= VISITS_PAGE && v.at !== out[out.length - 1].at) break;
    if (out.length >= VISITS_PAGE * 2) break;
    out.push(v);
  }
  let more = false;
  const last = out.length ? Date.parse(out[out.length - 1].at) : null;
  for (; i >= 0 && !more; i -= 1) {
    const v = visitOf(lines[i]);
    if (v && Date.parse(v.at) < limit && Date.parse(v.at) < last) more = true;
  }
  return { visits: out, more, next: more ? out[out.length - 1].at : null };
}

// ---- the owner's test ------------------------------------------------------------------------------------------

function fetchWords(f) {
  if (f.ok) return "Reading a page worked.";
  if (f.code === "web_unreachable") return "Reading a page did not work: the site could not be reached from this Mac.";
  if (f.code === "web_private_address") return "Reading a page did not work: the address led to a private network.";
  return "Reading a page did not work.";
}

function searchWords(s, fetchOk) {
  if (s.ok && s.results > 0) return s.provider === "brave" ? "Search with your Brave key worked." : "Search without an account worked.";
  if (s.ok) return "Search answered, but found nothing.";
  return fetchOk ? "Search is not answering. Reading a page by its address still works." : "Search is not answering either.";
}

// The door's answer of { fetch: {ok,status,code}, search: {ok,provider,results,code} }, every value checked.
function testOf(json) {
  if (!obj(json) || !obj(json.fetch) || !obj(json.search)) return null;
  const f = json.fetch;
  const s = json.search;
  const fetch = {
    ok: f.ok === true,
    status: Number.isInteger(f.status) && f.status >= 100 && f.status <= 599 ? f.status : null,
    code: typeof f.code === "string" && WEB_CODE.test(f.code) ? f.code : null,
  };
  const search = {
    ok: s.ok === true,
    provider: typeof s.provider === "string" && /^[a-z0-9-]{1,20}$/.test(s.provider) ? s.provider : null,
    results: Number.isInteger(s.results) && s.results >= 0 ? Math.min(s.results, 10) : 0,
    code: typeof s.code === "string" && WEB_CODE.test(s.code) ? s.code : null,
  };
  fetch.sentence = fetchWords(fetch);
  search.sentence = searchWords(search, fetch.ok);
  return { at: new Date().toISOString(), fetch, search, sentence: `${fetch.sentence} ${search.sentence}` };
}

// ---- the routes --------------------------------------------------------------------------------------------------

export default function register(app) {
  app.get("/api/web", (ctx) => buildWebView(ctx));

  app.post("/api/web/switch", async (ctx) => {
    const on = bodyOf(ctx).on;
    if (typeof on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Switch the web on or off.", "bad_switch");
    if (on) {
      const view = await buildWebView(ctx);
      if (!view.canSwitchOn) {
        return {
          status: 409,
          body: { error: { message: "The web cannot be switched on yet.", next: view.whyNot, code: "cannot_switch_on", blockers: view.blockers } },
        };
      }
    }
    updateDoors(ctx.config, (s) => { s.web.on = on; });
    ctx.log(`web: switched ${on ? "on" : "off"}`);
    return buildWebView(ctx);
  });

  app.post("/api/web/lists", async (ctx) => {
    const b = bodyOf(ctx);
    const keys = Object.keys(b);
    if (!keys.length || !keys.every((k) => LIST_KEYS.includes(k))) {
      throw ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");
    }
    const lists = {};
    for (const field of keys) {
      const list = b[field];
      if (!Array.isArray(list)) throw ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");
      if (list.length > MAX_HOSTS) {
        return { status: 400, body: { error: { message: `"${LIST_WORDS[field]}" can hold at most ${MAX_HOSTS} sites.`, next: "Remove some, then save again.", code: "too_many_hosts" }, field } };
      }
      const out = [];
      for (let index = 0; index < list.length; index += 1) {
        const h = hostName(list[index]);
        if (h === null) {
          const typed = typeof list[index] === "string" ? list[index].trim() : "";
          // The owner's own typing is named back, unless it holds a saved key (a key is never sent back).
          const host = holdsSavedKey(ctx.config, typed) ? "" : plain(typed, 80);
          const message = host ? `"${host}" is not a site name.` : "That is not a site name.";
          return {
            status: 400,
            body: { error: { message, next: "Type only the site's name, such as example.com.", code: "bad_host" }, field, index, host },
          };
        }
        if (!out.includes(h)) out.push(h);
      }
      lists[field] = out;
    }
    updateDoors(ctx.config, (s) => { Object.assign(s.web, lists); });
    ctx.log(`web: the lists were changed (${keys.map((k) => `${k} ${lists[k].length}`).join(", ")})`);
    return buildWebView(ctx);
  });

  app.post("/api/web/search", async (ctx) => {
    const choice = bodyOf(ctx).search;
    if (choice !== "keyless" && choice !== "brave") throw ctx.fail(400, "That is not a choice here.", "Choose search without an account, or with a Brave key.", "bad_search");
    if (choice === "brave" && !doorKeySaved(ctx.config, "search")) {
      throw ctx.fail(409, "No search key yet.", "Paste the key from your Brave Search account and save it first.", "no_key");
    }
    updateDoors(ctx.config, (s) => { s.web.search = choice; });
    ctx.log(`web: search is now ${choice === "brave" ? "with a Brave key" : "without an account"}`);
    return buildWebView(ctx);
  });

  app.post("/api/web/search-key", async (ctx) => {
    const key = validDoorKey("search", bodyOf(ctx).key);
    if (key === null) {
      throw ctx.fail(400, "That does not look like a search key.", "Copy the whole key from your Brave Search account and paste it again.", "bad_key");
    }
    saveDoorKey(ctx.config, "search", key);
    updateDoors(ctx.config, (s) => { s.web.search = "brave"; });
    ctx.log("web: a search key was saved");
    return buildWebView(ctx);
  });

  app.post("/api/web/search-key/remove", async (ctx) => {
    // Back to search without an account first, so the door never looks for a key that is gone.
    updateDoors(ctx.config, (s) => { s.web.search = "keyless"; });
    removeDoorKey(ctx.config, "search");
    ctx.log("web: the search key was removed");
    return buildWebView(ctx);
  });

  app.post("/api/web/test", async (ctx) => {
    const r = await callDoor(ctx, "web", "/web/owner/test", {}, { timeoutMs: TEST_TIMEOUT_MS, maxBytes: 64 * 1024 });
    if (!r.ok && ["no_address", "no_connection", "no_secret"].includes(r.reason)) {
      throw ctx.fail(409, "The web door is off, so nothing could be tested.", "Run: engine start, then try again.", "door_off");
    }
    const result = r.ok && r.status === 200 ? testOf(r.json) : null;
    if (!result) {
      throw ctx.fail(409, "The web door did not answer the test.", "Run: engine stop, then engine start. Then try again.", "test_failed");
    }
    lastTests.set(ctx.config, result);
    ctx.log(`web: tested (reading ${result.fetch.ok ? "worked" : "failed"}, search ${result.search.ok ? "worked" : "down"})`);
    return buildWebView(ctx);
  });

  app.get("/api/web/visits", (ctx) => {
    const before = ctx.query.before;
    if (before !== undefined && (typeof before !== "string" || !ISO_TIME.test(before) || !Number.isFinite(Date.parse(before)))) {
      throw ctx.fail(400, "That is not a time this list knows.", "Refresh the page and try again.", "bad_before");
    }
    return visitsPage(ctx.config, before === undefined ? null : before);
  });

  app.post("/api/web/share", async (ctx) => {
    const b = bodyOf(ctx);
    if (typeof b.token !== "string" || typeof b.share !== "boolean") {
      throw ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");
    }
    share(ctx.config, b.token, b.share);
    ctx.log(`web: a file was ${b.share ? "shared with" : "taken back from"} the Researcher`);
    return buildWebView(ctx);
  });
}
