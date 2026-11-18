// The guided first-run setup (PLAN-ONBOARD): GET /api/setup, what is done of the five steps and how the optional
// switches stand, worked out on every answer from what the engine already keeps. Read-only: it opens no secret,
// presses no Test, flips no switch and starts nothing. The login files are judged by lstat and realpath alone,
// the provider key by lstat alone; the books are asked two read-only questions through the home's own client.
// The only writes of the setup are the two display records of routes/setup.mjs (ctx.decisions).
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { readKitFile } from "../brain/kit.mjs";
import { listApps, readSwitches } from "./apps.mjs";
import { basics } from "./brainfiles.mjs";
import { readDoors } from "./doors.mjs";
import { goalsOf, loadIssues } from "./goals.mjs";
import { boardState, booksState } from "./health.mjs";
import { keySaved, readState } from "./models.mjs";

const freezeAll = (v) => {
  if (v && typeof v === "object") { for (const x of Object.values(v)) freezeAll(x); Object.freeze(v); }
  return v;
};

export const STEP_IDS = Object.freeze(["basics", "brand", "models", "books", "task"]);
export const SWITCH_IDS = Object.freeze(["web", "generation", "viewer", "apps", "brain"]);
// The steps the owner may skip for now: the engine works without them.
export const SKIPPABLE = Object.freeze(["basics", "brand", "books"]);
export const SKIPPED_KEY = "setup:skipped";
export const DISMISSED_KEY = "setup:dismissed";
const BASICS_TOTAL = 9;
const BOOKS_LIMIT_MS = 3000;
const BOOKS_KEEP_MS = 30000;

// The only commands the setup ever shows, as text for Terminal. None is built from data.
export const COMMANDS = freezeAll({
  login: "engine/fence/login-wizard.sh",
  codex: "engine/fence/login-wizard.sh codex",
  books: "engine/books/setup-wizard.sh",
});

export const LEADS = freezeAll({
  only: "Only you can do this. Open Terminal and run:",
  ready: "When you are ready, open Terminal and run:",
});

export const LINKS = freezeAll({
  files: { label: "Open Files", href: "#/files" },
  kit: { label: "Open the brand kit", href: "#/files/brand-kit" },
  settings: { label: "Open Settings", href: "#/settings" },
  health: { label: "Open Health", href: "#/health" },
  books: { label: "Open the Books dashboard", href: "#/dashboards/books" },
  tasks: { label: "Open Tasks", href: "#/tasks" },
  jobs: { label: "Choose a job", href: "#/jobs" },
});

// Every pinned sentence of the steps (PLAN-ONBOARD, the step tables). Functions give the counted ones.
export const WORDS = freezeAll({
  unreadable: "This could not be read just now.",
  basics: {
    title: "Company basics",
    why: "Every agent reads these before it works, so what it makes sounds like your company. Filling them takes about 20 minutes.",
    done: "All nine basics are filled.",
    todo: (filled) => `${filled} of 9 basics filled.`,
    still: (titles) => `Still to fill: ${titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`}.`,
  },
  brand: {
    title: "Brand kit",
    why: "Your colours, fonts and logo. Posters, pages and apps are made in this look.",
    done: "Your brand kit is saved.",
    unknown: "The brand kit could not be read. Open it and save it again.",
    todo: "No brand kit yet.",
  },
  models: {
    title: "Models",
    why: "Your agents think with these. Plans mode uses your Claude and Codex plans; Omega Plus is a paid service you can switch on in Settings instead.",
    unknown: "The Models settings could not be read. Open Settings.",
    plansReady: "Plans mode is on and ready: your agents use your Claude and Codex plans.",
    noAgentLogin: "Plans mode is on, but the Claude agents have no login of their own yet.",
    noCheckerLogin: "Plans mode is on, but the Checker has no Codex login yet.",
    sharedLogin: "The Checker is using your own Codex login for now. Giving it its own is a step only you can do.",
    noKey: "Omega Plus is on, but no key is saved. Open Settings.",
    ok: "Omega Plus is on and ready: the key is saved and its last test passed.",
    refused: "Omega Plus is on, but it refused the key. Open Settings.",
    limited: "Omega Plus is on, but its usage limit is reached. Agents cannot work until it resets.",
    unreachable: "Omega Plus is on, but it did not answer the last test. Open Settings and press Test.",
    untested: "Omega Plus is on, but the key has not been tested. Open Settings and press Test.",
  },
  books: {
    title: "The books",
    why: "Invoices, customers, support and leave are kept in the books.",
    notInstalled: "The books are not installed on this Mac yet.",
    off: "The books are off, so the setup cannot see what they hold.",
    silent: "The books are connected, but they did not answer just now.",
    done: "The books are connected and your company's details are in them.",
    todo: "The books are connected. Your company's details are not in them yet.",
    notes: [
      "It asks whether the company is registered for GST, the company's address, and the weekly days off and public holidays, then shows it all and saves it in one go.",
      "Until then invoices say \"Nil-Rated\" even where tax is charged, and leave can be drafted but not made final.",
    ],
  },
  task: {
    title: "A first real task",
    why: "Say what you want done in your own words. The Chief of staff hands it out, and the Checker looks at the result before it reaches you.",
    off: "The board is off, so the setup cannot see your tasks.",
    todo: "No task yet.",
    done: "Your first task is on the board.",
  },
  switchUnreadable: "Its switch could not be read. Open Settings.",
  switches: {
    web: { title: "The web", href: "#/settings", off: "Off. Agents have no internet.", on: "On. Only the Researcher can read the web." },
    generation: { title: "Generation", href: "#/settings", off: "Off. Nothing is sent to Runway and nothing is spent while it is off.", on: "On. Making pictures and clips costs money. The limits are in Settings." },
    viewer: { title: "The page viewer", href: "#/settings", off: "Off. Agents cannot look at the pages they build.", on: "On. Only the Builder and the Art director can look at pages." },
    apps: { title: "App Studio", href: "#/apps", off: "Off. An app that is off runs nothing and spends nothing.", on: (n, m) => `On for ${n} of ${m} apps.` },
    brain: { title: "The brain", href: "#/settings", off: "Off. Before you switch it on, Track changes must be on for Project and Contact in the books.", on: "On. Agents search your files instead of reading them whole." },
  },
});

const link = (l) => ({ label: l.label, href: l.href });
const command = (lead, cmd) => ({ lead, command: cmd });

// ---- the steps: each gives { state, line, notes, links, commands, facts } -----------------------------------------

function basicsStep(ctx) {
  const list = basics(ctx.config);
  const filled = list.filter((b) => b.state === "filled").length;
  const missing = list.filter((b) => b.state !== "filled").map((b) => b.title);
  const notes = missing.length >= 1 && missing.length < BASICS_TOTAL ? [WORDS.basics.still(missing)] : [];
  return {
    state: filled === BASICS_TOTAL ? "done" : "todo",
    line: filled === BASICS_TOTAL ? WORDS.basics.done : WORDS.basics.todo(filled),
    notes, links: [link(LINKS.files)], commands: [],
    facts: { filled, total: BASICS_TOTAL, missing },
  };
}

function brandStep(ctx) {
  const { raw, problem } = readKitFile(ctx.config);
  const base = { notes: [], links: [link(LINKS.kit)], commands: [] };
  if (problem) return { ...base, state: "unknown", line: WORDS.brand.unknown, facts: { saved: false } };
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return { ...base, state: "done", line: WORDS.brand.done, facts: { saved: true } };
  return { ...base, state: "todo", line: WORDS.brand.todo, facts: { saved: false } };
}

const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const realOrNull = (p) => { try { return realpathSync(p); } catch { return null; } };

// The two logins, by existence only (as login-wizard.sh --status judges them): neither file is ever opened.
function logins(config) {
  const state = config.paths.state;
  const agentLogin = lstatOrNull(join(state, "agent.env"))?.isFile() === true;
  const auth = join(state, "codex-home", "auth.json");
  const checkerLogin = lstatOrNull(auth) !== null;
  const stateReal = realOrNull(state);
  const authReal = checkerLogin ? realOrNull(auth) : null;
  const checkerOwnLogin = !!(stateReal && authReal && authReal.startsWith(`${stateReal}/`));
  return { agentLogin, checkerLogin, checkerOwnLogin };
}

// The saved test results that have a line of their own; any other (`unknown`, `none`) is "not tested".
const TESTED = new Set(["ok", "refused", "limited", "unreachable"]);

function modelsStep(ctx) {
  const base = { notes: [], links: [link(LINKS.settings)], commands: [] };
  const { state, problem } = readState(ctx.config);
  if (problem) return { ...base, state: "unknown", line: WORDS.models.unknown, facts: { mode: "plans", ready: false, checkerOwnLogin: null } };
  if (state.mode === "provider") {
    let line;
    if (!keySaved(ctx.config)) line = WORDS.models.noKey;
    else line = WORDS.models[TESTED.has(state.key?.state) ? state.key.state : "untested"];
    const ready = line === WORDS.models.ok;
    return { ...base, state: ready ? "done" : "todo", line, facts: { mode: "provider", ready, checkerOwnLogin: null } };
  }
  const { agentLogin, checkerLogin, checkerOwnLogin } = logins(ctx.config);
  const out = { ...base };
  if (agentLogin && checkerLogin) { out.state = "done"; out.line = WORDS.models.plansReady; } else if (!agentLogin) {
    out.state = "todo"; out.line = WORDS.models.noAgentLogin;
    out.commands.push(command(LEADS.only, COMMANDS.login));
  } else {
    out.state = "todo"; out.line = WORDS.models.noCheckerLogin;
    out.commands.push(command(LEADS.only, COMMANDS.codex));
  }
  if (checkerLogin && !checkerOwnLogin) {
    out.notes.push(WORDS.models.sharedLogin);
    out.commands.push(command(LEADS.ready, COMMANDS.codex));
  }
  out.facts = { mode: "plans", ready: out.state === "done", checkerOwnLogin };
  return out;
}

// ---- the books: the wizard's answers, asked only when the books answer their ping ---------------------------------

let booksKept = new WeakMap(); // books client -> { at, company }, a good answer kept 30 seconds

// Tests clear what is kept between cases.
export function forgetBooks() {
  booksKept = new WeakMap();
}

// The promise, or a refusal after `ms`; the timer is cleared either way and a late refusal is caught.
function withinLimit(promise, ms) {
  let timer = null;
  promise.catch(() => {});
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("too slow")), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function companyInBooks(ctx) {
  const kept = booksKept.get(ctx.bench);
  if (kept && Date.now() - kept.at < BOOKS_KEEP_MS) return kept.company;
  const reads = Promise.all([
    ctx.bench.get("/api/resource/Company", { fields: ["name", "default_holiday_list"], limit_page_length: 2 }),
    ctx.bench.get("/api/resource/Address", {
      fields: ["name"], filters: [["is_your_company_address", "=", 1], ["disabled", "=", 0]], limit_page_length: 1,
    }),
  ]);
  const [companies, addresses] = await withinLimit(reads, BOOKS_LIMIT_MS);
  const rows = (r) => (r && Array.isArray(r.data) ? r.data : []);
  const company = {
    address: rows(addresses).length > 0,
    holidays: rows(companies).some((c) => c && typeof c.default_holiday_list === "string" && c.default_holiday_list.trim() !== ""),
  };
  booksKept.set(ctx.bench, { at: Date.now(), company });
  return company;
}

async function booksStep(ctx, env) {
  const base = { notes: [], commands: [] };
  const health = [link(LINKS.health)];
  const { state: connection } = await booksState(env);
  if (connection === "not_installed") return { ...base, state: "todo", line: WORDS.books.notInstalled, links: health, facts: { connection, company: null } };
  if (connection !== "on") {
    return { ...base, state: "unknown", line: WORDS.books.off, links: health, facts: { connection: connection === "unhealthy" ? "unhealthy" : "off", company: null } };
  }
  let company;
  try {
    company = await companyInBooks(ctx);
  } catch {
    return { ...base, state: "unknown", line: WORDS.books.silent, links: health, facts: { connection, company: null } };
  }
  const dashboard = [link(LINKS.books)];
  if (company.address && company.holidays) return { ...base, state: "done", line: WORDS.books.done, links: dashboard, facts: { connection, company: { ...company } } };
  return {
    state: "todo", line: WORDS.books.todo, notes: [...WORDS.books.notes], links: dashboard,
    commands: [command(LEADS.only, COMMANDS.books)], facts: { connection, company: { ...company } },
  };
}

// ---- the first task: the goals on the board, a question to the brain (an `ask:` record) left out ---------------------

async function taskStep(ctx, env) {
  const off = { state: "unknown", line: WORDS.task.off, notes: [], links: [link(LINKS.health)], commands: [], facts: { count: null } };
  const board = await boardState(env);
  const ids = ctx.ids();
  if (board.state !== "on" || !ids?.projectId) return off;
  let count;
  try {
    const companyId = await ctx.board.companyId();
    const issues = await loadIssues(ctx, companyId);
    count = goalsOf(issues, ids).filter((g) => !ctx.decisions.get(`ask:${g.id}`)).length;
  } catch {
    return off;
  }
  if (count >= 1) return { state: "done", line: WORDS.task.done, notes: [], links: [link(LINKS.tasks)], commands: [], facts: { count } };
  return { state: "todo", line: WORDS.task.todo, notes: [], links: [link(LINKS.jobs)], commands: [], facts: { count } };
}

// ---- the switches: as saved, nothing is probed -------------------------------------------------------------------

function switchesOf(ctx) {
  const words = WORDS.switches;
  const row = (id, on, line) => ({ id, title: words[id].title, on, line, href: words[id].href });
  let doors;
  try { doors = readDoors(ctx.config); } catch { doors = { problem: "state_unreadable" }; }
  const door = (id, key) => {
    if (doors.problem) return row(id, null, WORDS.switchUnreadable);
    const on = doors.state?.[key]?.on === true;
    return row(id, on, on ? words[id].on : words[id].off);
  };
  let apps;
  try {
    const switches = readSwitches(ctx.config);
    if (switches.problem) apps = row("apps", null, WORDS.switchUnreadable);
    else {
      const good = listApps(ctx.config).filter((e) => e.ok);
      const n = good.filter((e) => switches.on[e.slug] === true).length;
      apps = n >= 1 ? row("apps", true, words.apps.on(n, good.length)) : row("apps", false, words.apps.off);
    }
  } catch {
    apps = row("apps", null, WORDS.switchUnreadable);
  }
  return [door("web", "web"), door("generation", "generate"), door("viewer", "viewer"), apps, door("brain", "brain")];
}

// ---- the answer --------------------------------------------------------------------------------------------------

// The stored skip record, only the three ids that may be skipped, each true or false.
export function skippedRecord(ctx) {
  const rec = ctx.decisions.get(SKIPPED_KEY);
  const ok = !!rec && typeof rec === "object" && !Array.isArray(rec);
  return Object.fromEntries(SKIPPABLE.map((id) => [id, ok && rec[id] === true]));
}

const READERS = {
  basics: (ctx) => basicsStep(ctx),
  brand: (ctx) => brandStep(ctx),
  models: (ctx) => modelsStep(ctx),
  books: (ctx, env) => booksStep(ctx, env),
  task: (ctx, env) => taskStep(ctx, env),
};

// A step whose reader throws is "unknown"; the answer still comes.
async function readStep(ctx, env, id) {
  try {
    return await READERS[id](ctx, env);
  } catch {
    ctx.log(`setup: the ${id} step could not be read`);
    return { state: "unknown", line: WORDS.unreadable, notes: [], links: [], commands: [], facts: {} };
  }
}

export async function buildSetup(ctx) {
  const env = { config: ctx.config, urls: ctx.home.urls, bench: ctx.bench, port: ctx.home.port };
  const record = skippedRecord(ctx);
  const read = await Promise.all(STEP_IDS.map((id) => readStep(ctx, env, id)));
  const steps = STEP_IDS.map((id, i) => {
    const r = read[i];
    const canSkip = SKIPPABLE.includes(id);
    const skipped = canSkip && record[id] === true;
    const state = r.state !== "done" && skipped ? "skipped" : r.state;
    return {
      id, title: WORDS[id].title, state, canSkip, skipped, line: r.line, why: WORDS[id].why,
      notes: r.notes, links: r.links, commands: r.commands, facts: r.facts,
    };
  });
  let switches;
  try { switches = switchesOf(ctx); } catch {
    switches = SWITCH_IDS.map((id) => ({ id, title: WORDS.switches[id].title, on: null, line: WORDS.switchUnreadable, href: WORDS.switches[id].href }));
  }
  const counts = {
    done: steps.filter((s) => s.state === "done").length,
    skipped: steps.filter((s) => s.state === "skipped").length,
    total: STEP_IDS.length,
  };
  const dismissedAt = ctx.decisions.get(DISMISSED_KEY);
  const dismissed = typeof dismissedAt === "string" && dismissedAt !== "";
  const finished = steps.every((s) => s.state === "done" || s.state === "skipped");
  const show = !dismissed && !finished;
  const open = show && steps.find((s) => s.id === "task").state === "todo";
  return { open, show, dismissed, finished, counts, steps, switches, generatedAt: new Date().toISOString() };
}
