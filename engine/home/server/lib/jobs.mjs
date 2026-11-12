// The jobs (CONTRACTS-V3 31, 33.2, 33.3): the catalogue read from engine/company/jobs/, what the engine has
// in place for a job (needsState), whether a job can start and why not (readiness), how often each was
// run (runsIndex), and one job as the pages see it (jobView, shape `job`). Read-only.
// A task counts as started from a job only by its `template:` record (written by the home server), never
// by the `JOB:` line in its text. Shared by routes/map.mjs and the jobs features; they never edit it.
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadJobFiles, NEEDS } from "../../../company/lib/job-files.mjs";
import { loadStarters } from "../../../company/lib/brain-files.mjs";
import { HomeError } from "./errors.mjs";
import { plainState } from "./goals.mjs";
import { booksState } from "./health.mjs";
import { brainFiles, brainFileState, brainTitle, brainToken, roomFiles } from "./brainfiles.mjs";
import { loadDepartments } from "./departments.mjs";
import { loadRoles } from "./team.mjs";

const NEEDS_TTL = 60000;
const TASK_OPTIONS = 20;
const FILE_OPTIONS = 100;
const HEALTH = { page: "health", id: null };

// The sentences of 31.4, with their links.
export const WHY = {
  books: ["The books are switched off.", HEALTH],
  quotations: ["The books do not let the Bookkeeper draft quotations yet.", HEALTH],
  "cad-tools": ["The Drafter's tools are not installed yet.", HEALTH],
  "artist-tools": ["The Artist's tools are not installed yet.", HEALTH],
  slides: ["The Artist's slide tool is not installed yet.", HEALTH],
  video: ["The Artist's video tool is not installed yet.", HEALTH],
  speech: ["The speech model is not in place yet.", HEALTH],
  internet: ["Agents have no internet, and this job needs it.", null],
  account: ["Sending and publishing are switched off. Connect an account first.", HEALTH],
};

// ---- the catalogue, cached until a file in jobs/ (or the departments or roles) changes
let catalogueCache = { key: null, value: null };

function jobsKey(dir) {
  const parts = [dir];
  let folders = [];
  try { folders = readdirSync(dir).sort(); } catch { return `${dir}|none`; }
  for (const f of folders) {
    let names = [];
    try { names = lstatSync(join(dir, f)).isDirectory() ? readdirSync(join(dir, f)).sort() : []; } catch { names = []; }
    parts.push(`${f}/`);
    for (const n of names) {
      try { const s = statSync(join(dir, f, n)); parts.push(`${n}:${s.mtimeMs}:${s.size}`); } catch { parts.push(`${n}:-`); }
    }
  }
  return parts.join("|");
}

// loadCatalogue(config) -> { jobs: Map("<department>/<id>" -> job file), byDepartment: Map(department id ->
// [job file]), problems: [{ file, problem }] }. A broken job is left out and listed under problems.
export function loadCatalogue(config) {
  const roles = loadRoles(config, { log: () => {} });
  const deps = loadDepartments(config);
  const dir = join(config.engineDir, "company", "jobs");
  const key = jobsKey(dir);
  if (catalogueCache.value && catalogueCache.key === key && catalogueCache.roles === roles && catalogueCache.deps === deps) return catalogueCache.value;
  let loaded;
  try {
    loaded = loadJobFiles(dir, roles, deps.departments);
  } catch {
    loaded = { jobs: [], problems: [{ file: "jobs/", problem: "The job files could not be read." }] };
  }
  const jobs = new Map();
  const byDepartment = new Map(deps.departments.map((d) => [d.id, []]));
  for (const j of loaded.jobs) {
    jobs.set(`${j.department}/${j.id}`, j);
    if (byDepartment.has(j.department)) byDepartment.get(j.department).push(j);
  }
  const value = { jobs, byDepartment, problems: loaded.problems };
  catalogueCache = { key, roles, deps, value };
  return value;
}

export const jobRef = (job) => `${job.department}/${job.id}`;

// ---- what is in place, cached 60 seconds per state folder
const needsCache = new Map(); // state folder -> { at, value: Promise }

async function quotationsAllowed(ctx) {
  const out = await ctx.bench.get("/api/resource/Custom DocPerm", {
    fields: ["name", "create"],
    filters: [["parent", "=", "Quotation"], ["role", "=", "Engine Bookkeeper"], ["create", "=", 1]],
    limit_page_length: 1,
  });
  return Array.isArray(out?.data) && out.data.some((r) => Number(r?.create) === 1);
}

function speechInPlace(state) {
  try {
    return readdirSync(join(state, "media", "models")).some((n) => n.endsWith(".bin") && !n.startsWith(".")
      && lstatSync(join(state, "media", "models", n)).isFile());
  } catch { return false; }
}

async function readNeeds(ctx) {
  const state = ctx.config.paths.state;
  let books = false;
  try {
    const env = { config: ctx.config, urls: ctx.home?.urls || ctx.config.urls, bench: ctx.bench };
    books = !!ctx.bench && (await booksState(env)).state === "on";
  } catch { books = false; }
  let quotations = false;
  if (books) {
    try { quotations = await quotationsAllowed(ctx); } catch (e) { if (!(e instanceof HomeError)) throw e; quotations = false; }
  }
  return {
    books, quotations,
    "cad-tools": existsSync(ctx.config.paths.cadPython),
    "artist-tools": existsSync(join(state, "art", "venv", "bin", "python")),
    slides: existsSync(join(state, "art", "tools", "slides.py")),
    video: existsSync(join(state, "art", "tools", "video.py")),
    speech: speechInPlace(state),
  };
}

// needsState(ctx) -> { books, quotations, "cad-tools", "artist-tools", slides, video, speech } (booleans).
// A books call that fails means false. Cached 60 seconds.
export function needsState(ctx) {
  const key = ctx.config.paths.state;
  const now = Date.now();
  const hit = needsCache.get(key);
  if (hit && now - hit.at < NEEDS_TTL) return hit.value;
  const value = readNeeds(ctx);
  needsCache.set(key, { at: now, value });
  value.catch(() => { if (needsCache.get(key)?.value === value) needsCache.delete(key); });
  if (needsCache.size > 50) for (const k of needsCache.keys()) { needsCache.delete(k); if (needsCache.size <= 25) break; }
  return value;
}

// For tests, and for a feature that has just changed what is installed.
export function forgetNeeds() {
  needsCache.clear();
}

// readiness(job, needs, config) -> { ready, why: null | { name, text, link } } (31.4). The first name that
// fails, in the order internet, account, the tools, books, quotations, then the `must` files of `reads`.
export function readiness(job, needs, config) {
  const want = Array.isArray(job?.needs) ? job.needs : [];
  for (const name of NEEDS) {
    if (!want.includes(name)) continue;
    const holds = name === "internet" || name === "account" ? false : !!needs?.[name];
    if (!holds) return { ready: false, why: { name, text: WHY[name][0], link: WHY[name][1] ? { ...WHY[name][1] } : null } };
  }
  for (const r of Array.isArray(job?.reads) ? job.reads : []) {
    if (r?.need !== "must") continue;
    if (brainFileState(config, r.file) !== "filled") {
      return { ready: false, why: { name: "reads", text: `Fill in "${brainTitle(r.file)}" first.`, link: { page: "files", id: brainToken(r.file) } } };
    }
  }
  return { ready: true, why: null };
}

// ---- runs
const UNFINISHED = (g) => g.status !== "done" && g.status !== "cancelled";
const isLive = (g, tctx) => tctx.liveByIssue.has(g.id) || tctx.stepsOf(g.id).some((s) => tctx.liveByIssue.has(s.id));

// runsIndex(ctx, tctx) -> Map(job id -> { total, accepted, working, needsYou, last }) from the `template:`
// records of the tasks on the board. Only jobs still in the catalogue are counted. Each entry also holds,
// not enumerable (never sent), `tasks`: [{ taskId, identifier, title, accepted, at }], newest first.
export function runsIndex(ctx, tctx) {
  const { jobs } = loadCatalogue(ctx.config);
  const out = new Map();
  for (const g of tctx.goals) {
    const ref = ctx.decisions?.get(`template:${g.id}`);
    if (typeof ref !== "string" || !jobs.has(ref)) continue;
    if (!out.has(ref)) {
      const entry = { total: 0, accepted: 0, working: 0, needsYou: 0, last: null };
      Object.defineProperty(entry, "tasks", { value: [], enumerable: false });
      out.set(ref, entry);
    }
    const e = out.get(ref);
    const accepted = g.status === "done" && tctx.accepted(g.id);
    e.total += 1;
    if (accepted) e.accepted += 1;
    if (UNFINISHED(g) && (g.status === "in_progress" || g.status === "in_review" || isLive(g, tctx))) e.working += 1;
    e.needsYou += tctx.needsYou.filter((i) => i.taskId === g.id).length;
    // tctx.goals are newest first, so the first seen is the last run.
    if (!e.last) e.last = { taskId: g.id, identifier: g.identifier || null, at: g.createdAt || null, plainState: plainState(g.status).plainState };
    const waiting = !accepted && g.status !== "cancelled" && tctx.needsYou.some((i) => i.taskId === g.id);
    e.tasks.push({ taskId: g.id, identifier: g.identifier || null, title: g.title || "", accepted, waiting, at: g.createdAt || null });
  }
  return out;
}

const NO_RUNS = () => ({ total: 0, accepted: 0, working: 0, needsYou: 0, last: null });

function whoOf(slugs, roles) {
  return slugs.map((slug) => {
    const r = roles.find((x) => x.slug === slug);
    return { slug, name: r ? r.name : slug };
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "12 Nov 2026", as every other date on screen; "" for no date.
export function dayWords(at) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The label of an earlier task offered by a `task` question: its title and its date. Task refs stay off it
// (C3 25 over the example of 33.3; M51 F8).
export const taskOptionLabel = (t) => [String(t.title || "").slice(0, 160) || "A task", dayWords(t.at)].filter(Boolean).join(" · ");

// The title of a file a job reads: a basic's title, else a starter pack's own title for a file in Packs
// ("The proposal pack", so it is not mistaken for what the job writes; M51 F7), else the file's name.
let startersCache = { dir: null, packs: null };
function starterPacks(config) {
  const dir = join(config.engineDir, "company", "brain", "starters");
  if (startersCache.dir === dir && startersCache.packs) return startersCache.packs;
  const packs = new Map();
  try {
    for (const st of loadStarters(dir).starters) {
      if (st.folder === "packs" && st.file && st.title) packs.set(st.file, { id: String(st.id), title: String(st.title) });
    }
  } catch { /* no starters: the file's name is used */ }
  startersCache = { dir, packs };
  return packs;
}
const packOf = (config, rel) => {
  const m = /^packs\/([^/]+)$/.exec(String(rel || ""));
  return m ? starterPacks(config).get(m[1]) || null : null;
};
export function readTitle(config, rel) {
  const pack = packOf(config, rel);
  return pack ? `The ${pack.title.toLowerCase()} pack` : brainTitle(rel);
}
// The starter's id for a pack the job reads that is one of the repo's starter packs and is not in the company's
// files yet (M63 41: the job's page offers to add it through POST /api/brain/starters); else null.
export function starterToAdd(config, rel, state) {
  const pack = state === "missing" ? packOf(config, rel) : null;
  return pack ? pack.id : null;
}

function optionsOf(ask, job, runs, config) {
  switch (ask.kind) {
    case "choice": return ask.options.map((o) => ({ value: o, label: o, ref: null }));
    case "file": return brainFiles(config, ask.folder, { max: FILE_OPTIONS }).map((f) => ({ value: f.path, label: f.name, ref: null }));
    case "media": return roomFiles(config).map((f) => ({ value: f.name, label: f.name, ref: null }));
    case "task": {
      const from = job.takes && Array.isArray(job.takes.from) ? job.takes.from : [];
      const list = [];
      if (runs instanceof Map) for (const ref of from) for (const t of runs.get(ref)?.tasks || []) if (t.accepted) list.push(t);
      list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      // `ref` is the task's short ref (STH-20), for the page to match ?from= and to fill the preview; not shown.
      return list.slice(0, TASK_OPTIONS).map((t) => ({ value: t.taskId, label: taskOptionLabel(t), ref: t.identifier || null }));
    }
    default: return null;
  }
}

// What a job that follows earlier work needs first (M51 F6): the jobs it follows, by title, and the newest task
// started from one of them that waits for the owner to accept it (null when none does).
function takesOf(job, runs, catalogueJobs) {
  if (!job.takes) return null;
  const from = [...job.takes.from];
  const after = from.map((id) => ({ id, title: catalogueJobs?.get(id)?.title || id }));
  let waiting = null;
  if (runs instanceof Map) {
    const all = from.flatMap((ref) => runs.get(ref)?.tasks || []).filter((t) => t.waiting);
    all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (all[0]) waiting = { taskId: all[0].taskId, title: all[0].title || "A task" };
  }
  return { from, label: job.takes.label, after, waiting };
}

// jobView(job, { needs, runs, config, roles }) -> shape `job` (33.3). `runs` is runsIndex's Map (or this
// job's own entry); `needs` is needsState's answer.
export function jobView(job, { needs, runs, config, roles } = {}) {
  const ref = jobRef(job);
  const deps = loadDepartments(config).departments;
  const dep = deps.find((d) => d.id === job.department);
  const cluster = dep?.clusters.find((c) => c.id === job.cluster);
  const allRoles = Array.isArray(roles) ? roles : loadRoles(config, { log: () => {} });
  const own = runs instanceof Map ? runs.get(ref) : runs;
  const { ready, why } = readiness(job, needs, config);
  return {
    id: ref,
    department: { id: job.department, title: dep?.title || job.department },
    cluster: { id: job.cluster, title: cluster?.title || job.cluster },
    title: job.title, summary: job.summary, handoff: job.handoff, stage: job.stage, size: job.size, planFirst: job.planFirst,
    who: whoOf(job.who, allRoles),
    reads: job.reads.map((r) => {
      const state = brainFileState(config, r.file);
      return {
        file: r.file, title: readTitle(config, r.file), need: r.need, state,
        link: { page: "files", id: brainToken(r.file) }, starter: starterToAdd(config, r.file, state),
      };
    }),
    asks: job.asks.map((a) => ({ id: a.id, label: a.label, kind: a.kind, required: a.required, options: optionsOf(a, job, runs, config) })),
    takes: takesOf(job, runs, job.takes ? loadCatalogue(config).jobs : null),
    text: job.text,
    ready, why,
    runs: own ? { total: own.total, accepted: own.accepted, working: own.working, needsYou: own.needsYou, last: own.last ? { ...own.last } : null } : NO_RUNS(),
  };
}
