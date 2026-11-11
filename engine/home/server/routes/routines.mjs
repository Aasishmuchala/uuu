// CONTRACTS-V2 17.6: the routines. The list is the routine files (section 18), joined to the board's
// routines through ids.json (`routines`), else by title. Writes talk to the board as the owner, and the
// board id they use always comes from that join, never from the address: the address carries only the
// file's id. Everything the board says (titles, run notes, failure reasons) is untrusted: titles are
// capped, a failure text is never passed on, and run notes are our own sentences.
import { join } from "node:path";
import { loadRoutineFiles } from "../../../company/lib/routine-files.mjs";
import { HomeError } from "../lib/errors.mjs";
import { loadRoles } from "../lib/team.mjs";

const ROUTINE_ID = /^[a-z][a-z0-9-]{1,40}$/;
const MAX_TITLE = 200;
const MAX_RUNS = 20;

const STATE_PLAIN = { on: "On", paused: "Paused", not_applied: "Not set up yet" };
const RUN_PLAIN = { starting: "Starting", working: "Working", finished: "Finished", failed: "Failed", skipped: "Skipped" };
const FAILED_NOTE = "It did not finish. Try running it again, or look at Health.";

// The folder of routine files: engine/company/routines, unless a test pointed this config elsewhere.
const dirs = new WeakMap();
export function useRoutinesDir(config, dir) {
  if (dir) dirs.set(config, dir);
  else dirs.delete(config);
}
export function routinesDir(config) {
  return dirs.get(config) || join(config.engineDir, "company", "routines");
}

const str = (v, max = MAX_TITLE) => (typeof v === "string" ? v.slice(0, max) : null);
const iso = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const enc = encodeURIComponent;

function notFound() {
  return new HomeError(404, "There is no such routine.", "Pick a routine from the Routines page.", "routine_not_found");
}
function notApplied() {
  return new HomeError(409, "This routine is not set up yet.", "Run: engine setup", "routine_not_applied");
}
function notReady() {
  return new HomeError(409, "This routine cannot run right now.", "Switch it on first, or wait for the run in progress.", "routine_not_ready");
}

function readFiles(ctx) {
  const roles = loadRoles(ctx.config);
  let out;
  try {
    out = loadRoutineFiles(routinesDir(ctx.config), roles);
  } catch {
    out = { routines: [], problems: [{ file: "routines", problem: "The routine files could not be read." }] };
  }
  const routines = (Array.isArray(out?.routines) ? out.routines : [])
    .filter((r) => r && typeof r.id === "string" && ROUTINE_ID.test(r.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const problems = (Array.isArray(out?.problems) ? out.problems : [])
    .map((p) => ({ file: str(p?.file, 120) || "", problem: str(p?.problem, 400) || "It could not be read." }));
  return { routines, problems, roles };
}

// The board's routines, or { error } when the board is off or the company is not set up.
async function boardRoutines(ctx) {
  try {
    const companyId = await ctx.board.companyId();
    const list = await ctx.board.get(`/api/companies/${enc(companyId)}/routines`);
    return { list: Array.isArray(list) ? list.filter((r) => r && typeof r.id === "string") : [] };
  } catch (e) {
    if (e instanceof HomeError) return { error: e };
    throw e;
  }
}

// The board routine for a file: ids.json first, else the same title.
function joinOf(file, list, ids) {
  const boardId = ids?.routines && typeof ids.routines === "object" ? ids.routines[file.id] : null;
  if (typeof boardId === "string" && boardId) {
    const byId = list.find((r) => r.id === boardId);
    if (byId) return byId;
  }
  return list.find((r) => typeof r.title === "string" && r.title === file.title) || null;
}

function runState(status, linkedIssue) {
  switch (status) {
    case "received": return "starting";
    case "issue_created": {
      const s = linkedIssue && typeof linkedIssue === "object" ? linkedIssue.status : null;
      return s === "done" || s === "cancelled" ? "finished" : "working";
    }
    case "completed": return "finished";
    case "failed": return "failed";
    default: return "skipped";
  }
}

function runNote(state, status) {
  if (state === "failed") return FAILED_NOTE;
  if (state === "skipped") return status === "coalesced" ? "It was already running." : "The routine was paused.";
  return null;
}

function lastRunOf(board) {
  const run = board?.lastRun;
  if (!run || typeof run !== "object") return null;
  const state = runState(run.status, run.linkedIssue);
  const issue = run.linkedIssue && typeof run.linkedIssue === "object" ? run.linkedIssue : null;
  return {
    at: iso(run.triggeredAt), state, plainState: RUN_PLAIN[state],
    taskId: str(run.linkedIssueId, 100) || str(issue?.id, 100),
    identifier: str(issue?.identifier, 40),
  };
}

function runEntry(run) {
  const state = runState(run.status, run.linkedIssue);
  const issue = run.linkedIssue && typeof run.linkedIssue === "object" ? run.linkedIssue : null;
  return {
    id: str(run.id, 100) || "",
    at: iso(run.triggeredAt),
    source: typeof run.source === "string" && /^[a-z_]{1,20}$/.test(run.source) ? run.source : "other",
    state, plainState: RUN_PLAIN[state],
    taskId: str(run.linkedIssueId, 100) || str(issue?.id, 100),
    identifier: str(issue?.identifier, 40),
    title: str(issue?.title),
    note: runNote(state, run.status),
  };
}

function scheduleTrigger(board) {
  const list = Array.isArray(board?.triggers) ? board.triggers : [];
  return list.find((t) => t && t.kind === "schedule" && t.enabled !== false) || list.find((t) => t && t.kind === "schedule") || null;
}

// One entry of the list: the file, with the state the board gives it (null board: not set up yet).
function entryOf(file, board, roles) {
  const role = roles.find((r) => r.slug === file.agent);
  const who = { slug: str(file.agent, 60) || "", name: role ? role.name : str(file.agent, 60) || "" };
  const state = !board ? "not_applied" : board.status === "active" ? "on" : "paused";
  const on = state === "on";
  return {
    id: file.id,
    title: str(file.title, 80) || file.id,
    who,
    when: { plain: str(file.when?.plain, 40) || "", next: on ? iso(scheduleTrigger(board)?.nextRunAt) : null },
    state, plainState: STATE_PLAIN[state],
    ask: str(file.ask, 2000) || "",
    produces: Array.isArray(file.produces) ? file.produces.filter((p) => typeof p === "string").slice(0, 5) : [],
    runMinutes: Number.isInteger(file.runMinutes) ? file.runMinutes : null,
    lastRun: board ? lastRunOf(board) : null,
  };
}

// For a write: the file named by the address, and its board routine from the join.
async function target(ctx) {
  const id = ctx.params.id;
  if (typeof id !== "string" || !ROUTINE_ID.test(id)) throw notFound();
  const { routines, roles } = readFiles(ctx);
  const file = routines.find((r) => r.id === id);
  if (!file) throw notFound();
  const got = await boardRoutines(ctx);
  if (got.error) throw got.error;
  const board = joinOf(file, got.list, ctx.ids());
  if (!board) throw notApplied();
  return { file, board, roles };
}

async function setStatus(ctx, status) {
  const { file, board, roles } = await target(ctx);
  const changed = await ctx.board.patch(`/api/routines/${enc(board.id)}`, { status });
  const after = changed && typeof changed === "object" && changed.id === board.id ? changed : { ...board, status };
  return { ok: true, routine: entryOf(file, after, roles) };
}

export default function register(app) {
  app.get("/api/routines", async (ctx) => {
    const { routines, problems, roles } = readFiles(ctx);
    const got = await boardRoutines(ctx);
    if (got.error) {
      return {
        connected: false, notConnected: { reason: got.error.message, next: got.error.next },
        routines: routines.map((f) => entryOf(f, null, roles)), problems,
      };
    }
    const ids = ctx.ids();
    return {
      connected: true, notConnected: null,
      routines: routines.map((f) => entryOf(f, joinOf(f, got.list, ids), roles)), problems,
    };
  });

  app.get("/api/routines/:id", async (ctx) => {
    const id = ctx.params.id;
    if (typeof id !== "string" || !ROUTINE_ID.test(id)) throw notFound();
    const { routines, roles } = readFiles(ctx);
    const file = routines.find((r) => r.id === id);
    if (!file) throw notFound();
    const got = await boardRoutines(ctx);
    const board = got.error ? null : joinOf(file, got.list, ctx.ids());
    if (!board) return { routine: entryOf(file, null, roles), runs: [] };
    let runs = [];
    try {
      const list = await ctx.board.get(`/api/routines/${enc(board.id)}/runs?limit=${MAX_RUNS}`);
      runs = (Array.isArray(list) ? list : []).filter((r) => r && typeof r === "object")
        .sort((a, b) => (Date.parse(b.triggeredAt) || 0) - (Date.parse(a.triggeredAt) || 0))
        .slice(0, MAX_RUNS).map(runEntry);
    } catch (e) {
      if (!(e instanceof HomeError)) throw e;
      runs = [];
    }
    return { routine: entryOf(file, board, roles), runs };
  });

  app.post("/api/routines/:id/run", async (ctx) => {
    const { board } = await target(ctx);
    try {
      await ctx.board.post(`/api/routines/${enc(board.id)}/run`, {});
    } catch (e) {
      if (e instanceof HomeError && (e.upstreamStatus === 409 || e.upstreamStatus === 422)) throw notReady();
      throw e;
    }
    return { ok: true, message: "Started. It will show under Tasks in a moment." };
  });

  app.post("/api/routines/:id/pause", (ctx) => setStatus(ctx, "paused"));
  app.post("/api/routines/:id/resume", (ctx) => setStatus(ctx, "active"));
}
