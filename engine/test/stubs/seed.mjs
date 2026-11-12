// Seed data for the stub board and stub bench. Ids are fixed so tests can name them.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const uid = (kind, n) => `${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  company: uid("c0000000", 1),
  project: uid("b0000000", 1),
  agents: {
    "chief-of-staff": uid("a0000000", 1), builder: uid("a0000000", 2), checker: uid("a0000000", 3),
    bookkeeper: uid("a0000000", 4), sales: uid("a0000000", 5), support: uid("a0000000", 6),
    people: uid("a0000000", 7), marketer: uid("a0000000", 8), drafter: uid("a0000000", 9),
  },
  issues: {
    "STH-1": uid("e0000000", 1), "STH-2": uid("e0000000", 2), "STH-3": uid("e0000000", 3),
    "STH-4": uid("e0000000", 4), "STH-5": uid("e0000000", 5), "STH-6": uid("e0000000", 6),
  },
  approval: uid("d0000000", 1),
  interaction: uid("f0000000", 1),
  tokens: { builder: "stub-builder-token" },
};

// Ids of the version 2 additions (STH-7 and up, the tenth agent); IDS itself stays as version 1 pinned it.
const issueId = (key) => IDS.issues[key] ?? uid("e0000000", Number(key.slice(4)));
const agentId = (slug) => IDS.agents[slug] ?? (slug === "artist" ? uid("a0000000", 10) : undefined);

const T0 = Date.parse("2026-11-11T09:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();

const AGENTS = [
  ["chief-of-staff", "Chief of staff", "pm", "claude", "opus", null, "Turns the owner's goals into tasks and hands each to the right agent."],
  ["builder", "Builder", "engineer", "claude", "sonnet", "chief-of-staff", "Does the work on a task, inside its own task folder."],
  ["checker", "Checker", "qa", "codex", null, "chief-of-staff", "Checks finished work and says plainly whether it passes."],
  ["bookkeeper", "Bookkeeper", "general", "claude", "sonnet", "chief-of-staff", "Prepares draft invoices, bills and journal entries."],
  ["sales", "Sales", "general", "claude", "sonnet", "chief-of-staff", "Records and qualifies leads and deals."],
  ["support", "Support", "general", "claude", "sonnet", "chief-of-staff", "Reads customer requests and drafts replies."],
  ["people", "People", "general", "claude", "sonnet", "chief-of-staff", "Keeps staff records and prepares leave and attendance drafts."],
  ["marketer", "Marketer", "general", "claude", "sonnet", "chief-of-staff", "Drafts posts and newsletters for the owner to approve."],
  ["drafter", "Drafter", "designer", "claude", "sonnet", "chief-of-staff", "Writes CAD scripts and returns measured STEP files."],
];

function agentRecords(list = AGENTS) {
  return list.map(([slug, name, role, tool, model, boss, capabilities], i) => ({
    id: agentId(slug), companyId: IDS.company, name, role, title: name, icon: null,
    status: slug === "builder" ? "running" : "idle", reportsTo: boss ? agentId(boss) : null, capabilities,
    adapterType: tool === "claude" ? "claude_local" : "codex_local",
    adapterConfig: {
      cwd: `/stub-state/tasks/agents/${slug}`, ...(model ? { model } : {}), engine: "cli", command: tool,
      graceSec: 15, timeoutSec: 900, maxTurnsPerRun: 40, dangerouslySkipPermissions: true,
    },
    runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
    permissions: { canAssignTasks: slug === "chief-of-staff", canCreateAgents: false, canCreateSkills: false },
    pauseReason: null, pausedAt: null, lastHeartbeatAt: at(-30 - i), metadata: null, urlKey: slug,
    createdAt: at(-1000), updatedAt: at(-30 - i), membershipId: uid("9a000000", i + 1),
  }));
}

function grantRecords(list = AGENTS) {
  const out = {};
  list.forEach(([slug], i) => {
    const g = [
      { permissionKey: "tools:use", scope: null },
      { permissionKey: "inbox:manage", scope: { responsibleUserOnly: true } },
      { permissionKey: "tasks:assign_scope", scope: { subtreeRootAgentId: agentId(slug) } },
      { permissionKey: "tasks:manage_active_checkouts", scope: null },
    ];
    if (slug === "chief-of-staff") g.unshift({ permissionKey: "tasks:assign", scope: null });
    out[uid("9a000000", i + 1)] = g;
  });
  return out;
}

function issue(n, title, status, extra = {}) {
  const key = `STH-${n}`;
  return {
    id: issueId(key), companyId: IDS.company, projectId: IDS.project, goalId: null, parentId: null,
    title, description: extra.description ?? title, status, priority: "medium",
    assigneeAgentId: IDS.agents["chief-of-staff"], assigneeUserId: null, identifier: key, issueNumber: n,
    createdByUserId: "local-board", createdByAgentId: null, createdAt: at(-600 + n), updatedAt: at(-300 + n * 10),
    ...extra,
  };
}

function comment(n, issueKey, body, authorSlug, minutes) {
  return {
    id: uid("ca000000", n), issueId: issueId(issueKey), body,
    authorAgentId: authorSlug ? agentId(authorSlug) : null, authorUserId: authorSlug ? null : "local-board",
    createdAt: at(minutes),
  };
}

function attentionItem({ sourceKind, id, subject, whyNow, verbs, severity, agentSlug, issueKey, minutes, extra }) {
  const issueRec = issueKey ? { kind: "issue", id: IDS.issues[issueKey], title: ISSUE_TITLES[issueKey], identifier: issueKey, status: ISSUE_STATUS[issueKey], href: `/STH/issues/${issueKey}` } : null;
  return {
    companyId: IDS.company, sourceKind, id: `${sourceKind}:${id}`,
    subject: { kind: sourceKind, id, companyId: IDS.company, identifier: null, ...subject },
    whyNow, decisionVerbs: verbs.map(([vid, label]) => ({ id: vid, label })), inlineResolvable: true,
    dismissalKey: `attention:${id}`, dismissal: null, severity, relatedIssue: issueRec, project: null, workspace: null,
    originAgentName: AGENTS.find((a) => a[0] === agentSlug)[1], activityAt: at(minutes), createdAt: at(minutes - 1), updatedAt: at(minutes),
    ...extra,
  };
}

const ISSUE_TITLES = {
  "STH-1": "Write the price list", "STH-2": "Plan the November launch content", "STH-3": "Reconcile the October bills",
};
const ISSUE_STATUS = { "STH-1": "in_progress", "STH-2": "done", "STH-3": "blocked" };

export function boardSeed() {
  const [g1, g2, g3] = [
    issue(1, ISSUE_TITLES["STH-1"], "in_progress", { description: "Write the price list for the kitchen range, with GST." }),
    issue(2, ISSUE_TITLES["STH-2"], "done", { description: "Draft one launch post and one newsletter for November." }),
    issue(3, ISSUE_TITLES["STH-3"], "blocked", { description: "Reconcile the October bills against the bank." }),
  ];
  // Steps are made by the Chief of staff, as on the live board (Stop leaves alone what the owner made).
  const step = (n, title, status, parent, who) => issue(n, title, status, { parentId: IDS.issues[parent], assigneeAgentId: IDS.agents[who], createdByUserId: null, createdByAgentId: IDS.agents["chief-of-staff"] });
  const issues = [
    g1, g2, g3,
    step(4, "Draft the price list", "in_progress", "STH-1", "builder"),
    step(5, "Check the price list", "todo", "STH-1", "checker"),
    step(6, "Check the launch drafts", "done", "STH-2", "checker"),
  ];
  const comments = [
    comment(1, "STH-1", "I have split this into a drafting step and a checking step.", "chief-of-staff", -200),
    comment(2, "STH-2", "RESULT:\nTwo drafts are ready: a launch post and the November newsletter.", "chief-of-staff", -120),
    comment(3, "STH-6", "VERDICT: PASS - both drafts have a title, a channel and a planned date.", "checker", -130),
    comment(4, "STH-3", "I cannot see the bank statement. I need it from the owner.", "bookkeeper", -90),
  ];
  const approvals = [{
    id: IDS.approval, companyId: IDS.company, type: "request_approval", status: "pending",
    requestedByAgentId: IDS.agents.builder, payload: { title: "Buy a font licence" }, decisionNote: null,
    createdAt: at(-60), updatedAt: at(-60),
  }];
  const attention = [
    attentionItem({
      sourceKind: "approval", id: IDS.approval, subject: { title: "Buy a font licence", status: "pending", href: `/STH/approvals/${IDS.approval}`, metadata: { type: "request_approval" } },
      whyNow: "The Builder is waiting for your decision.", verbs: [["approve", "Approve"], ["request_revision", "Request revision"], ["reject", "Reject"]],
      severity: "normal", agentSlug: "builder", issueKey: "STH-1", minutes: -60,
    }),
    attentionItem({
      sourceKind: "failed_run", id: "run:" + uid("fa000000", 1),
      subject: { kind: "run", title: "Builder run failed", status: "failed", href: "/STH/agents/builder/runs/1", metadata: { agentName: "Builder", errorCode: "adapter_failed" } },
      whyNow: "Run failed after automatic retries were exhausted.", verbs: [["retry", "Retry"], ["dismiss", "Dismiss"]],
      severity: "high", agentSlug: "builder", issueKey: "STH-3", minutes: -45,
    }),
    attentionItem({
      sourceKind: "issue_thread_interaction", id: IDS.interaction,
      subject: { title: "Which colour for the price list?", status: "pending", href: "/STH/issues/STH-1", metadata: { interactionId: IDS.interaction, issueId: IDS.issues["STH-1"] } },
      whyNow: "The Chief of staff asked you a question.", verbs: [["accept", "Accept"], ["reject", "Reject"]],
      severity: "normal", agentSlug: "chief-of-staff", issueKey: "STH-1", minutes: -30,
    }),
    attentionItem({
      sourceKind: "budget_alert", id: uid("ba000000", 1),
      subject: { title: "Monthly budget nearly used", status: "warning", href: "/STH/costs", metadata: {} },
      whyNow: "The company has used 90 percent of this month's budget.", verbs: [["dismiss", "Dismiss"]],
      severity: "normal", agentSlug: "chief-of-staff", issueKey: null, minutes: -15,
    }),
  ];
  return {
    companies: [{
      id: IDS.company, name: "Sthyra", description: "The owner's own company.", status: "active", issuePrefix: "STH",
      issueCounter: 6, requireBoardApprovalForNewAgents: true, createdAt: at(-1100), updatedAt: at(-1100),
    }],
    agents: agentRecords(),
    projects: [{
      id: IDS.project, companyId: IDS.company, name: "Company work", description: null, status: "in_progress",
      workspaces: [], primaryWorkspace: { id: uid("b1000000", 1), sourceType: "local_path", cwd: "/stub-state/tasks/company-work", isPrimary: true },
      createdAt: at(-900), updatedAt: at(-900),
    }],
    issues, comments, approvals, attention,
    liveRuns: [{ id: uid("11000000", 1), companyId: IDS.company, agentId: IDS.agents.builder, issueId: IDS.issues["STH-4"], status: "running", startedAt: at(-5) }],
    tokens: { [IDS.tokens.builder]: IDS.agents.builder },
    instructions: Object.fromEntries(Object.values(IDS.agents).map((id, i) => [id, { "AGENTS.md": { content: "You are an agent in a Paperclip company.\n", revisionId: uid("12000000", i + 1) } }])),
    memberGrants: grantRecords(),
    heartbeatRuns: [{ id: uid("13000000", 1), companyId: IDS.company, agentId: IDS.agents.builder, scopeKind: "issue", issueId: IDS.issues["STH-4"], status: "running", createdAt: at(-5) }],
  };
}

// ---- version 2 (CONTRACTS-V2 section 22): the tenth agent, STH-7 to STH-18, routines. boardSeed() itself is unchanged.

export const IDS_V2 = {
  ...IDS,
  agents: { ...IDS.agents, artist: uid("a0000000", 10) },
  issues: { ...IDS.issues, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`STH-${i + 7}`, uid("e0000000", i + 7)])) },
  routines: { "daily-brief": uid("70000000", 1), "weekly-content-plan": uid("70000000", 2) },
};

const ARTIST = ["artist", "Artist", "designer", "claude", "sonnet", "chief-of-staff", "Draws sprites, animations and simple images by script, with frame data other tools can read."];

const ROUTINE_TEXT = {
  "daily-brief": {
    title: "Daily brief", agent: null,
    ask: "Write today's brief for the owner: what finished, what waits for the owner, and what needs a decision, in plain words.",
    produces: "brief.md",
  },
  "weekly-content-plan": {
    title: "Weekly content plan", agent: "Marketer",
    ask: "Plan next week's posts and newsletter. Write one draft per item with a title, a channel and a planned date.",
    produces: "content/*.md",
  },
};
const routineText = (id) => {
  const r = ROUTINE_TEXT[id];
  return `${r.agent ? `FOR: ${r.agent}\n` : ""}${r.ask}\n\nProduce: ${r.produces} in the goal's folder inside your current working folder.\n\nROUTINE: ${id}`;
};

const CHECK_1 = `VERDICT: FAIL - the walk tag points past the last frame
# Check: round 1
## Questions
1. Does the work do what the brief asked? YES - four frames of a walk cycle
   evidence: art/walker/walker-sheet.png
2. Is every must-have met? NO - the tag "walk" runs to frame 4 but the sheet has frames 0 to 3
   evidence: art/walker/walker.json, art/walker/manifest.json
3. Is everything the plan said would be produced there? YES - sheet, data file, GIF, manifest
4. Do the exported frames equal the tagged frame ranges? NO - the tag asks for five frames and only four are exported
   evidence: art/walker/walker.json
5. Is it free of anything sent, published or made final without the owner? YES - files only
6. Could the owner use it as it is? NO - the animation would break at the last frame
## Actions
- Set the tag "walk" to frames 0 to 3.
## Anything unclear
None.
Verdict: FAIL`;

const CHECK_2 = `VERDICT: PASS - the sheet, the data file and the GIF agree
# Check: round 2
## Questions
1. Does the work do what the brief asked? YES - four frames of a walk cycle, 16 by 16 pixels
   evidence: art/walker/walker-sheet.png
2. Is every must-have met? YES - four frames, one tag "walk" over frames 0 to 3, flat colours only
   evidence: art/walker/walker.json, art/walker/manifest.json
3. Is everything the plan said would be produced there? YES - sheet, data file, GIF, manifest
   evidence: art/walker/walker.gif
4. Do the exported frames equal the tagged frame ranges? YES - the tag "walk" covers frames 0 to 3 and the sheet has four frames
   evidence: art/walker/walker.json
5. Is it free of anything sent, published or made final without the owner? YES - files only
6. Could the owner use it as it is? YES - the animation loops cleanly
## Actions
None.
## Anything unclear
None.
Verdict: PASS`;

export function boardSeedV2() {
  const base = boardSeed();
  const list = [...AGENTS, ARTIST];
  const I = (n) => IDS_V2.issues[`STH-${n}`];
  const A = (slug) => IDS_V2.agents[slug];
  const mk = (n, title, status, extra = {}) => issue(n, title, status, extra);
  const step = (n, title, status, parent, who, extra = {}) => mk(n, title, status, { parentId: I(parent), assigneeAgentId: A(who), createdByUserId: null, createdByAgentId: A("chief-of-staff"), ...extra });

  const issues = [
    mk(7, "Open a second showroom page on the website", "blocked", {
      description: "Open a second showroom page on the website for the new Whitefield studio, so customers in Bengaluru can see it and book a visit.\n\nPLAN FIRST",
      createdAt: at(-200), updatedAt: at(-170),
    }),
    mk(8, "Make a walking sprite for the mascot", "done", {
      description: "Make a walking sprite for the mascot, four frames.", createdAt: at(-60), startedAt: at(-60), completedAt: at(-10), updatedAt: at(-10),
    }),
    step(9, "Draw the walk cycle", "done", 8, "artist", { createdAt: at(-60), startedAt: at(-60), completedAt: at(-51), updatedAt: at(-51) }),
    step(10, "Check the walk cycle, round 1", "done", 8, "checker", { createdAt: at(-51), startedAt: at(-50), completedAt: at(-40), updatedAt: at(-40) }),
    step(11, "Repair the walk tag", "done", 8, "artist", { createdAt: at(-40), startedAt: at(-39), completedAt: at(-30), updatedAt: at(-30) }),
    step(12, "Check the walk cycle, round 2", "done", 8, "checker", { createdAt: at(-30), startedAt: at(-29), completedAt: at(-20), updatedAt: at(-20) }),
    mk(13, "Plan the Diwali offer", "blocked", {
      description: "Plan the Diwali offer for the kitchen range and showroom visits.", createdAt: at(-180), updatedAt: at(-170),
    }),
    mk(14, "Daily brief", "done", {
      description: routineText("daily-brief"), originKind: "routine_execution", originId: IDS_V2.routines["daily-brief"],
      createdAt: at(-330), startedAt: at(-330), completedAt: at(-320), updatedAt: at(-320),
    }),
    mk(15, "Write three captions for the showroom photos", "in_progress", {
      description: "FOR: Marketer\nWrite three captions for the showroom photos, each under twenty words, for the website gallery.",
      createdAt: at(-25), startedAt: at(-24), updatedAt: at(-3),
    }),
    step(16, "Write the three captions", "in_progress", 15, "marketer", { createdAt: at(-23), startedAt: at(-20), updatedAt: at(-4) }),
    mk(17, "Old idea: a paper catalogue", "cancelled", {
      description: "Old idea: print a paper catalogue of the kitchen range for walk-in customers.", createdAt: at(-2500), updatedAt: at(-1500),
    }),
    mk(18, "Reprice the kitchen range", "blocked", {
      description: "Reprice the kitchen range with the new timber costs, GST included, and update the price list.",
      createdAt: at(-400), updatedAt: at(-215), assigneeAgentId: A("bookkeeper"),
    }),
  ];

  let seq = 10;
  const c = (key, body, who, minutes) => comment(seq++, key, body, who, minutes);
  const comments = [
    c("STH-7", "SIZE: M - a new page with copy and a banner, three steps, two agents.", "chief-of-staff", -195),
    c("STH-7", "PLAN READY: The brief and the plan for the Whitefield page are written. I have published nothing.", "chief-of-staff", -170),
    c("STH-8", "SIZE: M - a small sprite, drawn by script, then checked.", "chief-of-staff", -59),
    c("STH-8", "I have split this into two steps: the Artist draws it, then the Checker looks at it.", "chief-of-staff", -58),
    c("STH-9", "Drew four frames and tagged the walk. Files are in art/walker/.", "artist", -51),
    c("STH-10", CHECK_1, "checker", -40),
    c("STH-11", "Set the tag to frames 0 to 3.", "chief-of-staff", -35),
    c("STH-11", "The tag \"walk\" now covers frames 0 to 3 and the sheet is drawn again.", "artist", -31),
    c("STH-12", CHECK_2, "checker", -20),
    c("STH-8", "RESULT:\nThe mascot has a four-frame walk cycle: a sheet, a data file, a looping GIF and a manifest, all in art/walker/.", "chief-of-staff", -10),
    c("STH-13", "SIZE: L - a plan across offers, audience and posts, with several agents.", "chief-of-staff", -175),
    c("STH-13", "I have written the brief. Two things are unclear, so I have stopped until you answer.", "chief-of-staff", -170),
    c("STH-14", "RESULT:\nToday's brief has three items: two drafts in Marketing, an unpaid invoice and a late delivery.", "chief-of-staff", -320),
    c("STH-15", "SIZE: S - one agent, three short captions.", "chief-of-staff", -24),
    c("STH-16", "Two of the three captions are written. Working on the last one.", "marketer", -4),
    c("STH-18", "SIZE: S - one agent, then a check.", "chief-of-staff", -395),
    c("STH-18", "VERDICT: FAIL - the island unit price has no GST", "checker", -380),
    c("STH-18", "Sent back to the Bookkeeper with the Checker's actions.", "chief-of-staff", -370),
    c("STH-18", "VERDICT: FAIL - the wall unit price still uses the old timber cost", "checker", -340),
    c("STH-18", "Sent back to the Bookkeeper with the Checker's actions.", "chief-of-staff", -330),
    c("STH-18", "VERDICT: FAIL - the totals do not add up: ₹1,84,500 against ₹1,84,050", "checker", -300),
    c("STH-18", "Sent back to the Bookkeeper with the Checker's actions.", "chief-of-staff", -290),
    c("STH-18", "VERDICT: FAIL - the pantry unit is missing from the price list", "checker", -260),
    c("STH-18", "Sent back to the Bookkeeper with the Checker's actions.", "chief-of-staff", -250),
    c("STH-18", "VERDICT: FAIL - GST is added twice on the island unit", "checker", -220),
    c("STH-18", "STOPPED: five check rounds did not pass\nThe Bookkeeper and the Checker could not agree on the new price list in five rounds. The prices for the island and wall units still differ from the timber bills. I have stopped; please tell me which timber bill to trust.", "chief-of-staff", -215),
  ];

  const done = (id, agent, key, minutes, started) => ({
    id, companyId: IDS.company, agentId: A(agent), scopeKind: "issue", issueId: I(key.slice(4)), status: "succeeded",
    createdAt: at(started), finishedAt: at(minutes),
  });
  const heartbeatRuns = [
    ...base.heartbeatRuns,
    { id: uid("13000000", 2), companyId: IDS.company, agentId: A("marketer"), scopeKind: "issue", issueId: I(16), status: "running", createdAt: at(-6) },
    done(uid("13000000", 3), "artist", "STH-9", -51, -60),
    done(uid("13000000", 4), "checker", "STH-10", -40, -50),
    done(uid("13000000", 5), "artist", "STH-11", -30, -39),
    done(uid("13000000", 6), "checker", "STH-12", -20, -29),
    done(uid("13000000", 7), "chief-of-staff", "STH-8", -10, -12),
    done(uid("13000000", 8), "chief-of-staff", "STH-14", -320, -330),
    done(uid("13000000", 9), "bookkeeper", "STH-18", -230, -380),
    done(uid("13000000", 10), "support", "STH-3", -100, -110),
    done(uid("13000000", 11), "sales", "STH-1", -150, -160),
    done(uid("13000000", 12), "people", "STH-1", -200, -210),
    done(uid("13000000", 13), "drafter", "STH-2", -700, -720),
    { id: uid("13000000", 14), companyId: IDS.company, agentId: A("builder"), scopeKind: "issue", issueId: I(3), status: "failed", createdAt: at(-50), finishedAt: at(-45) },
    // STH-3's last run started (it has a process and a log), then stopped; the board holds the task (see recoveryActions).
    {
      id: uid("13000000", 15), companyId: IDS.company, agentId: A("chief-of-staff"), scopeKind: "issue", issueId: I(3), status: "cancelled",
      startedAt: at(-44), finishedAt: at(-40), createdAt: at(-44), updatedAt: at(-40), processPid: 4242, logBytes: 9000,
      errorCode: "legacy_disposition_repair_suppressed", error: "Execution stopped without a recorded cancellation request",
    },
  ];
  // The board's hold on STH-3, in the shape of the live hold of 11 November 2026 (server test fixtures-w2/): a settled
  // action with no replay. The home's hold sweep leaves it to the owner as "A task stopped", since the run did start.
  const holdRun = uid("13000000", 15);
  const recoveryActions = [{
    id: uid("ac000000", 1), companyId: IDS.company, sourceIssueId: I(3), recoveryIssueId: null, kind: "active_run_watchdog",
    status: "resolved", ownerType: "board", ownerAgentId: null, ownerUserId: null, previousOwnerAgentId: null,
    returnOwnerAgentId: A("chief-of-staff"), cause: "legacy_execution_requires_reconciliation", fingerprint: `legacy-execution:${holdRun}`,
    evidence: {
      runId: holdRun, attempt: 1, adapterRecovery: "unsupported_or_unknown",
      automaticRecovery: { runId: holdRun, policy: "preserve_without_replay_v1", replay: "blocked", recordedAt: at(-40), actionOutcome: "unknown" },
      originalFailureCode: "legacy_disposition_repair_suppressed",
    },
    nextAction: "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated.",
    wakePolicy: null, monitorPolicy: null, attemptCount: 1, maxAttempts: 3, timeoutAt: null, lastAttemptAt: at(-40), outcome: "blocked",
    resolutionNote: "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated.",
    resolvedAt: at(-40), createdAt: at(-40), updatedAt: at(-40),
  }];

  const triggers = [
    { id: uid("71000000", 1), routineId: IDS_V2.routines["daily-brief"], kind: "schedule", label: "Daily at 09:00", enabled: true, cronExpression: "0 9 * * *", timezone: "Asia/Kolkata", nextRunAt: null, lastFiredAt: at(-330) },
    { id: uid("71000000", 2), routineId: IDS_V2.routines["weekly-content-plan"], kind: "schedule", label: "Mondays at 10:00", enabled: true, cronExpression: "0 10 * * 1", timezone: "Asia/Kolkata", nextRunAt: "2026-11-16T04:30:00.000Z", lastFiredAt: null },
  ];
  const routine = (key, status) => ({
    id: IDS_V2.routines[key], companyId: IDS.company, title: ROUTINE_TEXT[key].title, description: routineText(key),
    assigneeAgentId: A("chief-of-staff"), projectId: IDS.project, priority: "medium", status,
    concurrencyPolicy: "skip_if_active", catchUpPolicy: "skip_missed", createdAt: at(-1000), updatedAt: at(-330),
  });

  const agents = agentRecords(list);
  const marketer = agents.find((a) => a.name === "Marketer");
  marketer.status = "running";
  const artist = agents.find((a) => a.name === "Artist");
  artist.adapterConfig.maxTurnsPerRun = 60;

  const v3 = seedV3();
  agents.find((a) => a.name === "Sales").status = "running";

  return {
    ...base,
    companies: base.companies.map((co) => ({ ...co, issueCounter: 25 })),
    agents,
    issues: [...base.issues, ...issues, ...v3.issues],
    comments: [...base.comments, ...comments, ...v3.comments],
    liveRuns: [...base.liveRuns, { id: uid("11000000", 2), companyId: IDS.company, agentId: A("marketer"), issueId: I(16), status: "running", startedAt: at(-6) }, ...v3.liveRuns],
    instructions: Object.fromEntries(list.map(([slug], i) => [A(slug), { "AGENTS.md": { content: "You are an agent in a Paperclip company.\n", revisionId: uid("12000000", i + 1) } }])),
    memberGrants: grantRecords(list),
    heartbeatRuns: [...heartbeatRuns, ...v3.heartbeatRuns],
    recoveryActions,
    routines: [routine("daily-brief", "paused"), routine("weekly-content-plan", "active")],
    routineTriggers: triggers,
    routineRuns: [{
      id: uid("72000000", 1), routineId: IDS_V2.routines["daily-brief"], source: "schedule", status: "issue_created",
      triggeredAt: at(-330), completedAt: at(-320), failureReason: null, linkedIssueId: I(14),
    }],
  };
}

// ---- version 3 (CONTRACTS-V3 section 38): STH-19 to STH-25, added to boardSeedV2, and their records.

export const IDS_V3 = {
  ...IDS_V2,
  issues: { ...IDS_V2.issues, ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`STH-${i + 19}`, uid("e0000000", i + 19)])) },
};

// A job's task text as the home server builds it (CONTRACTS-V3 31.3).
const jobText = ({ to, text, reads, produces, job }) =>
  `${to ? `FOR: ${to}\n` : ""}${text}\n\n${reads.length ? `Read first, from the company's files: ${reads.join(", ")}.\n` : ""}Produce: ${produces} in the goal's sub-folder.\nJOB: ${job}`;

// A passing round in the form of CONTRACTS-V2 15.5: six questions in order, each [question, reason, evidence].
// Questions 2 to 4 are worded for the kind of work; question 2 of STH-23 is the scored review of CONTRACTS-V3 36.3.
const passCheck = (why, answers) => `VERDICT: PASS - ${why}
# Check: round 1
## Questions
${answers.map(([question, reason, evidence], i) => `${i + 1}. ${question} YES - ${reason}${evidence ? `\n   evidence: ${evidence}` : ""}`).join("\n")}
## Actions
None.
## Anything unclear
None.
Verdict: PASS`;
const Q = {
  brief: "Does the work do what the brief asked?",
  must: "Is every must-have met?",
  scored: "Does every piece score at least 8 out of 10 against the brand file, with nothing from the can't-say list?",
  produced: "Is everything the plan said would be produced there?",
  facts: "Are the facts, figures and names right, with nothing invented?",
  free: "Is it free of anything sent, published or made final without the owner?",
  usable: "Could the owner use it as it is?",
};
const CHECKS_V3 = {
  "STH-20": passCheck("the write-up says what was asked, what we promised and what comes next", [
    [Q.brief, "the write-up says what they told us, what we said we would do and what happens next", "call-write-up.md"],
    [Q.must, "the customer, the day of the call, both lists and one follow-up with its date", "call-write-up.md"],
    [Q.produced, "the write-up, and a note and a follow-up task on the customer's record", "call-write-up.md"],
    [Q.facts, "the customer's name, the flat, the finish and the handover date match the owner's call notes", "call-write-up.md"],
    [Q.free, "a note and a task on the customer's record; nothing was sent to the customer"],
    [Q.usable, "a proposal can be written from it"],
  ]),
  "STH-23": passCheck("five concepts, each with a headline, an angle and a reason", [
    [Q.brief, "five concepts for the Diwali offer, written before any design", "concepts.md"],
    [Q.scored, "scores: concept-1 9, concept-2 8; every concept keeps to the brand's words and none uses the can't-say list", "concepts.md"],
    ["Does each concept have a headline, an angle and a reason?", "five concepts, numbered 1 to 5, each with all three", "concepts.md"],
    ["Are the five concepts different from each other?", "five angles: the date, a showroom visit, the finishes, the workshop and the lights", "concepts.md"],
    [Q.free, "files only"],
    [Q.usable, "any of the five can go on to a carousel"],
  ]),
  "STH-24": passCheck("three slides of 1080 by 1350 from the first concept", [
    [Q.brief, "a carousel of three slides from the first concept", "slides/launch/contact.png"],
    [Q.must, "three slides, the words of concept 1, the brand's three colours", "slides/launch/slide-01.png, slides/launch/slide-02.png, slides/launch/slide-03.png"],
    [Q.produced, "three slides, the contact sheet, the list of words and the manifest", "slides/launch/manifest.json, slides/launch/slides.json"],
    ["Is every slide the size the manifest says?", "all three are 1080 by 1350", "slides/launch/manifest.json, slides/launch/slide-01.png"],
    [Q.free, "files only"],
    [Q.usable, "the slides are ready to post once the owner agrees"],
  ]),
  "STH-25": passCheck("a one-second title card with a poster and six stills", [
    [Q.brief, "a title card, one second long, in the wide shape", "video/title/title.mp4"],
    [Q.must, "one second, the wide shape, the brand's dark green", "video/title/poster.png"],
    [Q.produced, "the video, its poster, six stills and the manifest", "video/title/manifest.json, video/title/review/frame-01.png"],
    ["Does the video match what its manifest says?", "320 by 180, 30 frames a second, one second", "video/title/manifest.json, video/title/title.mp4"],
    [Q.free, "files only"],
    [Q.usable, "it can open a video as it is"],
  ]),
};

function seedV3() {
  const I = (n) => IDS_V3.issues[`STH-${n}`];
  const A = (slug) => IDS_V2.agents[slug];
  const mk = (n, title, status, minutes, extra = {}) => issue(n, title, status, {
    createdAt: at(minutes[0]), ...(minutes[1] !== undefined ? { startedAt: at(minutes[1]) } : {}),
    ...(status === "done" ? { completedAt: at(minutes[2]) } : {}), updatedAt: at(minutes[2] ?? minutes[1] ?? minutes[0]), ...extra,
  });
  const issues = [
    mk(19, "What is our returns policy, and when did it last change?", "done", [-130, -129, -126], {
      description: "What is our returns policy, and when did it last change?\n\nASK",
    }),
    mk(20, "Call write-up: Asha Kitchens", "done", [-150, -149, -120], {
      description: jobText({
        to: "Sales", job: "sales/call-write-up", reads: ["packs/call-write-up.md"], produces: "call-write-up.md",
        text: "Write up the call in the company file calls/2026-11-10-asha-kitchens.md. The customer is Asha Kitchens. Say what they told us, what we said we would do and what happens next, and add a note and follow-up tasks on the customer's record.",
      }),
    }),
    mk(21, "Proposal from a call write-up", "in_progress", [-12, -11], {
      description: jobText({
        to: "Sales", job: "sales/proposal-from-a-call", reads: ["pricing/services.md", "pricing/terms.md", "brand/brand.md", "packs/proposal.md"], produces: "proposal.md",
        text: "Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder. Say back what they told us, what we will do, what it costs from our price list, how long it takes and our terms. Use only prices and terms from the company's files.",
      }),
    }),
    mk(22, "Do we charge for delivery?", "in_progress", [-3, -2], { description: "Do we charge for delivery?\n\nASK" }),
    mk(23, "Five concepts before any design: Diwali offer", "done", [-110, -109, -80], {
      description: jobText({
        to: "Marketer", job: "marketing/five-concepts", reads: ["brand/brand.md", "brand/cant-say.md", "references/"], produces: "concepts.md",
        text: "Write five different concepts for Diwali offer, as a carousel, before anything is designed. Give each a headline, its angle and why it could work.",
      }),
    }),
    mk(24, "A carousel from one concept", "done", [-75, -74, -40], {
      description: jobText({
        job: "marketing/carousel-from-a-concept", reads: ["brand/brand.md", "packs/carousel.md", "references/"], produces: "slides/*/manifest.json",
        text: "Make a carousel of 3 slides from concept 1 in the sub-folder STH-23 of your current working folder. The Marketer writes the words for each slide; the Artist lays the slides out with the slide tool in the brand's colours and typeface.",
      }),
    }),
    mk(25, "An animated title card", "done", [-70, -69, -35], {
      description: jobText({
        to: "Artist", job: "studio/an-animated-title-card", reads: ["brand/brand.md", "packs/title-card.md"], produces: "video/*/manifest.json",
        text: "Make an animated title card that says Sthyra kitchens, one second long, in the wide shape, in the brand's colours and typeface.",
      }),
    }),
  ];

  let seq = 100;
  const c = (key, body, who, minutes) => comment(seq++, key, body, who, minutes);
  const comments = [
    c("STH-19", "SIZE: XS - a question the company's files can answer.", "chief-of-staff", -129),
    c("STH-19", "RESULT:\nCustomers can return an unused item within 14 days for a full refund [1]. Custom orders cannot be returned [1][2].", "chief-of-staff", -126),
    c("STH-20", "SIZE: S - one agent, then a check.", "chief-of-staff", -149),
    c("STH-20", CHECKS_V3["STH-20"], "checker", -125),
    c("STH-20", "RESULT:\nThe call with Asha Kitchens is written up in call-write-up.md, with a note and a follow-up task on their record.", "chief-of-staff", -120),
    c("STH-21", "SIZE: S - one agent, then a check.", "chief-of-staff", -11),
    c("STH-22", "SIZE: XS - a question the company's files can answer.", "chief-of-staff", -2),
    c("STH-23", "SIZE: M - one agent writes five concepts, then a scored check.", "chief-of-staff", -109),
    c("STH-23", CHECKS_V3["STH-23"], "checker", -85),
    c("STH-23", "RESULT:\nFive concepts for the Diwali offer are in concepts.md. The first scored highest.", "chief-of-staff", -80),
    c("STH-24", "SIZE: M - the Marketer writes the words, the Artist lays out the slides, then a check.", "chief-of-staff", -74),
    c("STH-24", CHECKS_V3["STH-24"], "checker", -45),
    c("STH-24", "RESULT:\nThe launch carousel has three slides and a contact sheet, in slides/launch/.", "chief-of-staff", -40),
    c("STH-25", "SIZE: S - one agent, then a check.", "chief-of-staff", -69),
    c("STH-25", CHECKS_V3["STH-25"], "checker", -38),
    c("STH-25", "RESULT:\nThe opening title is in video/title/, with its poster and six stills.", "chief-of-staff", -35),
  ];

  const run = (n, agent, key, status, started, finished) => ({
    id: uid("13000000", n), companyId: IDS.company, agentId: A(agent), scopeKind: "issue", issueId: I(key), status,
    createdAt: at(started), ...(finished !== undefined ? { finishedAt: at(finished) } : {}),
  });
  return {
    issues, comments,
    liveRuns: [{ id: uid("11000000", 3), companyId: IDS.company, agentId: A("sales"), issueId: I(21), status: "running", startedAt: at(-10) }],
    heartbeatRuns: [
      run(16, "sales", 21, "running", -10),
      run(17, "chief-of-staff", 19, "succeeded", -128, -126),
      run(18, "sales", 20, "succeeded", -148, -130),
      run(19, "marketer", 23, "succeeded", -108, -90),
      run(20, "artist", 24, "succeeded", -70, -50),
      run(21, "artist", 25, "succeeded", -68, -40),
    ],
  };
}

// The records of the version 3 seed in state/home/decisions.json (CONTRACTS-V3 31.3, 33.5), as the home
// server writes them. copyStateSeedV2 adds them to the version 2 file.
export function decisionsV3() {
  const I = (key) => IDS_V3.issues[key];
  return {
    [`ask:${I("STH-19")}`]: { at: at(-130), text: "What is our returns policy, and when did it last change?" },
    [`template:${I("STH-20")}`]: "sales/call-write-up",
    [`acknowledged:goal:${I("STH-20")}`]: at(-100),
    [`template:${I("STH-21")}`]: "sales/proposal-from-a-call",
    [`from:${I("STH-21")}`]: I("STH-20"),
    [`ask:${I("STH-22")}`]: { at: at(-3), text: "Do we charge for delivery?" },
    [`template:${I("STH-23")}`]: "marketing/five-concepts",
    [`asked:${I("STH-23")}`]: { answers: { subject: "Diwali offer", kind: "carousel" } },
    [`template:${I("STH-24")}`]: "marketing/carousel-from-a-concept",
    [`from:${I("STH-24")}`]: I("STH-23"),
    [`acknowledged:goal:${I("STH-24")}`]: at(-30),
    [`template:${I("STH-25")}`]: "studio/an-animated-title-card",
  };
}

// A copy of the version 2 state seed: state-seed/ with the files of state-seed-v2/ laid over it, and the
// version 3 records added to home/decisions.json. `{state}` in ids.json is replaced by `dest`. Returns `dest`.
const STUBS_DIR = dirname(fileURLToPath(import.meta.url));
export function copyStateSeedV2(dest) {
  cpSync(join(STUBS_DIR, "state-seed"), dest, { recursive: true });
  cpSync(join(STUBS_DIR, "state-seed-v2"), dest, { recursive: true });
  const idsFile = join(dest, "ids.json");
  writeFileSync(idsFile, readFileSync(idsFile, "utf8").split("{state}").join(dest));
  const decisionsFile = join(dest, "home", "decisions.json");
  const decisions = { ...JSON.parse(readFileSync(decisionsFile, "utf8")), ...decisionsV3() };
  writeFileSync(decisionsFile, JSON.stringify(decisions, null, 2) + "\n");
  return dest;
}

// ---- bench

const AGENT_USERS = [
  ["bookkeeper", "Engine Bookkeeper", ["Sales Invoice", "Purchase Invoice", "Journal Entry", "Payment Entry", "Customer", "Supplier", "Item", "Account", "Company"]],
  ["sales", "Engine Sales", ["CRM Lead", "CRM Deal", "FCRM Note", "CRM Task"]],
  ["support", "Engine Support", ["HD Ticket", "HD Ticket Comment"]],
  ["people", "Engine People", ["Leave Application", "Attendance", "Employee"]],
];

export const BENCH_KEYS = {
  owner: "owner:owner", bookkeeper: "bookkeeper-key:bookkeeper-secret", sales: "sales-key:sales-secret",
  support: "support-key:support-secret", people: "people-key:people-secret",
};

const istDate = (d) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const stamp = (d) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");

// `now` fixes "today" so that month-based figures are stable in tests.
// `quotations: false` leaves out the Bookkeeper's right to draft quotations (CONTRACTS-V3 38).
export function benchSeed({ now = new Date(), quotations = true } = {}) {
  const today = istDate(now);
  const t = stamp(now);
  const older = istDate(new Date(now.getTime() - 45 * 86400000));
  const later = istDate(new Date(now.getTime() + 30 * 86400000));
  const bk = "bookkeeper@engine.localhost", sl = "sales@engine.localhost", sp = "support@engine.localhost", pe = "people@engine.localhost";
  const base = (dt, name, owner, docstatus, extra) => ({ doctype: dt, name, owner, docstatus, creation: t, modified: t, ...extra });
  const sinv = (n, owner, docstatus, customer, posting, total, left) => base("Sales Invoice", `ACC-SINV-2026-${String(n).padStart(5, "0")}`, owner, docstatus, {
    customer, posting_date: posting, due_date: later, grand_total: total, outstanding_amount: left,
  });
  const pinv = (n, owner, docstatus, supplier, total, left) => base("Purchase Invoice", `ACC-PINV-2026-${String(n).padStart(5, "0")}`, owner, docstatus, {
    supplier, posting_date: today, due_date: later, grand_total: total, outstanding_amount: left,
  });
  const lead = (n, name, org, status) => base("CRM Lead", `CRM-LEAD-2026-${String(n).padStart(5, "0")}`, sl, 0, { lead_name: name, organization: org, status, converted: 0 });
  const deal = (n, org, status, value) => base("CRM Deal", `CRM-DEAL-2026-${String(n).padStart(5, "0")}`, sl, 0, { organization: org, status, deal_value: value });
  const ticket = (n, subject, from, status) => base("HD Ticket", n, "Administrator", 0, { subject, raised_by: from, status });
  const emp = (n, name, job, joined) => base("Employee", `HR-EMP-${String(n).padStart(5, "0")}`, "Administrator", 0, { employee_name: name, designation: job, date_of_joining: joined, status: "Active" });

  const users = { [BENCH_KEYS.owner]: { email: "Administrator", role: "System Manager", canSubmit: true, canDelete: true, doctypes: ["*"] } };
  for (const [slug, role, doctypes] of AGENT_USERS) {
    users[BENCH_KEYS[slug]] = { email: `${slug}@engine.localhost`, role, canSubmit: false, canDelete: false, doctypes: slug === "bookkeeper" && quotations ? [...doctypes, "Quotation"] : doctypes };
  }
  const qtn = (n, owner, docstatus, customer, total) => base("Quotation", `SAL-QTN-2026-${String(n).padStart(5, "0")}`, owner, docstatus, {
    quotation_to: "Customer", party_name: customer, customer_name: customer, order_type: "Sales",
    transaction_date: today, valid_till: later, grand_total: total,
  });
  const perms = quotations ? [base("Custom DocPerm", "qtn-bookkeeper-perm", "Administrator", 0, {
    parent: "Quotation", parenttype: "DocType", parentfield: "permissions", role: "Engine Bookkeeper", permlevel: 0, if_owner: 0,
    read: 1, write: 1, create: 1, select: 1, submit: 0, cancel: 0, amend: 0, delete: 0, report: 0, export: 0, import: 0, print: 0, email: 0, share: 0,
  })] : [];
  return {
    users,
    docs: {
      "Sales Invoice": [
        sinv(1, bk, 0, "Acme Interiors", today, 11800, 11800),
        sinv(2, bk, 0, "Northwind Traders", today, 23600, 23600),
        sinv(3, "Administrator", 1, "Acme Interiors", older, 50000, 0),
        sinv(4, "Administrator", 1, "Northwind Traders", today, 118000, 118000),
        sinv(5, "Administrator", 1, "Acme Interiors", today, 25000, 0),
      ],
      "Purchase Invoice": [
        pinv(1, bk, 0, "Timber Supply Co", 5900, 5900),
        pinv(2, "Administrator", 1, "Timber Supply Co", 9440, 9440),
        pinv(3, "Administrator", 1, "Hardware Mart", 3540, 0),
      ],
      "Journal Entry": [], "Payment Entry": [],
      Customer: [base("Customer", "Acme Interiors", "Administrator", 0, { customer_name: "Acme Interiors" }), base("Customer", "Northwind Traders", "Administrator", 0, { customer_name: "Northwind Traders" })],
      Supplier: [base("Supplier", "Timber Supply Co", "Administrator", 0, { supplier_name: "Timber Supply Co" })],
      "CRM Lead": [
        lead(1, "Asha Rao", "Rao Interiors", "New"), lead(2, "Vikram Shah", "Shah Builders", "Contacted"),
        lead(3, "Meera Iyer", "Iyer Studio", "Contacted"), lead(4, "Kabir Singh", "Singh Homes", "Qualified"),
      ],
      "CRM Deal": [deal(1, "Singh Homes", "Qualification", 250000), deal(2, "Acme Interiors", "Won", 90000)],
      "FCRM Note": [], "CRM Task": [],
      "HD Ticket": [
        ticket(1, "Delivery is late", "buyer@example.com", "Open"),
        ticket(2, "Wrong colour received", "other@example.com", "Open"),
        ticket(3, "Thanks, all good", "happy@example.com", "Closed"),
      ],
      "HD Ticket Comment": [base("HD Ticket Comment", "HD-COMMENT-00001", sp, 0, {
        reference_ticket: 1, content: "DRAFT REPLY: We are sorry for the delay. Your order ships on Friday.", commented_by: sp,
      })],
      Employee: [emp(1, "Priya Nair", "Carpenter", "2025-04-01"), emp(2, "Rohan Das", "Designer", "2025-09-15"), emp(3, "Sana Khan", "Accountant", "2026-02-01")],
      "Leave Application": [base("Leave Application", "HR-LAP-2026-00001", pe, 0, {
        employee_name: "Priya Nair", from_date: later, to_date: later, status: "Open",
      })],
      Attendance: [],
      Quotation: [qtn(1, bk, 0, "Asha Kitchens", 236000), qtn(2, "Administrator", 1, "Acme Interiors", 88500)],
      "Custom DocPerm": perms,
    },
    comments: [],
    missingDoctypes: [],
  };
}
