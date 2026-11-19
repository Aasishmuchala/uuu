// The stage's three datasets (PLAN-STRESS, pinned interfaces):
//   seedFor(dataset, { dest }) -> { board, bench, stateDir }
//   normal  the version 2 seed: boardSeedV2() and state-seed-v2 laid over state-seed (engine/test/stubs/seed.mjs)
//   empty   the company, its agents and its project only: no tasks, no files, empty basics, no routines, no jobs
//   large   normal, grown to 500 tasks over every status and stage, 200 documents in knowledge/docs, 120 Needs you
//           items, 50 jobs started, 30 routines; with hostile text in each kind (HOSTILE below)
// `dest` is the stage's state folder: it is made (and must not exist yet). `board` and `bench` are plain data, saved
// by the stage for the stub board's and stub books' runners. Nothing here starts a process or opens a socket.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IDS_V2, benchSeed, boardSeedV2, copyStateSeedV2 } from "../../test/stubs/seed.mjs";

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STUBS = join(ENGINE_DIR, "test", "stubs");

export const DATASETS = Object.freeze(["empty", "normal", "large"]);
export const LARGE = Object.freeze({ tasks: 500, docs: 200, needsYou: 120, jobs: 50, routines: 30 });

// One of each kind of hostile text; each kind of record carries all five.
export const HOSTILE = Object.freeze({
  long: `A very long title ${"word ".repeat(1000)}`.slice(0, 5000),
  script: "<script>alert(1)</script>",
  rtl: "‮عنوان من اليمين إلى اليسار‬",
  emoji: "🚀🔥🎉🧱🪵",
  dotdot: "../../secrets/provider/omega-key",
});
const HOSTILE_LIST = Object.values(HOSTILE);

const uid = (kind, n) => `${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T0 = Date.parse("2026-11-11T09:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const DOC_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(md|txt)$/;

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

// ---- empty -------------------------------------------------------------------------------------------------------

function emptyBoard() {
  const full = boardSeedV2();
  return {
    companies: full.companies.map((c) => ({ ...c, issueCounter: 0 })),
    agents: full.agents.map((a) => ({ ...a, status: "idle" })),
    projects: full.projects,
    issues: [], comments: [], approvals: [], attention: [], liveRuns: [], heartbeatRuns: [],
    tokens: full.tokens, instructions: full.instructions, memberGrants: full.memberGrants,
    recoveryActions: [], routines: [], routineTriggers: [], routineRuns: [],
  };
}

function emptyBench() {
  const b = benchSeed();
  const docs = {};
  for (const k of Object.keys(b.docs)) docs[k] = [];
  return { ...b, docs };
}

function emptyState(dest) {
  mkdirSync(join(dest, "tasks", "company-work"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dest, "home"), { recursive: true, mode: 0o700 });
  const ids = readFileSync(join(STUBS, "state-seed-v2", "ids.json"), "utf8").split("{state}").join(dest);
  writeFileSync(join(dest, "ids.json"), ids, { mode: 0o600 });
  writeJson(join(dest, "home", "decisions.json"), {});
}

// ---- large -------------------------------------------------------------------------------------------------------

const STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
// One comment per goal marks its stage, as the home reads them (docs/adr/0005 formats).
const STAGES = [
  null,
  "SIZE: M - a few steps, two agents.",
  "PLAN READY: The brief and the plan are written. I have published nothing.",
  "VERDICT: PASS - the work matches the brief.",
  "VERDICT: FAIL - one number does not add up.",
  "RESULT:\nThe work is done and is in the task's folder.",
  "STOPPED: five check rounds did not pass\nI have stopped; please tell me which figure to trust.",
];
const SLUGS = ["chief-of-staff", "builder", "checker", "bookkeeper", "sales", "support", "people", "marketer", "drafter", "artist"];

function jobRefs() {
  const root = join(ENGINE_DIR, "company", "jobs");
  const out = [];
  let deps = [];
  try { deps = readdirSync(root).sort(); } catch { deps = []; }
  for (const d of deps) {
    let files = [];
    try { files = readdirSync(join(root, d)).filter((f) => f.endsWith(".json")).sort(); } catch { files = []; }
    for (const f of files) out.push(`${d}/${f.slice(0, -5)}`);
  }
  return out.length ? out : ["sales/call-write-up"];
}

function growBoard(board) {
  const company = board.companies[0];
  const projectId = IDS_V2.project;
  const isGoal = (i) => !i.parentId && i.projectId === projectId;
  const have = board.issues.filter(isGoal).length;
  const need = Math.max(0, LARGE.tasks - have);
  const A = (slug) => IDS_V2.agents[slug];
  const issues = [];
  const comments = [];
  const goals = [];
  let n = 1000;
  let c = 100000;
  for (let k = 0; k < need; k += 1) {
    n += 1;
    const status = STATUSES[k % STATUSES.length];
    const hostile = k < HOSTILE_LIST.length ? HOSTILE_LIST[k] : null;
    const title = hostile || `Stress task ${k + 1}: ${["price list", "launch post", "bill check", "site page", "staff leave", "carousel", "quotation"][k % 7]}`;
    const minutes = -20000 + k * 37;
    const id = uid("e5000000", n);
    const goal = {
      id, companyId: company.id, projectId, goalId: null, parentId: null, title,
      description: hostile ? `${hostile}\n\n${hostile}` : `${title}. Planted by the stress seed.`,
      status, priority: ["low", "medium", "high", "urgent"][k % 4], assigneeAgentId: A(SLUGS[k % SLUGS.length]), assigneeUserId: null,
      identifier: `STH-${n}`, issueNumber: n, createdByUserId: "local-board", createdByAgentId: null,
      createdAt: at(minutes), updatedAt: at(minutes + 30),
      ...(status === "in_progress" ? { startedAt: at(minutes + 5) } : {}),
      ...(status === "done" ? { startedAt: at(minutes + 5), completedAt: at(minutes + 30) } : {}),
    };
    issues.push(goal);
    goals.push(goal);
    const stage = STAGES[k % STAGES.length];
    if (stage) {
      c += 1;
      comments.push({ id: uid("ca500000", c), issueId: id, body: stage, authorAgentId: A(stage.startsWith("VERDICT") ? "checker" : "chief-of-staff"), authorUserId: null, createdAt: at(minutes + 10) });
    }
    if (hostile) {
      c += 1;
      comments.push({ id: uid("ca500000", c), issueId: id, body: `RESULT:\n${hostile}\nFiles: ${HOSTILE.dotdot}`, authorAgentId: A("chief-of-staff"), authorUserId: null, createdAt: at(minutes + 20) });
    }
    // Every third goal has a step, made by the Chief of staff.
    if (k % 3 === 0) {
      n += 1;
      issues.push({
        ...goal, id: uid("e5000000", n), parentId: id, title: `Step of ${hostile ? "a hostile task" : title.slice(0, 60)}`,
        description: "A step planted by the stress seed.", identifier: `STH-${n}`, issueNumber: n,
        assigneeAgentId: A(SLUGS[(k + 1) % SLUGS.length]), createdByUserId: null, createdByAgentId: A("chief-of-staff"),
      });
    }
  }

  // Needs you: approvals, failed runs and budget alerts, up to 120 items in all.
  const attention = [...board.attention];
  const approvals = [...board.approvals];
  let m = 0;
  while (attention.length < LARGE.needsYou) {
    m += 1;
    const goal = goals[(m * 7) % goals.length];
    const hostile = m <= HOSTILE_LIST.length ? HOSTILE_LIST[m - 1] : null;
    const kind = m % 3;
    const related = { kind: "issue", id: goal.id, title: goal.title, identifier: goal.identifier, status: goal.status, href: `/STH/issues/${goal.identifier}` };
    const common = {
      companyId: company.id, inlineResolvable: true, dismissal: null, relatedIssue: related, project: null, workspace: null,
      activityAt: at(-500 + m), createdAt: at(-501 + m), updatedAt: at(-500 + m),
    };
    if (kind === 0) {
      const aid = uid("d5000000", m);
      const title = hostile || `Approve spend ${m}`;
      approvals.push({ id: aid, companyId: company.id, type: "request_approval", status: "pending", requestedByAgentId: A("builder"), payload: { title }, decisionNote: null, createdAt: at(-500 + m), updatedAt: at(-500 + m) });
      attention.push({
        ...common, sourceKind: "approval", id: `approval:${aid}`,
        subject: { kind: "approval", id: aid, companyId: company.id, identifier: null, title, status: "pending", href: `/STH/approvals/${aid}`, metadata: { type: "request_approval" } },
        whyNow: "The Builder is waiting for your decision.", decisionVerbs: [{ id: "approve", label: "Approve" }, { id: "request_revision", label: "Request revision" }, { id: "reject", label: "Reject" }],
        dismissalKey: `attention:${aid}`, severity: "normal", originAgentName: "Builder",
      });
    } else if (kind === 1) {
      const rid = `run:${uid("fa500000", m)}`;
      attention.push({
        ...common, sourceKind: "failed_run", id: `failed_run:${rid}`,
        subject: { kind: "run", id: rid, companyId: company.id, identifier: null, title: hostile || `Run ${m} failed`, status: "failed", href: `/STH/agents/builder/runs/${m}`, metadata: { agentName: "Builder", errorCode: "adapter_failed" } },
        whyNow: "Run failed after automatic retries were exhausted.", decisionVerbs: [{ id: "retry", label: "Retry" }, { id: "dismiss", label: "Dismiss" }],
        dismissalKey: `attention:${rid}`, severity: "high", originAgentName: "Builder",
      });
    } else {
      const bid = uid("ba500000", m);
      attention.push({
        ...common, sourceKind: "budget_alert", id: `budget_alert:${bid}`, relatedIssue: null,
        subject: { kind: "budget_alert", id: bid, companyId: company.id, identifier: null, title: hostile || `Budget alert ${m}`, status: "warning", href: "/STH/costs", metadata: {} },
        whyNow: "The company has used 90 percent of this month's budget.", decisionVerbs: [{ id: "dismiss", label: "Dismiss" }],
        dismissalKey: `attention:${bid}`, severity: "normal", originAgentName: "Chief of staff",
      });
    }
  }

  // Routines, up to 30, each with one schedule.
  const routines = [...board.routines];
  const routineTriggers = [...board.routineTriggers];
  let r = 0;
  while (routines.length < LARGE.routines) {
    r += 1;
    const id = uid("70500000", r);
    const hostile = r <= HOSTILE_LIST.length ? HOSTILE_LIST[r - 1] : null;
    const title = hostile || `Stress routine ${r}`;
    routines.push({
      id, companyId: company.id, title, description: `${hostile || "Write a short note for the owner."}\n\nROUTINE: stress-routine-${r}`,
      assigneeAgentId: A("chief-of-staff"), projectId, priority: "medium", status: r % 4 === 0 ? "paused" : "active",
      concurrencyPolicy: "skip_if_active", catchUpPolicy: "skip_missed", createdAt: at(-3000 + r), updatedAt: at(-2000 + r),
    });
    routineTriggers.push({
      id: uid("71500000", r), routineId: id, kind: "schedule", label: `Daily at ${String(r % 24).padStart(2, "0")}:00`, enabled: r % 5 !== 0,
      cronExpression: `0 ${r % 24} * * *`, timezone: "Asia/Kolkata", nextRunAt: null, lastFiredAt: null,
    });
  }

  const maxNumber = Math.max(...[...board.issues, ...issues].map((i) => i.issueNumber || 0));
  return {
    board: {
      ...board,
      companies: board.companies.map((co) => ({ ...co, issueCounter: maxNumber })),
      issues: [...board.issues, ...issues],
      comments: [...board.comments, ...comments],
      approvals, attention, routines, routineTriggers,
    },
    goals,
  };
}

function growState(dest, goals) {
  // 50 jobs started: `template:` records naming the repo's own job files, on planted goals (the last five on the
  // goals with hostile titles).
  const refs = jobRefs();
  const decisionsFile = join(dest, "home", "decisions.json");
  const decisions = readJson(decisionsFile, {});
  const picked = goals.slice(HOSTILE_LIST.length, HOSTILE_LIST.length + LARGE.jobs - HOSTILE_LIST.length).concat(goals.slice(0, HOSTILE_LIST.length));
  picked.forEach((g, i) => { decisions[`template:${g.id}`] = refs[i % refs.length]; });
  writeJson(decisionsFile, decisions);

  // 200 documents at the top of knowledge/docs (the ones the knowledge list shows).
  const docs = join(dest, "knowledge", "docs");
  mkdirSync(docs, { recursive: true });
  let have = 0;
  try { have = readdirSync(docs, { withFileTypes: true }).filter((e) => e.isFile() && DOC_NAME.test(e.name)).length; } catch { have = 0; }
  for (let i = 1; have < LARGE.docs; i += 1) {
    const name = `stress-doc-${String(i).padStart(3, "0")}.md`;
    if (existsSync(join(docs, name))) continue;
    const hostile = i <= HOSTILE_LIST.length ? HOSTILE_LIST[i - 1] : null;
    const body = hostile ? `# ${hostile}\n\n${hostile}\n\nSee ${HOSTILE.dotdot} for the key.\n` : `# Stress document ${i}\n\nPlain text planted by the stress seed. Payment terms are 30 days.\n`;
    writeFileSync(join(docs, name), body, { mode: 0o644 });
    have += 1;
  }

  // Each planted goal that is done or in review has a task folder with a brief and a summary.
  const work = join(dest, "tasks", "company-work");
  for (const g of goals.filter((x) => x.status === "done" || x.status === "in_review").slice(0, 80)) {
    const dir = join(work, g.identifier);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "00-brief.md"), `# ${g.title}\n\nThe brief.\n`);
    writeFileSync(join(dir, "04-summary.md"), `# Summary\n\n${g.title}\n`);
  }
}

// ---- the one entry -----------------------------------------------------------------------------------------------

export function seedFor(dataset, { dest } = {}) {
  if (!DATASETS.includes(dataset)) throw new Error(`stage: dataset ${dataset} is not one of ${DATASETS.join(", ")}`);
  if (!dest) throw new Error("seedFor: dest (the stage's state folder) is needed");
  if (existsSync(dest)) throw new Error(`seedFor: ${dest} already exists`);
  if (dataset === "empty") {
    emptyState(dest);
    return { board: emptyBoard(), bench: emptyBench(), stateDir: dest };
  }
  copyStateSeedV2(dest);
  const board = boardSeedV2();
  const bench = benchSeed();
  if (dataset === "normal") return { board, bench, stateDir: dest };
  const grown = growBoard(board);
  growState(dest, grown.goals);
  return { board: grown.board, bench, stateDir: dest };
}
