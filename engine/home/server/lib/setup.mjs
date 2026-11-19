// The guided setup (PLAN-ONBOARD, version 2): GET /api/setup, the steps needed to start, the ones the owner may want
// later and what cannot be set up yet, worked out on every answer from what the engine already keeps. Read-only: it
// opens no secret, presses no Test, flips no switch and starts nothing. The login files are judged by lstat and
// realpath alone, the provider and Runway keys by lstat alone; the door's status file is read with the trust rule;
// the board and the books are asked read-only questions through the home's own clients.
// The only writes of the setup are the two display records of routes/setup.mjs (ctx.decisions).
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { readKitFile } from "../brain/kit.mjs";
import { capsLeft, listApps, readSwitches, spendingOf } from "./apps.mjs";
import { basics } from "./brainfiles.mjs";
import { doorKeySaved, readDoors, readTrustedText } from "./doors.mjs";
import { dollars } from "./generation.mjs";
import { goalsOf, loadIssues } from "./goals.mjs";
import { boardState, booksState, notConnected, proofSentence, readProof } from "./health.mjs";
import { keySaved, readState } from "./models.mjs";

const freezeAll = (v) => {
  if (v && typeof v === "object") { for (const x of Object.values(v)) freezeAll(x); Object.freeze(v); }
  return v;
};

// "Needed to start", in order: what blocks all work comes first. Only these are counted.
export const START_IDS = Object.freeze(["models", "proof", "basics", "brand", "books", "task"]);
// "When you want it", in order; `checker-login` only in plans mode. Never counted.
export const LATER_IDS = Object.freeze(["checker-login", "routines", "web", "viewer", "generation", "higgsfield", "apps", "brain"]);
// "Not possible yet": Health's own list, these ids in this order.
export const NOT_YET_IDS = Object.freeze(["publishing", "email", "whatsapp", "gst_portal", "board_login"]);
// The steps the owner may skip for now: the engine works without them.
export const SKIPPABLE = Object.freeze(["basics", "brand", "books"]);
export const SKIPPED_KEY = "setup:skipped";
export const DISMISSED_KEY = "setup:dismissed";
const BASICS_TOTAL = 9;
const BOOKS_LIMIT_MS = 3000;
const BOOKS_KEEP_MS = 30000;
const STATUS_MAX_BYTES = 262144; // the door's status file, as routes/generation.mjs reads it
const APP_NOTES_MAX = 3;
const APP_NAME_MAX = 40;

// The only commands the setup ever shows, as text for Terminal. None is built from data.
export const COMMANDS = freezeAll({
  login: "engine/fence/login-wizard.sh",
  codex: "engine/fence/login-wizard.sh codex",
  books: "engine/books/setup-wizard.sh",
});

export const LEADS = freezeAll({
  only: "Only you can do this. Open Terminal and run:",
});

export const LINKS = freezeAll({
  files: { label: "Open Files", href: "#/files" },
  kit: { label: "Open the brand kit", href: "#/files/brand-kit" },
  settings: { label: "Open Settings", href: "#/settings" },
  health: { label: "Open Health", href: "#/health" },
  books: { label: "Open the Books dashboard", href: "#/dashboards/books" },
  tasks: { label: "Open Tasks", href: "#/tasks" },
  jobs: { label: "Choose a job", href: "#/jobs" },
  routines: { label: "Open Routines", href: "#/routines" },
  apps: { label: "Open App Studio", href: "#/apps" },
});

export const GROUPS = freezeAll([
  { id: "start", title: "Needed to start", say: "Do these and the engine can do real work for you." },
  { id: "later", title: "When you want it", say: "Each of these is off until you choose it. Each line says what it opens up and what it costs or sends off this Mac." },
  { id: "notyet", title: "Not possible yet", say: "These cannot be set up yet. Nothing can be published or sent from here until they exist." },
]);

const TRACKED = { project: "Project", contact: "Contact" };

// Every pinned sentence of the steps (PLAN-ONBOARD, the step tables). Functions give the counted ones.
export const WORDS = freezeAll({
  unreadable: "This could not be read just now.",
  switchUnreadable: "Its switch could not be read. Open Settings.",
  models: {
    title: "Models",
    why: "Your agents think with these. Plans mode uses your Claude and Codex plans; Omega Plus is a paid service you can switch on in Settings instead.",
    unknown: "The Models settings could not be read. Open Settings.",
    plansReady: "Plans mode is on and ready: your agents use your Claude and Codex plans.",
    noAgentLogin: "Plans mode is on, but the Claude agents have no login of their own yet.",
    noCheckerLogin: "Plans mode is on, but the Checker has no Codex login yet.",
    noKey: "Omega Plus is on, but no key is saved. Open Settings.",
    ok: "Omega Plus is on and ready: the key is saved and its last test passed.",
    refused: "Omega Plus is on, but it refused the key. Open Settings.",
    limited: "Omega Plus is on, but its usage limit is reached. Agents cannot work until it resets.",
    unreachable: "Omega Plus is on, but it did not answer the last test. Open Settings and press Test.",
    untested: "Omega Plus is on, but the key has not been tested. Open Settings and press Test.",
  },
  proof: {
    title: "The fence check",
    why: "The fence is what keeps agents away from the internet, your files and your logins. The proof checks that it holds.",
  },
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
  "checker-login": {
    title: "The Checker's own login",
    own: "The Checker has its own Codex login.",
    shared: "The Checker is using your own Codex login for now.",
    none: "The Checker has no Codex login yet.",
    opens: "The Checker stops depending on your own login, and the proof's note about it goes away.",
    costs: [],
  },
  routines: {
    title: "Routines",
    off: "The board is off, so the setup cannot see your routines.",
    none: "No routine is set up yet.",
    allOff: "No routine is switched on.",
    on: (n, m) => `${n} of ${m} routines are switched on.`,
    opens: "Standing work on a schedule, such as a daily brief each morning and a weekly content plan.",
    costs: ["Each run costs one run of that agent on your plan."],
  },
  web: {
    title: "The web for the Researcher",
    off: "Off. No agent can reach the internet.",
    on: "On. Only the Researcher can read the web.",
    opens: "The Researcher can read public pages, search and watch public videos, and the jobs that need the web can start.",
    costs: ["When this is on, the addresses the Researcher opens and the words it searches for leave this Mac."],
  },
  viewer: {
    title: "The page viewer",
    off: "Off. A page job stops until it is switched on.",
    on: "On. Only the Builder and the Art director can ask.",
    opens: "The Builder and the Art director can open the pages they build and take pictures, and you see those pictures on the task.",
    costs: ["Chrome has to be installed on this Mac. The viewer never touches your own Chrome or its profile."],
  },
  generation: {
    title: "Runway: clips and pictures",
    noKey: "No Runway key is saved.",
    noWayIn: "No Runway key is saved and you are not signed in to Runway.",
    keyOff: "A Runway key is saved. Generation is off.",
    signedInOff: "You are signed in to Runway. Generation is off.",
    onNoWayIn: "Generation is on, but there is no way in to Runway yet.",
    on: "Generation is on.",
    refused: "Runway asked you to sign in again.",
    limits: (d, m) => `Most to spend in a day: ${d}. Most to spend in a month: ${m}. A limit of 0 stops all making.`,
    twoWays: "There are two ways in: a Runway key, or signing in to your Runway account. Either is enough.",
    opens: "The Artist can turn your renders into short clips, make variations of a picture and make a picture larger.",
    costs: [
      "This costs money beyond your plans. Nothing is spent until you approve a cost.",
      "Runway's terms say it may use what you send to train its models unless you have an Enterprise agreement. Do not use Generation for client work you may not share.",
    ],
  },
  higgsfield: {
    title: "Higgsfield",
    refused: "Higgsfield asked you to sign in again.",
    outOff: "Not signed in. Higgsfield is off.",
    inOff: "Signed in. Higgsfield is off.",
    onOut: "On, but not signed in.",
    on: "On. Your apps and the Artist may use it, inside what you approve.",
    opens: "A few models for pictures and clips that Runway does not have.",
    costs: [
      "Higgsfield's terms let it use what you send, and what it makes, to train its models. Do not send client work you may not share.",
      "It spends inside the same daily and monthly limits as Runway.",
    ],
  },
  apps: {
    title: "App Studio",
    none: "There is no app yet.",
    allOff: "No app is switched on.",
    on: (n, m) => `${n} of ${m} apps are switched on.`,
    spending: (name, words) => `${name}: ${words}`,
    opens: "The apps your company made, opened inside the home screen.",
    costs: [
      "An app cannot spend anything until you say so.",
      "Its page runs in your browser and can reach the internet. Turn on only an app whose code you trust.",
    ],
  },
  brain: {
    title: "The brain",
    on: "On. Agents search your files instead of reading them whole.",
    offReady: "Off. The books keep a history for Project and Contact, so it can be switched on.",
    offNeeds: (names) => `Off. Before you switch it on, turn on Track changes for ${names} in the books.`,
    offUnknown: "Off. The setup could not ask the books whether Track changes is on for Project and Contact.",
    trackOff: (name) => `Track changes is off for ${name} in the books, so the brain cannot see who changed those records.`,
    howTo: "In the books, open Customize Form for each one and tick Track Changes.",
    opens: "Agents find the right passage in your files and records instead of reading every file whole.",
    costs: [],
  },
});

const link = (l) => ({ label: l.label, href: l.href });
const command = (lead, cmd) => ({ lead, command: cmd });
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Each read made once per answer and shared by the steps that need it (the board for `task` and `routines`, the
// books' ping for `books` and `brain`, the switches and the door's status file for the door steps).
function once(fn) {
  let p = null;
  return () => (p ||= Promise.resolve().then(fn));
}

// ---- needed to start: each gives { state, line, notes, links, commands, facts } ------------------------------------

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

// The Models state once per answer: { mode, state } with mode "plans" when it cannot be read.
function modelsOf(ctx) {
  const { state, problem } = readState(ctx.config);
  if (problem) return { problem, mode: "plans", state: null };
  return { problem: null, mode: state.mode === "provider" ? "provider" : "plans", state };
}

async function modelsStep(ctx, reads) {
  const base = { notes: [], links: [link(LINKS.settings)], commands: [] };
  const m = await reads.models();
  if (m.problem) return { ...base, state: "unknown", line: WORDS.models.unknown, facts: { mode: "plans", ready: false } };
  if (m.mode === "provider") {
    let line;
    if (!keySaved(ctx.config)) line = WORDS.models.noKey;
    else line = WORDS.models[TESTED.has(m.state.key?.state) ? m.state.key.state : "untested"];
    const ready = line === WORDS.models.ok;
    return { ...base, state: ready ? "done" : "todo", line, facts: { mode: "provider", ready } };
  }
  const { agentLogin, checkerLogin } = logins(ctx.config);
  if (agentLogin && checkerLogin) return { ...base, state: "done", line: WORDS.models.plansReady, facts: { mode: "plans", ready: true } };
  if (!agentLogin) {
    return { ...base, state: "todo", line: WORDS.models.noAgentLogin, commands: [command(LEADS.only, COMMANDS.login)], facts: { mode: "plans", ready: false } };
  }
  return { ...base, state: "todo", line: WORDS.models.noCheckerLogin, commands: [command(LEADS.only, COMMANDS.codex)], facts: { mode: "plans", ready: false } };
}

// The fence check: the last proof as Health reads it; nothing is run.
function proofStep(ctx) {
  const p = readProof(ctx.config.paths.proofLast);
  const raw = obj(p) ? p.result : undefined;
  const result = !obj(p) ? null : raw === "holds" || raw === "holds-with-todo" ? raw : "failed";
  const at = obj(p) && typeof p.ranAt === "string" ? p.ranAt : null;
  return {
    state: result === "holds" || result === "holds-with-todo" ? "done" : "todo",
    line: proofSentence(obj(p) ? p : null),
    notes: [], links: [link(LINKS.health)], commands: [],
    facts: { result, at },
  };
}

// ---- the books: the wizard's answers and the brain's Track changes, asked only when the books answer their ping -----

let booksKept = new WeakMap(); // books client -> { company: { at, value }, track: { at, value } }, good answers kept 30 s

// Tests clear what is kept between cases.
export function forgetBooks() {
  booksKept = new WeakMap();
}

const keptOf = (bench, key) => {
  const k = booksKept.get(bench)?.[key];
  return k && Date.now() - k.at < BOOKS_KEEP_MS ? k.value : null;
};
const keep = (bench, key, value) => {
  booksKept.set(bench, { ...(booksKept.get(bench) || {}), [key]: { at: Date.now(), value } });
};

// The promise, or a refusal after `ms`; the timer is cleared either way and a late refusal is caught.
function withinLimit(promise, ms) {
  let timer = null;
  promise.catch(() => {});
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("too slow")), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function companyInBooks(ctx) {
  const kept = keptOf(ctx.bench, "company");
  if (kept) return kept;
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
  keep(ctx.bench, "company", company);
  return company;
}

// Track changes for Project and Contact: true, false, or null when that one could not be asked. Kept only whole.
async function trackInBooks(ctx) {
  const kept = keptOf(ctx.bench, "track");
  if (kept) return kept;
  const one = (doctype) => ctx.bench.get(`/api/resource/DocType/${doctype}`)
    .then((r) => (obj(r) && obj(r.data) ? r.data.track_changes === 1 : null), () => null);
  let pair;
  try {
    pair = await withinLimit(Promise.all([one(TRACKED.project), one(TRACKED.contact)]), BOOKS_LIMIT_MS);
  } catch {
    pair = [null, null];
  }
  const track = { project: pair[0], contact: pair[1] };
  if (track.project !== null && track.contact !== null) keep(ctx.bench, "track", track);
  return track;
}

async function booksStep(ctx, reads) {
  const base = { notes: [], commands: [] };
  const health = [link(LINKS.health)];
  const { state: connection } = await reads.books();
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

async function taskStep(ctx, reads) {
  const off = { state: "unknown", line: WORDS.task.off, notes: [], links: [link(LINKS.health)], commands: [], facts: { count: null } };
  const board = await reads.board();
  const ids = ctx.ids();
  if (board.state !== "on" || !ids?.projectId) return off;
  let count;
  try {
    const companyId = await reads.companyId();
    const issues = await loadIssues(ctx, companyId);
    count = goalsOf(issues, ids).filter((g) => !ctx.decisions.get(`ask:${g.id}`)).length;
  } catch {
    return off;
  }
  if (count >= 1) return { state: "done", line: WORDS.task.done, notes: [], links: [link(LINKS.tasks)], commands: [], facts: { count } };
  return { state: "todo", line: WORDS.task.todo, notes: [], links: [link(LINKS.jobs)], commands: [], facts: { count } };
}

// ---- when you want it ----------------------------------------------------------------------------------------------

function checkerLoginStep(ctx) {
  const { checkerLogin, checkerOwnLogin } = logins(ctx.config);
  const words = WORDS["checker-login"];
  const facts = { checkerLogin, checkerOwnLogin };
  if (checkerOwnLogin) return { state: "done", line: words.own, notes: [], links: [], commands: [], facts };
  return {
    state: "todo", line: checkerLogin ? words.shared : words.none, notes: [], links: [],
    commands: [command(LEADS.only, COMMANDS.codex)], facts,
  };
}

// The board's routines, read only, as routes/routines.mjs reads them; on = the ones whose status is "active".
async function routinesStep(ctx, reads) {
  const words = WORDS.routines;
  const links = [link(LINKS.routines)];
  const off = { state: "unknown", line: words.off, notes: [], links, commands: [], facts: { on: null, total: null } };
  const board = await reads.board();
  if (board.state !== "on") return off;
  let list;
  try {
    const companyId = await reads.companyId();
    const got = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/routines`);
    list = Array.isArray(got) ? got.filter((r) => r && typeof r.id === "string") : [];
  } catch {
    return off;
  }
  const total = list.length;
  const on = list.filter((r) => r.status === "active").length;
  const facts = { on, total };
  if (total === 0) return { state: "todo", line: words.none, notes: [], links, commands: [], facts };
  if (on === 0) return { state: "todo", line: words.allOff, notes: [], links, commands: [], facts };
  return { state: "done", line: words.on(on, total), notes: [], links, commands: [], facts };
}

// The switches file, once per answer; a file that cannot be read is { problem }.
function doorsOf(ctx) {
  try { return readDoors(ctx.config); } catch { return { state: null, problem: "state_unreadable" }; }
}

// The door's status file, read with the trust rule only; anything odd is no status.
function statusOf(ctx) {
  let d = null;
  try {
    const text = readTrustedText(ctx.config.paths.generateStatus, STATUS_MAX_BYTES);
    d = typeof text === "string" && text !== "missing" ? JSON.parse(text) : null;
  } catch { d = null; }
  return obj(d) ? d : null;
}

const switchUnknown = (links, facts) => ({ state: "unknown", line: WORDS.switchUnreadable, notes: [], links, commands: [], facts });

async function doorStep(reads, id, key) {
  const words = WORDS[id];
  const links = [link(LINKS.settings)];
  const doors = await reads.doors();
  if (doors.problem) return switchUnknown(links, { on: null });
  const on = doors.state?.[key]?.on === true;
  return { state: on ? "done" : "todo", line: on ? words.on : words.off, notes: [], links, commands: [], facts: { on } };
}

async function generationStep(ctx, reads) {
  const words = WORDS.generation;
  const links = [link(LINKS.settings)];
  const doors = await reads.doors();
  const saved = doorKeySaved(ctx.config, "runway");
  const status = await reads.status();
  const rw = status && obj(status.runway) ? status.runway : null;
  const refused = rw !== null && rw.refused === true;
  const signedIn = rw === null ? null : rw.signedIn === true && !refused;
  if (doors.problem) return switchUnknown(links, { on: null, keySaved: saved, signedIn, daily: null, monthly: null });
  const g = doors.state.generate;
  const on = g.on === true;
  const wayIn = saved || signedIn === true;
  let line;
  if (refused && !saved) line = words.refused;
  else if (!on && !wayIn) line = signedIn === null ? words.noKey : words.noWayIn;
  else if (!on) line = saved ? words.keyOff : words.signedInOff;
  else line = wayIn ? words.on : words.onNoWayIn;
  const notes = [words.limits(dollars(g.dailyCredits), dollars(g.monthlyCredits))];
  if (signedIn !== null) notes.push(words.twoWays);
  return {
    state: line === words.on ? "done" : "todo", line, notes, links, commands: [],
    facts: { on, keySaved: saved, signedIn, daily: g.dailyCredits, monthly: g.monthlyCredits },
  };
}

// Higgsfield's sign-in as the door's status file says it (the token file is never read here).
async function higgsfieldStep(reads) {
  const words = WORDS.higgsfield;
  const links = [link(LINKS.settings)];
  const doors = await reads.doors();
  const status = await reads.status();
  const hf = status && obj(status.higgsfield) ? status.higgsfield : {};
  const refused = hf.refused === true;
  const signedIn = !refused && hf.signedIn === true;
  if (doors.problem) return switchUnknown(links, { on: null, signedIn, refused });
  const on = doors.state.generate?.higgsfield?.on === true;
  const facts = { on, signedIn, refused };
  let line;
  if (refused) line = words.refused;
  else if (!on) line = signedIn ? words.inOff : words.outOff;
  else line = signedIn ? words.on : words.onOut;
  return { state: line === words.on ? "done" : "todo", line, notes: [], links, commands: [], facts };
}

// One line of an app's name: control characters and line breaks made spaces, at most 40 characters.
const nameLine = (v) => String(v ?? "").replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, APP_NAME_MAX);

function appsStep(ctx) {
  const words = WORDS.apps;
  const links = [link(LINKS.apps)];
  const switches = readSwitches(ctx.config);
  if (switches.problem) return switchUnknown(links, { apps: null, on: null });
  const good = listApps(ctx.config).filter((e) => e.ok);
  const onApps = good.filter((e) => switches.on[e.slug] === true);
  const facts = { apps: good.length, on: onApps.length };
  if (good.length === 0) return { state: "todo", line: words.none, notes: [], links, commands: [], facts };
  if (onApps.length === 0) return { state: "todo", line: words.allOff, notes: [], links, commands: [], facts };
  const caps = capsLeft(ctx.config);
  const notes = onApps.slice(0, APP_NOTES_MAX)
    .map((e) => words.spending(nameLine(e.app?.name || e.slug), spendingOf(ctx.config, e.slug, caps).words));
  return { state: "done", line: words.on(onApps.length, good.length), notes, links, commands: [], facts };
}

async function brainStep(ctx, reads) {
  const words = WORDS.brain;
  const links = [link(LINKS.settings)];
  const doors = await reads.doors();
  const { state: connection } = await reads.books();
  const track = connection === "on" ? await trackInBooks(ctx) : { project: null, contact: null };
  if (doors.problem) return switchUnknown(links, { on: null, trackChanges: track });
  const on = doors.state.brain?.on === true;
  const facts = { on, trackChanges: { ...track } };
  const off = Object.keys(TRACKED).filter((k) => track[k] === false).map((k) => TRACKED[k]);
  if (on) return { state: "done", line: words.on, notes: off.map((n) => words.trackOff(n)), links, commands: [], facts };
  if (off.length > 0) return { state: "todo", line: words.offNeeds(off.join(" and ")), notes: [words.howTo], links, commands: [], facts };
  if (track.project === true && track.contact === true) return { state: "todo", line: words.offReady, notes: [], links, commands: [], facts };
  return { state: "todo", line: words.offUnknown, notes: [], links, commands: [], facts };
}

// ---- not possible yet: Health's own list and words ------------------------------------------------------------------

function notYetOf(ctx) {
  try {
    const all = notConnected(join(ctx.config.paths.books, "skipped-apps.txt"));
    return NOT_YET_IDS.map((id) => all.find((x) => x.id === id)).filter(Boolean)
      .map((x) => ({ id: x.id, title: x.label, line: x.explain, how: x.how }));
  } catch {
    return [];
  }
}

// ---- the answer --------------------------------------------------------------------------------------------------

// The stored skip record, only the three ids that may be skipped, each true or false.
export function skippedRecord(ctx) {
  const rec = ctx.decisions.get(SKIPPED_KEY);
  const ok = !!rec && typeof rec === "object" && !Array.isArray(rec);
  return Object.fromEntries(SKIPPABLE.map((id) => [id, ok && rec[id] === true]));
}

const READERS = {
  models: (ctx, reads) => modelsStep(ctx, reads),
  proof: (ctx) => proofStep(ctx),
  basics: (ctx) => basicsStep(ctx),
  brand: (ctx) => brandStep(ctx),
  books: (ctx, reads) => booksStep(ctx, reads),
  task: (ctx, reads) => taskStep(ctx, reads),
  "checker-login": (ctx) => checkerLoginStep(ctx),
  routines: (ctx, reads) => routinesStep(ctx, reads),
  web: (ctx, reads) => doorStep(reads, "web", "web"),
  viewer: (ctx, reads) => doorStep(reads, "viewer", "viewer"),
  generation: (ctx, reads) => generationStep(ctx, reads),
  higgsfield: (ctx, reads) => higgsfieldStep(reads),
  apps: (ctx) => appsStep(ctx),
  brain: (ctx, reads) => brainStep(ctx, reads),
};

// A step whose reader throws is "unknown"; the answer still comes.
async function readStep(ctx, reads, id) {
  try {
    return await READERS[id](ctx, reads);
  } catch {
    ctx.log(`setup: the ${id} step could not be read`);
    return { state: "unknown", line: WORDS.unreadable, notes: [], links: [], commands: [], facts: {} };
  }
}

export async function buildSetup(ctx) {
  const env = { config: ctx.config, urls: ctx.home.urls, bench: ctx.bench, port: ctx.home.port };
  const reads = {
    models: once(() => modelsOf(ctx)),
    board: once(() => boardState(env)),
    companyId: once(() => ctx.board.companyId()),
    books: once(() => booksState(env)),
    doors: once(() => doorsOf(ctx)),
    status: once(() => statusOf(ctx)),
  };
  let mode = "plans";
  try { mode = (await reads.models()).mode; } catch { mode = "plans"; }
  const later = LATER_IDS.filter((id) => id !== "checker-login" || mode === "plans");
  const ids = [...START_IDS, ...later];
  const record = skippedRecord(ctx);
  const read = await Promise.all(ids.map((id) => readStep(ctx, reads, id)));
  const steps = ids.map((id, i) => {
    const r = read[i];
    const group = START_IDS.includes(id) ? "start" : "later";
    const canSkip = SKIPPABLE.includes(id);
    const skipped = canSkip && record[id] === true;
    const state = r.state !== "done" && skipped ? "skipped" : r.state;
    const w = WORDS[id];
    return {
      id, title: w.title, group, state, canSkip, skipped, line: r.line,
      why: group === "start" ? w.why : null,
      opens: group === "later" ? w.opens : null,
      costs: group === "later" ? [...w.costs] : [],
      notes: r.notes, links: r.links, commands: r.commands, facts: r.facts,
    };
  });
  const start = steps.filter((s) => s.group === "start");
  const counts = {
    done: start.filter((s) => s.state === "done").length,
    skipped: start.filter((s) => s.state === "skipped").length,
    total: START_IDS.length,
  };
  const laterSteps = steps.filter((s) => s.group === "later");
  const dismissedAt = ctx.decisions.get(DISMISSED_KEY);
  const dismissed = typeof dismissedAt === "string" && dismissedAt !== "";
  const finished = start.every((s) => s.state === "done" || s.state === "skipped");
  const show = !dismissed && !finished;
  const open = show && start.find((s) => s.id === "task").state === "todo";
  return {
    open, show, dismissed, finished, mode, counts,
    later: { done: laterSteps.filter((s) => s.state === "done").length, total: laterSteps.length },
    groups: GROUPS.map((g) => ({ ...g })),
    steps,
    notYet: notYetOf(ctx),
    generatedAt: new Date().toISOString(),
  };
}
