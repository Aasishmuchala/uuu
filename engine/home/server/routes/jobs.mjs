// CONTRACTS-V3 31.3 and 33.3: GET /api/jobs (the catalogue as the Jobs page shows it), GET /api/jobs/:department/:id
// (one job, with the tasks started from it) and POST /api/jobs/:department/:id/start (start one).
// Starting a job writes the text agents act on, so it is built only from the job file (the repo's), the owner's
// answers (cleaned and capped by kind), names from the brain's and the room's own listings, and an earlier
// task's identifier from the board. Nothing an agent wrote goes into it, and a task is "from a job" or "follows
// a task" only by the records written here, after the board created the task (docs/adr/0007).
import { HomeError } from "../lib/errors.mjs";
import { needIds, summary } from "../lib/goals.mjs";
import { jobRef, jobView, loadCatalogue, needsState, runsIndex } from "../lib/jobs.mjs";
import { loadDepartments } from "../lib/departments.mjs";
import { stripInvisible } from "../lib/owner-text.mjs";
import { buildText } from "../lib/staged.mjs";
import { loadRoles } from "../lib/team.mjs";
import { findTask, loadTaskContext, taskCard } from "../lib/tasks.mjs";
import { aheadIn, chiefQueue } from "../lib/turn.mjs";
import { titleOf } from "./goals.mjs";

const RECENT = 10;
const RECORD_MAX = 300;
const CAPS = { line: 200, text: 2000 };
const STARTED = "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you.";
// When other work is ahead in the Chief of staff's line (lib/turn.mjs), no time is promised (M63).
const aheadWords = (n) => (n === 1 ? "1 task is" : `${n} tasks are`);
export function startedMessage(queue) {
  const n = queue && Number.isInteger(queue.ahead) ? queue.ahead : 0;
  return n > 0 ? `Started. The Chief of staff has it. Waiting its turn: ${aheadWords(n)} ahead of it. It is checked before it reaches you.` : STARTED;
}
const IDENTIFIER = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;

// Section 25: the hand-off tags and the stages, in their order.
const HANDOFFS = [
  { id: "you-lead", label: "You lead", about: "The agent gets things ready. You do the main part." },
  { id: "you-approve", label: "You approve", about: "The agent does the work. It counts only when you approve it." },
  { id: "on-its-own", label: "On its own", about: "The agent does it to the end and it is checked. You read the result." },
];
const STAGES = [
  { n: 1, label: "Foundations", about: "Fill the company brain, so work sounds like your company." },
  { n: 2, label: "Take in", about: "Jobs that read and sort what comes in." },
  { n: 3, label: "Make", about: "Jobs that produce work." },
  { n: 4, label: "Hand on", about: "Work passed from one agent to the next, with nothing copied by hand." },
];

// A line of the text that an agent, or textOf, could read as a marker (CONTRACTS-V2 15.1, CONTRACTS-V3 31.3, 34).
const MARKER_LINE = /^(FOR:|PLAN FIRST\b|PLAN READY:|PLAN ACCEPTED\b|ANSWER:|STOPPED:|RESULT:|VERDICT:|ROUTINE:|SIZE:|JOB:|ASK\s*$|Read first, from the company's files:|Produce:)/i;
// A line as a reader of markers might see it: compatibility forms folded (full-width letters), every
// invisible or formatting character dropped, and any kind of space at its start gone (the blank U+2800 too).
// MARKER_LINE ignores case.
const asMarkerReads = (l) => l.normalize("NFKC").replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, "").replace(/^[\s\p{Z}\u2800]+/u, "");
const BREAKS = /\r\n?|\u2028|\u2029|\u0085/g;

// The task model, or null when the board cannot be read (off, or the company not set up).
async function taskModel(ctx, options) {
  try {
    return await loadTaskContext(ctx, options);
  } catch (e) {
    if (!(e instanceof HomeError)) throw e;
    return null;
  }
}

function findJob(ctx) {
  const catalogue = loadCatalogue(ctx.config);
  const job = catalogue.jobs.get(`${ctx.params.department}/${ctx.params.id}`);
  if (!job) throw ctx.fail(404, "There is no such job.", "Go back to the list of jobs.", "job_not_found");
  return { job, catalogue };
}

// ---- the owner's answers

const missing = (ctx, ask) => ctx.fail(400, `Fill in: ${ask.label}`, "Fill it in, then start the job again.", "missing_answer");
const bad = (ctx, ask) => ctx.fail(400, `That answer does not fit: ${ask.label}`, "Change it, then start the job again.", "bad_answer");

// One answer as the owner's words: trimmed, control and invisible characters removed (lib/owner-text.mjs), line breaks kept only for `text`, capped.
// -> "" (empty) or the clean value. A line break in any other kind is refused.
function cleanAnswer(ctx, ask, raw) {
  if (raw === undefined || raw === null) return "";
  if (ask.kind === "number" && typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") throw bad(ctx, ask);
  let s = raw.length > 20000 ? raw.slice(0, 20000) : raw;
  s = s.replace(/\t/g, " ");
  if (ask.kind === "text") s = s.replace(BREAKS, "\n");
  else if (/[\n\r\u2028\u2029\u0085]/.test(s)) throw bad(ctx, ask);
  s = stripInvisible(s).trim();
  if (ask.kind === "text") s = s.split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n");
  const cap = CAPS[ask.kind];
  if (cap && s.length > cap) s = s.slice(0, cap).trimEnd();
  return s;
}

const validDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

// The value as it goes into the text, for a clean non-empty answer; `offered` is jobView's options for the ask.
function placeOf(ctx, ask, value, offered, tctx) {
  const isOffered = () => Array.isArray(offered) && offered.some((o) => o.value === value);
  switch (ask.kind) {
    case "line": case "text": return value;
    case "date": if (!validDate(value)) throw bad(ctx, ask); return value;
    case "number": {
      if (!/^\d{1,7}$/.test(value) || Number(value) > 1000000) throw bad(ctx, ask);
      return String(Number(value));
    }
    case "choice": if (!isOffered()) throw bad(ctx, ask); return value;
    case "file": if (!isOffered()) throw bad(ctx, ask); return `the company file ${value}`;
    case "media": if (!isOffered()) throw bad(ctx, ask); return `the file ${value} in the room`;
    case "task": {
      if (!isOffered() || !tctx) throw bad(ctx, ask);
      const earlier = findTask(tctx, value);
      if (!earlier || !IDENTIFIER.test(String(earlier.identifier || ""))) throw bad(ctx, ask);
      return { place: `the sub-folder ${earlier.identifier} of your current working folder`, identifier: earlier.identifier, taskId: earlier.id };
    }
    default: throw bad(ctx, ask);
  }
}

// The job's text with every [id] replaced, in one pass (an answer that holds "[x]" is never replaced again).
// An empty optional answer leaves nothing, and the space before it goes with it.
function fillText(text, places) {
  const filled = text.replace(/( ?)\[([a-z][a-z0-9-]{0,30})\]/g, (all, space, id) => {
    if (!Object.hasOwn(places, id)) return all;
    return places[id] === "" ? "" : `${space}${places[id]}`;
  });
  // A line an answer made that reads as a marker is kept as quoted words, never as a marker.
  return filled.split("\n").map((l) => (MARKER_LINE.test(asMarkerReads(l)) ? `> ${l.trim()}` : l)).join("\n").trim();
}

// ---- the earlier task (`from`)

function earlierTask(ctx, job, tctx, from) {
  const notFrom = () => ctx.fail(400, "That earlier task cannot be used for this job.",
    "Pick one of the tasks offered for this job.", "bad_from");
  if (typeof from !== "string" || !from || from.length > 100 || !job.takes) throw notFrom();
  const earlier = findTask(tctx, from);
  if (!earlier) throw notFrom();
  const ref = ctx.decisions.get(`template:${earlier.id}`);
  if (typeof ref !== "string" || !job.takes.from.includes(ref)) throw notFrom();
  if (!(earlier.status === "done" && tctx.accepted(earlier.id))) {
    throw ctx.fail(409, "That earlier task is not accepted yet.", "Accept it first, then start this one.", "from_not_accepted");
  }
  if (!IDENTIFIER.test(String(earlier.identifier || ""))) throw notFrom();
  return earlier;
}

// What an earlier task was about, from the home server's own records only (never its title on the board, which an
// agent can change): the subject of the work it followed, when it followed some; else its own first one-line
// answer; else the first line of its first longer answer. null when the records say nothing.
const SUBJECT_MAX = 80;
export function subjectOf(ctx, taskId, depth = 0) {
  if (typeof taskId !== "string" || !taskId || depth > 5) return null;
  const from = ctx.decisions.get(`from:${taskId}`);
  const before = typeof from === "string" ? subjectOf(ctx, from, depth + 1) : null;
  if (before) return before;
  const ref = ctx.decisions.get(`template:${taskId}`);
  const job = typeof ref === "string" ? loadCatalogue(ctx.config).jobs.get(ref) : null;
  const rec = ctx.decisions.get(`asked:${taskId}`);
  const answers = rec && typeof rec === "object" && rec.answers && typeof rec.answers === "object" ? rec.answers : null;
  if (!job || !answers) return null;
  const said = (a) => (typeof answers[a.id] === "string" ? stripInvisible(answers[a.id]).split("\n")[0].replace(/\s+/g, " ").trim() : "");
  const ask = job.asks.find((a) => a.kind === "line" && said(a)) || job.asks.find((a) => a.kind === "text" && said(a));
  if (!ask) return null;
  const t = said(ask);
  return t.length > SUBJECT_MAX ? `${t.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : t;
}

function notReady(ctx, why) {
  const next = !why.link ? "Pick another job for now."
    : why.link.page === "files" ? "Open Files and fill it in, then start the job."
      : "Open Health to see what to do next.";
  return ctx.fail(409, why.text, next, "job_not_ready");
}

export default function register(app) {
  app.get("/api/jobs", async (ctx) => {
    const { departments, problems: depProblems } = loadDepartments(ctx.config);
    const catalogue = loadCatalogue(ctx.config);
    const roles = loadRoles(ctx.config, { log: ctx.log });
    const [tctx, needs] = await Promise.all([taskModel(ctx, { withInbox: true, withComments: "open" }), needsState(ctx)]);
    const runs = tctx ? runsIndex(ctx, tctx) : new Map();
    const views = [];
    const out = departments.map((d) => {
      const own = (catalogue.byDepartment.get(d.id) || []).map((job) => jobView(job, { needs, runs, config: ctx.config, roles }));
      views.push(...own);
      return {
        id: d.id, title: d.title,
        clusters: d.clusters.map((c) => ({ id: c.id, title: c.title, jobs: own.filter((v) => v.cluster.id === c.id) })),
      };
    });
    return {
      departments: out,
      handoffs: HANDOFFS.map((x) => ({ ...x })),
      stages: STAGES.map((s) => {
        const mine = views.filter((v) => v.stage === s.n);
        return { ...s, jobs: mine.length, ready: mine.filter((v) => v.ready).length, tried: mine.filter((v) => v.runs.accepted > 0).length };
      }),
      totals: { jobs: views.length, ready: views.filter((v) => v.ready).length },
      problems: [...depProblems, ...catalogue.problems],
      generatedAt: new Date().toISOString(),
    };
  });

  app.get("/api/jobs/:department/:id", async (ctx) => {
    const { job } = findJob(ctx);
    const ref = jobRef(job);
    const roles = loadRoles(ctx.config, { log: ctx.log });
    const [tctx, needs] = await Promise.all([taskModel(ctx, { withInbox: true, withComments: "open" }), needsState(ctx)]);
    const runs = tctx ? runsIndex(ctx, tctx) : new Map();
    const recent = tctx
      ? tctx.goals.filter((g) => ctx.decisions.get(`template:${g.id}`) === ref).slice(0, RECENT).map((g) => taskCard(g, tctx))
      : [];
    // How many tasks the Chief of staff has now: a job started now waits behind them (null: the board did not say).
    const chief = tctx?.ids?.agents?.["chief-of-staff"] || null;
    const queue = tctx && Array.isArray(tctx.liveRuns) && chief ? aheadIn(tctx.liveRuns, { agentId: chief, rootOf: tctx.rootOf }) : null;
    return { job: jobView(job, { needs, runs, config: ctx.config, roles }), recent, queue };
  });

  app.post("/api/jobs/:department/:id/start", async (ctx) => {
    const { job } = findJob(ctx);
    const ref = jobRef(job);
    const body = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
    const answers = body.answers === undefined || body.answers === null ? {} : body.answers;
    if (typeof answers !== "object" || Array.isArray(answers)) {
      throw ctx.fail(400, "The answers could not be read.", "Fill in the form again, then start the job.", "bad_answer");
    }

    const needs = await needsState(ctx);
    const roles = loadRoles(ctx.config, { log: ctx.log });
    // Readiness first: a job that cannot start says why, whatever was filled in.
    const ready = jobView(job, { needs, runs: new Map(), config: ctx.config, roles });
    if (!ready.ready) throw notReady(ctx, ready.why);

    // The board is read only when an earlier task is involved; with it off the start fails as the board call would.
    const hasFrom = body.from !== undefined && body.from !== null && body.from !== "";
    const taskAsks = job.asks.filter((a) => a.kind === "task");
    let tctx = null;
    if (hasFrom || taskAsks.length) tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
    const runs = tctx ? runsIndex(ctx, tctx) : new Map();
    const view = jobView(job, { needs, runs, config: ctx.config, roles });
    const offeredOf = (id) => view.asks.find((a) => a.id === id)?.options || null;

    let earlier = hasFrom ? earlierTask(ctx, job, tctx, body.from) : null;
    const places = {};
    const record = {};
    for (const ask of job.asks) {
      if (earlier && job.takes && ask.id === job.takes.ask) {
        // Answered by the server from the board; a value for it in the body is ignored.
        places[ask.id] = `the sub-folder ${earlier.identifier} of your current working folder`;
        record[ask.id] = earlier.identifier;
        continue;
      }
      const value = cleanAnswer(ctx, ask, Object.hasOwn(answers, ask.id) ? answers[ask.id] : undefined);
      if (!value) {
        if (ask.required) throw missing(ctx, ask);
        places[ask.id] = "";
        continue;
      }
      const placed = placeOf(ctx, ask, value, offeredOf(ask.id), tctx);
      if (typeof placed === "string") {
        places[ask.id] = placed;
        record[ask.id] = value;
      } else {
        places[ask.id] = placed.place;
        record[ask.id] = placed.identifier;
        // An offered earlier task picked in the form is the same hand-on as `from`.
        if (!earlier && job.takes && ask.id === job.takes.ask) earlier = { id: placed.taskId, identifier: placed.identifier };
      }
    }

    const toRole = job.who.length === 1 ? roles.find((r) => r.slug === job.who[0]) : null;
    const to = toRole && toRole.slug !== "chief-of-staff" ? toRole.name : null;
    const firstLine = job.asks.find((a) => a.kind === "line" && typeof places[a.id] === "string" && places[a.id]);
    // A task that follows earlier work carries what that work was about (M63 item 47), so two of them read apart.
    const subject = (earlier && subjectOf(ctx, earlier.id)) || (firstLine ? places[firstLine.id] : null);
    const title = titleOf(subject ? `${job.title}: ${subject}` : job.title);
    const description = buildText({
      text: fillText(job.text, places), to, planFirst: job.planFirst || body.planFirst === true,
      reads: job.reads, produces: job.produces, job: ref,
    });

    const ids = needIds(ctx);
    const chief = ids.agents?.["chief-of-staff"];
    if (!chief) throw ctx.fail(409, "The Chief of staff is not set up yet.", "Run engine setup first.", "not_set_up");
    // The Chief of staff's line before the task joins it: everything in it is ahead of the new task.
    const queue = await chiefQueue(ctx);
    // Every start is a new task (M63 item 22). Unless told otherwise, the board treats a new task whose title
    // matches an open top-level task of the last 48 hours as that task and hands the old one back
    // (`allowDuplicate` defaults to false in paperclip's createIssueSchema; services/issues.js
    // "recent_open_title"), so a second start of a job with the same title merged into the first.
    const created = await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
      title, description, assigneeAgentId: chief, projectId: ids.projectId, status: "todo", priority: "medium",
      allowDuplicate: true,
    });
    // A task the board says it already had is not this start's: nothing is recorded for it, and the owner is told.
    if (created && created.deduplicated) {
      ctx.log(`jobs: the board handed back an existing task for a start of ${ref}; nothing was recorded`);
      throw ctx.fail(409, "This job was not started again: the board kept the earlier task.",
        "Open Tasks to find it, or start the job again in a minute.", "already_started");
    }
    if (created && typeof created.id === "string") {
      const kept = {};
      for (const [k, v] of Object.entries(record)) kept[k] = String(v).slice(0, RECORD_MAX);
      // Write-once records (lib/decisions.mjs): a replayed start can never change them.
      ctx.decisions.set(`template:${created.id}`, ref);
      ctx.decisions.set(`asked:${created.id}`, { answers: kept });
      if (earlier) ctx.decisions.set(`from:${created.id}`, earlier.id);
    }
    return { status: 201, body: { goal: summary(created, [created]), message: startedMessage(queue), queue } };
  });
}
