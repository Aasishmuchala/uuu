// Seed data for the stub board and stub bench. Ids are fixed so tests can name them.
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

function agentRecords() {
  return AGENTS.map(([slug, name, role, tool, model, boss, capabilities], i) => ({
    id: IDS.agents[slug], companyId: IDS.company, name, role, title: name, icon: null,
    status: slug === "builder" ? "running" : "idle", reportsTo: boss ? IDS.agents[boss] : null, capabilities,
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

function grantRecords() {
  const out = {};
  AGENTS.forEach(([slug], i) => {
    const g = [
      { permissionKey: "tools:use", scope: null },
      { permissionKey: "inbox:manage", scope: { responsibleUserOnly: true } },
      { permissionKey: "tasks:assign_scope", scope: { subtreeRootAgentId: IDS.agents[slug] } },
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
    id: IDS.issues[key], companyId: IDS.company, projectId: IDS.project, goalId: null, parentId: null,
    title, description: extra.description ?? title, status, priority: "medium",
    assigneeAgentId: IDS.agents["chief-of-staff"], assigneeUserId: null, identifier: key, issueNumber: n,
    createdByUserId: "local-board", createdByAgentId: null, createdAt: at(-600 + n), updatedAt: at(-300 + n * 10),
    ...extra,
  };
}

function comment(n, issueKey, body, authorSlug, minutes) {
  return {
    id: uid("ca000000", n), issueId: IDS.issues[issueKey], body,
    authorAgentId: authorSlug ? IDS.agents[authorSlug] : null, authorUserId: authorSlug ? null : "local-board",
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
  const step = (n, title, status, parent, who) => issue(n, title, status, { parentId: IDS.issues[parent], assigneeAgentId: IDS.agents[who] });
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
export function benchSeed({ now = new Date() } = {}) {
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
    users[BENCH_KEYS[slug]] = { email: `${slug}@engine.localhost`, role, canSubmit: false, canDelete: false, doctypes };
  }
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
    },
    comments: [],
    missingDoctypes: [],
  };
}
