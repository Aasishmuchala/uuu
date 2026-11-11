// Request vectors shared by the gate tests (CONTRACTS section 6).

// Every proof request of the refusal table, normalised.
export const PROOF = [
  ["PATCH", "/api/agents/builder-id", "agents-write"],
  ["POST", "/api/companies/co/agents", "agents-create"],
  ["POST", "/api/companies/co/agent-hires", "agents-create"],
  ["PATCH", "/api/companies/co", "company-write"],
  ["GET", "/api/companies/co/members/x/permissions", "members"],
  ["GET", "/api/board-api-keys", "board-keys"],
  ["POST", "/api/board/chat/stream", "board-chat"],
  ["POST", "/board/chat/stream", "board-chat"],
  ["PUT", "/api/issues/x/workspace", "task-folder"],
  ["POST", "/api/companies/co/projects", "projects"],
  ["PATCH", "/api/projects/x", "projects"],
  ["PATCH", "/api/instance/settings", "instance"],
  ["GET", "/api/companies/co/secrets", "secrets"],
  ["POST", "/api/companies/co/exports", "export-import"],
  ["POST", "/api/companies/co/adapters/claude_local/test-environment", "adapters"],
  ["POST", "/mcp/runtime-tools", "tools-endpoint"],
  ["GET", "/runtime-tools/connections/search", "tools-endpoint"],
  ["POST", "/api/mcp/connections", "tools-endpoint"],
  ["POST", "/api/companies/co/skills", "not-allowed"],
  ["POST", "/api/companies/co/tools/connections", "not-allowed"],
];

// One request for every row of the allow-list, in the same order as ALLOW in rules.mjs.
export const ALLOWED = [
  ["POST", "/api/issues/i1/checkout"],
  ["PUT", "/api/issues/i1/title"],
  ["POST", "/api/issues/i1/comments"],
  ["PATCH", "/api/issues/i1"],
  ["POST", "/api/companies/co/issues"],
  ["POST", "/api/issues/i1/release"],
  ["PUT", "/api/issues/i1/documents/plan"],
  ["POST", "/api/issues/i1/work-products"],
  ["POST", "/api/companies/co/issues/i1/attachments"],
  ["POST", "/api/issues/i1/interactions"],
  ["POST", "/api/issues/i1/interactions/n1/accept"],
  ["POST", "/api/companies/co/approvals"],
  ["POST", "/api/approvals/a1/comments"],
];

// A body the routine really sends, for every row of ALLOWED, in the same order:
// [Content-Type or null, body text]. The release sends no body; the upload is a form.
const ID = "11111111-2222-4333-8444-555555555555";
const JSON_TYPE = "application/json";
export const BOUNDARY = "----gateTestBoundary";
export const GOOD_BODIES = [
  [JSON_TYPE, JSON.stringify({ agentId: ID, expectedStatuses: ["todo", "backlog", "blocked", "in_review"] })],
  [JSON_TYPE, JSON.stringify({ title: "Price list for the kitchen ranges", onlyIfProvisional: true })],
  [JSON_TYPE, JSON.stringify({ body: "Done.\n\n- Wrote the price list\n- Checked every price", attachmentIds: [ID] })],
  ["application/json; charset=utf-8", JSON.stringify({ status: "done", comment: "What was done and why." })],
  [JSON_TYPE, JSON.stringify({ title: "Write the price list", description: "Put your files in the sub-folder `STH-12` of your current working folder.",
    assigneeAgentId: ID, parentId: ID, goalId: ID, status: "todo", priority: "medium", blockedByIssueIds: [] })],
  [null, ""],
  [JSON_TYPE, JSON.stringify({ title: "Task report", format: "markdown", body: "# Task report\n\nThe requested findings.", baseRevisionId: null })],
  [JSON_TYPE, JSON.stringify({ type: "artifact", provider: "paperclip", title: "Walkthrough render", status: "ready_for_review",
    reviewState: "none", isPrimary: true, healthStatus: "unknown", summary: null, createdByRunId: ID,
    metadata: { attachmentId: ID, contentType: "text/markdown", byteSize: 12, contentPath: `/api/attachments/${ID}/content`,
      openPath: `/api/attachments/${ID}/content`, downloadPath: `/api/attachments/${ID}/content?download=1`, originalFilename: "a.md" } })],
  [`multipart/form-data; boundary=${BOUNDARY}`, `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.md"\r\n` +
    `Content-Type: text/markdown\r\n\r\n# A file\r\n--${BOUNDARY}--\r\n`],
  [JSON_TYPE, JSON.stringify({ kind: "ask_user_questions", idempotencyKey: `question:${ID}:detail:v1`, resolverPolicy: "human_only",
    continuationPolicy: "wake_assignee", payload: { version: 1, questionSet: { schema: "paperclip.question_set.v1",
      questions: [{ id: "detail", prompt: "What should I know?", answerMode: "text", required: true }] } } })],
  [JSON_TYPE, JSON.stringify({ selectedOptionIds: ["draft-report-march"] })],
  [JSON_TYPE, JSON.stringify({ type: "request_board_approval", requestedByAgentId: ID, issueIds: [ID],
    payload: { title: "Approve monthly hosting spend", summary: "Estimated cost is $42/month for provider X.",
      recommendedAction: "Approve provider X and continue setup.", risks: ["Costs may increase with usage."] } })],
  [JSON_TYPE, JSON.stringify({ body: "Thanks, here is the detail you asked for." })],
];

// Every answer an agent may give to an interaction.
export const INTERACTION_ANSWERS = ["accept", "reject", "respond", "verdicts", "resolve-from-comment", "withdraw"];

// Reads a normal heartbeat makes. The gate never refuses these.
export const READS = [
  ["GET", "/api/agents/me"],
  ["GET", "/api/agents/me/inbox-lite"],
  ["GET", "/api/companies/co/issues"],
  ["GET", "/api/issues/i1"],
  ["GET", "/api/issues/i1/heartbeat-context"],
  ["GET", "/api/issues/i1/comments"],
  ["GET", "/api/issues/i1/documents/plan"],
  ["GET", "/api/issues/i1/interactions"],
  ["GET", "/api/approvals/a1"],
  ["GET", "/api/approvals/a1/issues"],
  ["HEAD", "/api/issues/i1"],
  ["OPTIONS", "/api/issues/i1/comments"],
];

// What a normal heartbeat needs, reads and writes. The gate never refuses these.
export const MUST_PASS = [...READS, ...ALLOWED];

// Writes the routine does not need, each in several spellings (raw targets). All are
// refused with `not-allowed`.
export const NOT_NEEDED = [
  ["POST", ["/api/companies/co/skills", "/API/Companies/CO/Skills/", "/api/companies/co//skills", "/api/companies/co/%73kills"]],
  ["POST", ["/api/companies/co/skills/scan-projects", "/api/companies/co/skills/install-catalog"]],
  ["POST", ["/api/companies/co/tools/connections", "/api/companies/co/Tools/Connections/", "/api//companies/co/tools/connections"]],
  ["POST", ["/api/companies/co/email/connections", "/api/companies/co/ai-connections"]],
  ["POST", ["/api/companies/co/routines", "/api/routines/r1/run", "/API/companies/co/routines/"]],
  ["POST", ["/api/companies/co/goals", "/api/companies/co/Goals"]],
  ["PATCH", ["/api/goals/g1", "/api/goals/g1/"]],
  ["POST", ["/api/plugins/install", "/API/Plugins/Install/", "/api/plugins/%69nstall"]],
  ["POST", ["/api/environment-custom-image-setup-sessions/s1/terminal-session-token"]],
  ["PATCH", ["/api/companies/co/budgets", "/api/companies/co/budgets/"]],
  ["POST", ["/api/companies/co/budgets/policies", "/api/companies/co/cost-events"]],
  ["POST", ["/api/heartbeat-runs/r1/cancel", "/API/heartbeat-runs/R1/Cancel/"]],
  ["POST", ["/api/no-such-thing", "/api/issues", "/nothing", "/", "/api"]],
  ["DELETE", ["/api/issues/i1", "/api/issues/i1/comments/c1", "/api/issues/i1/documents/plan"]],
  ["POST", ["/api/issues/i1/children", "/api/issues/i1/inbox-archive", "/api/issues/i1/monitor/check-now"]],
  ["POST", ["/api/issues/i1/approvals", "/api/issues/i1/access-grants", "/api/issues/i1/admin/force-release"]],
  ["POST", ["/api/issues/i1/documents/plan/lock", "/api/issues/i1/documents/plan/revisions/r1/restore"]],
  ["POST", ["/api/issues/i1/interactions/n1/dismiss", "/api/issues/i1/interactions/n1/cancel", "/api/issues/i1/interactions/n1/skip"]],
  ["POST", ["/api/approvals/a1/approve", "/api/approvals/a1/reject", "/api/approvals/a1/resubmit"]],
  ["POST", ["/api/companies/co/agent-commentary", "/api/companies/co/decisions", "/api/companies/co/labels"]],
  ["PATCH", ["/api/work-products/w1"]],
];

// Raw targets that look like an allowed write but are not the same route on the board, or
// use an allowed shape with the wrong method. All are refused with `not-allowed`.
export const HOSTILE = [
  ["POST", "/api/issues/i1%2Fcomments"],          // one segment on the board: POST /issues/:id
  ["POST", "/api/issues%2Fi1%2Fcomments"],
  ["POST", "/api/issues/%691/comments"],          // any escape in an allowed write
  ["POST", "/api/issues/i1/comment%73"],
  ["PATCH", "/api/issues//i1"],                   // empty segment
  ["POST", "/api//issues/i1/comments"],
  ["POST", "/api/companies/co/issues/i1"],
  ["POST", "/api/companies/co/issues/external-object-summaries"],
  ["POST", "/api/issues/i1/comments/c1"],
  ["PUT", "/api/issues/i1/documents"],
  ["PUT", "/api/issues/i1/documents/plan/revisions"],
  ["POST", "/api/issues/i1/interactions/n1/accept/x"],
  ["POST", "/api/issues/i1/interactions/n1"],
  ["POST", "/api/issues/i1/work-products/w1/review-document"],
  ["PATCH", "/api/issues/i1/comments"],          // allowed path, wrong method
  ["PUT", "/api/issues/i1"],
  ["POST", "/api/issues/i1"],
  ["DELETE", "/api/issues/i1/checkout"],
  ["PATCH", "/api/companies/co/issues"],
  ["PROPFIND", "/api/issues/i1/comments"],
  ["POST", "/api/issues/i1/comments;x"],
  ["POST", "/api/issues/i1/comments.json"],
  ["POST", "/api/approvals/a1/comments/c1"],
  ["POST", "/api/approvals/comments"],
];

// Spellings of allowed writes that the board routes to the same handler (letter case,
// trailing slash, a query). These pass.
export const SAME_ROUTE = [
  ["POST", "/API/Issues/I1/Comments"],
  ["POST", "/api/issues/i1/comments/"],
  ["PATCH", "/api/issues/i1/?x=%2F"],
  ["PUT", "/api/issues/i1/documents/Plan"],
];
