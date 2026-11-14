// CONTRACTS-V3 31.3 and 33.3: GET /api/jobs (the catalogue as the Jobs page shows it), GET /api/jobs/:department/:id
// (one job, with the tasks started from it) and POST /api/jobs/:department/:id/start (start one).
// Starting a job writes the text agents act on, so it is built only from the job file (the repo's), the owner's
// answers (cleaned and capped by kind), names from the brain's and the room's own listings, and an earlier
// task's identifier from the board. Nothing an agent wrote goes into it, and a task is "from a job" or "follows
// a task" only by the records written here, after the board created the task (docs/adr/0007).
// Version 5 (PLAN-V5 K7, K9): a job with craft may be started with one or three versions; three adds one fixed
// sentence naming directions from the repo's directions.json, and the playbooks and review lines come from the
// repo's craft.json. Which direction the owner picked before, and which version of an earlier task, come only
// from the home server's own `pick:` records. Work that follows a research task (K10) is pointed at the research
// folder, by the earlier task's `template:` record.
// Step 3 (PLAN-V5 C9, C10): pressing Start on a still job ("Variations of a still", "A larger, sharper still") is
// the owner's approval of exactly its cost. The cost is worked out here from the models chosen in Settings and the
// door's own prices, checked against the switch, the key and what is left of today's and this month's limits (all
// read again now), and written as a one-take batch for the new task; its text names the batch. Nothing else is
// approved: a batch that cannot be written cancels the task.
import { directionsFor, pickDirections } from "../../../company/lib/craft-files.mjs";
import { generationNow, newBatchId, removeBatch, writeBatch } from "../lib/batches.mjs";
import { HomeError } from "../lib/errors.mjs";
import { needIds, summary } from "../lib/goals.mjs";
import {
  chosenModels, craftOf, estimateOf, jobRef, jobView, loadCatalogue, loadCraftTable, moneyOf, needsState, NO_PRICE_WORDS, runsIndex, WHY,
} from "../lib/jobs.mjs";
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
// When other work is ahead in the Chief of staff's line (lib/turn.mjs), no time is promised (M63). A job with
// craft says the time its job page says for the versions chosen (K9's words, `estimate`), not "a few minutes".
const aheadWords = (n) => (n === 1 ? "1 task is" : `${n} tasks are`);
export function startedMessage(queue, estimate = null) {
  const n = queue && Number.isInteger(queue.ahead) ? queue.ahead : 0;
  if (n > 0) return `Started. The Chief of staff has it. Waiting its turn: ${aheadWords(n)} ahead of it. It is checked before it reaches you.`;
  if (typeof estimate === "string" && estimate) return `Started. The Chief of staff has it. ${estimate} when nothing else is ahead. It is checked before it reaches you.`;
  return STARTED;
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
// Version 5 (K9) adds the playbooks line, any "Review:" line and the three-versions sentence; step 3 (C9, C11) the
// film's markers and the batch line, with any spacing between their words.
const MARKER_LINE = /^(FOR:|PLAN FIRST\b|PLAN READY:|PLAN ACCEPTED\b|ANSWER:|STOPPED:|RESULT:|VERDICT:|ROUTINE:|SIZE:|JOB:|ASK\s*$|Read first, from the company's files:|Read first, from the playbooks:|Review:|Make three versions\b|Produce:|SHOTLIST\s*READY\s*:|SHOTLIST\s*ACCEPTED|CLIPS\s*:|ANOTHER\s*ROUND|Generation\s*batch\s*:)/i;
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
      return { place: earlierPlace(ctx, earlier.identifier, earlier.id), identifier: earlier.identifier, taskId: earlier.id };
    }
    default: throw bad(ctx, ask);
  }
}

// The job's text with every [id] replaced, in one pass (an answer that holds "[x]" is never replaced again).
// An empty optional answer leaves nothing, and the space before it goes with it. An answer that ends a sentence
// where the job's text ends one too keeps one full stop ("the office.. Keep it" on the live engine, M63).
function fillText(text, places) {
  const filled = text.replace(/( ?)\[([a-z][a-z0-9-]{0,30})\]/g, (all, space, id, at, whole) => {
    if (!Object.hasOwn(places, id)) return all;
    const said = whole[at + all.length] === "." ? String(places[id]).replace(/\.+$/, "") : places[id];
    return said === "" ? "" : `${space}${said}`;
  });
  // A line an answer made that reads as a marker is kept as quoted words, never as a marker.
  return filled.split("\n").map((l) => (MARKER_LINE.test(asMarkerReads(l)) ? `> ${l.trim()}` : l)).join("\n").trim();
}

// ---- versions and picks (K7, K9)

const VARIANT = /^[abc]$/;

// The version the owner picked of an earlier task, from the home server's own `pick:` record (the newest entry
// that names one), or null.
export function pickedVersion(ctx, taskId) {
  const rec = ctx.decisions.get(`pick:${taskId}`);
  const list = Array.isArray(rec) ? rec : rec && typeof rec === "object" ? [rec] : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const v = list[i] && typeof list[i] === "object" ? list[i].variant : null;
    if (typeof v === "string" && VARIANT.test(v)) return v;
  }
  return null;
}

// Where an earlier task's work is, as the text says it; with the owner's pick when there is one (K9). A task
// started from a job of the cluster `research` (by its `template:` record) left its work in the research folder,
// which every other agent reads at $UUU_RESEARCH_DIR (K10).
function earlierPlace(ctx, identifier, taskId) {
  const ref = ctx.decisions.get(`template:${taskId}`);
  const from = typeof ref === "string" ? loadCatalogue(ctx.config).jobs.get(ref) : null;
  if (from && from.cluster === "research") return `the sub-folder ${identifier} of the research folder, $UUU_RESEARCH_DIR`;
  const v = pickedVersion(ctx, taskId);
  const place = `the sub-folder ${identifier} of your current working folder`;
  return v ? `${place} (use version ${v} there: the owner picked it)` : place;
}

// How many versions the owner asked for: 1 or 3, the job's default when the body says nothing. Only a job whose
// craft allows three may have three; anything else is a bad answer.
function versionsOf(ctx, craft, raw) {
  const refuse = () => ctx.fail(400, "That number of versions does not fit this job.",
    "Choose one version, or three where the job offers them.", "bad_answer");
  if (raw === undefined || raw === null) return craft ? (craft.variants === 3 ? 3 : 1) : 1;
  if (raw !== 1 && raw !== 3) throw refuse();
  if (raw === 3 && craft?.variants !== 3) throw refuse();
  return raw;
}

// The direction the owner picked most recently for this kind of work, from the `pick:` records of earlier
// tasks whose job makes the same kind (by the directions they share), or null.
function keptDirection(ctx, tctx, kind) {
  const family = directionsFor(kind).map((d) => d.id);
  if (!family.length || !tctx) return null;
  const catalogue = loadCatalogue(ctx.config);
  const craft = loadCraftTable(ctx.config).jobs;
  let best = null;
  for (const g of tctx.goals) {
    const ref = ctx.decisions.get(`template:${g.id}`);
    const c = typeof ref === "string" && catalogue.jobs.has(ref) ? craft.get(ref) : null;
    if (!c) continue;
    const theirs = directionsFor(c.kind).map((d) => d.id);
    if (theirs.join(",") !== family.join(",")) continue;
    const rec = ctx.decisions.get(`pick:${g.id}`);
    for (const p of Array.isArray(rec) ? rec : []) {
      if (!p || typeof p !== "object" || typeof p.direction !== "string" || !family.includes(p.direction) || !VARIANT.test(String(p.variant))) continue;
      const at = Date.parse(p.at);
      const t = Number.isFinite(at) ? at : 0;
      if (!best || t > best.t) best = { id: p.direction, t };
    }
  }
  return best ? best.id : null;
}

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

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
      : why.link.page === "settings" ? "Open Settings, then start the job."
        : "Open Health to see what to do next.";
  return ctx.fail(409, why.text, next, "job_not_ready");
}

// ---- what a still job spends (C9)

const LEDGER_UNREADABLE = "The spending ledger cannot be read, so nothing will be made. Health shows what to do.";
const NOT_RECORDED = "The cost could not be recorded, so the job was not started.";
const MOST_VARIATIONS = 3;

// A job that needs the generation door cannot start when the model chosen in Settings has no price (its page says so).
const noPrice = (ctx) => ctx.fail(409, NO_PRICE_WORDS, "Choose another model in Settings, then start the job.", "no_price");

// The shots a still job's Start approves and their cost: v1 to vN of `still_variation` with models.still (N the
// owner's answer to `count`), or u1 of `still_upscale` with models.upscale, priced by the door's own table. The
// switch, the key, the models, the ledger and the limits are read now, not from the 60-second needs. -> { shots,
// cost }; throws the refusal (job_not_ready, no_price, ledger_unreadable, over_limit), and nothing is written.
function stillCost(ctx, job, kind, record) {
  const gen = generationNow(ctx.config, Date.now());
  if (!gen.on || !gen.key) throw notReady(ctx, { name: "generation", text: WHY.generation[0], link: { ...WHY.generation[1] } });
  const money = moneyOf(job, gen.models, { centsPerCredit: gen.centsPerCredit });
  if (!money || !money.ok) throw noPrice(ctx);
  let count = 1;
  if (kind === "variations") {
    const ask = job.asks.find((a) => a.id === "count");
    count = /^[1-9]$/.test(String(record.count ?? "")) ? Number(record.count) : 0;
    if (!ask || count < 1 || count > MOST_VARIATIONS) throw bad(ctx, ask || { label: "How many variations?" });
  }
  const shots = kind === "variations"
    ? Array.from({ length: count }, (_, i) => ({ id: `v${i + 1}`, kind: "still_variation", model: money.model }))
    : [{ id: "u1", kind: "still_upscale", model: money.model }];
  const cost = money.unit * shots.length;
  if (!gen.ledgerOk) throw ctx.fail(409, LEDGER_UNREADABLE, "Open Health to see what to do next.", "ledger_unreadable");
  if (cost > gen.dayLeft) {
    throw ctx.fail(409, `This costs more than is left of today's limit (${gen.dayLeft} credits). Raise it in Settings, or start it tomorrow.`,
      "Open Settings, then start the job.", "over_limit");
  }
  if (cost > gen.monthLeft) {
    throw ctx.fail(409, `This costs more than is left of this month's limit (${gen.monthLeft} credits). Raise it in Settings, or start it next month.`,
      "Open Settings, then start the job.", "over_limit");
  }
  return { shots, cost };
}

// The batch for a still job's new task: one take a shot, its budget the door's prices (lib/batches.mjs works it out
// again and reads the file back with the door's own reader). When it cannot be written, or comes out at another
// cost than the one checked, the task is cancelled and the start fails: nothing was approved.
async function writeStillBatch(ctx, ref, created, id, still) {
  try {
    if (!created || typeof created.id !== "string") throw new Error("the board gave no task id");
    const written = writeBatch(ctx.config, { id, task: created.id, slug: "artist", shots: still.shots, takes: 1, textToVideo: false });
    if (written.budget !== still.cost) {
      removeBatch(ctx.config, written.id);
      throw new Error("the batch's budget is not the cost checked");
    }
  } catch (e) {
    ctx.log(`jobs: the batch for a start of ${ref} could not be written: ${String(e?.code && e.code !== "error" ? e.code : e?.message || e).split("\n")[0]}`);
    if (created && typeof created.id === "string") {
      try {
        await ctx.board.patch(`/api/issues/${encodeURIComponent(created.id)}`, { status: "cancelled" });
      } catch (c) {
        ctx.log(`jobs: the task of a start of ${ref} could not be cancelled: ${String(c?.message || c).split("\n")[0]}`);
      }
    }
    throw ctx.fail(500, NOT_RECORDED, "Try again in a minute. If it keeps happening, look at Health.", "batch_not_written");
  }
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
      problems: [...depProblems, ...catalogue.problems, ...loadCraftTable(ctx.config).problems.map((problem) => ({ file: "brand/craft.json", problem }))],
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
    // A job that needs the generation door cannot start without a price for the model chosen in Settings (C9).
    const money = job.needs.includes("generation") ? moneyOf(job, chosenModels(ctx.config)) : null;
    if (money && !money.ok) throw noPrice(ctx);
    const craft = craftOf(ctx.config, job);
    const versions = versionsOf(ctx, craft, body.versions);

    // The board is read only when an earlier task or the owner's earlier picks are involved; with it off the
    // start fails as the board call would.
    const hasFrom = body.from !== undefined && body.from !== null && body.from !== "";
    const taskAsks = job.asks.filter((a) => a.kind === "task");
    let tctx = null;
    if (hasFrom || taskAsks.length || versions === 3) tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
    const runs = tctx ? runsIndex(ctx, tctx) : new Map();
    const view = jobView(job, { needs, runs, config: ctx.config, roles });
    const offeredOf = (id) => view.asks.find((a) => a.id === id)?.options || null;

    let earlier = hasFrom ? earlierTask(ctx, job, tctx, body.from) : null;
    const places = {};
    const record = {};
    for (const ask of job.asks) {
      if (earlier && job.takes && ask.id === job.takes.ask) {
        // Answered by the server from the board; a value for it in the body is ignored.
        places[ask.id] = earlierPlace(ctx, earlier.identifier, earlier.id);
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
    // Three versions: one fixed sentence after the job's own text, with directions from the repo's list (K7).
    let directions = null;
    let text = fillText(job.text, places);
    if (versions === 3) {
      directions = pickDirections({ kind: craft.kind, kept: keptDirection(ctx, tctx, craft.kind) });
      if (directions.length !== 3) {
        throw ctx.fail(400, "This job cannot make three versions yet.", "Choose one version, then start the job.", "bad_answer");
      }
      text = `${text}\n\nMake three versions, one in each of these directions: ${directions.map((d) => oneLine(d.title)).join(", ")}. Write variants.json as your instructions say.`;
    }
    // A still job's cost, approved by this Start (C9): checked now, before the board is asked, and its batch named in
    // the text. A film's cost is approved later, on its shotlist card.
    const still = money && money.kind !== "film" ? stillCost(ctx, job, money.kind, record) : null;
    const batch = still ? newBatchId() : null;
    const description = buildText({
      text, to, planFirst: job.planFirst || body.planFirst === true,
      reads: job.reads, produces: job.produces, job: ref,
      ...(craft ? { playbooks: craft.playbooks, review: craft.review } : {}),
      ...(batch ? { batch } : {}),
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
    // The owner's approved cost of a still job, for this task only; the task is cancelled when it cannot be written.
    if (still) await writeStillBatch(ctx, ref, created, batch, still);
    if (created && typeof created.id === "string") {
      const kept = {};
      for (const [k, v] of Object.entries(record)) kept[k] = String(v).slice(0, RECORD_MAX);
      // Write-once records (lib/decisions.mjs): a replayed start can never change them.
      ctx.decisions.set(`template:${created.id}`, ref);
      // A job with craft also keeps the number of versions, and with three the directions asked for (K9); a still
      // job keeps the batch its Start approved (C9).
      ctx.decisions.set(`asked:${created.id}`, {
        ...(craft
          ? { answers: kept, versions, ...(directions ? { directions: directions.map((d) => d.id) } : {}) }
          : { answers: kept }),
        ...(batch ? { batch } : {}),
      });
      if (earlier) ctx.decisions.set(`from:${created.id}`, earlier.id);
    }
    const estimate = craft ? estimateOf(job, craft, versions)?.words : null;
    return { status: 201, body: { goal: summary(created, [created]), message: startedMessage(queue, estimate), queue } };
  });
}
