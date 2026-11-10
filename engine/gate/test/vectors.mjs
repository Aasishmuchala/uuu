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
];

// What a normal heartbeat needs. The gate never refuses these.
export const MUST_PASS = [
  ["GET", "/api/agents/me"],
  ["GET", "/api/agents/me/inbox-lite"],
  ["POST", "/api/issues/i1/checkout"],
  ["POST", "/api/issues/i1/comments"],
  ["PATCH", "/api/issues/i1"],
  ["POST", "/api/companies/co/issues"],
  ["GET", "/api/issues/i1/heartbeat-context"],
  ["PUT", "/api/issues/i1/documents/plan"],
  ["POST", "/api/issues/i1/interactions"],
  ["POST", "/api/companies/co/approvals"],
  ["POST", "/mcp/runtime-tools"],
  ["POST", "/mcp/gateways/gw_0123456789abcdef0123456789abcdef"],
  ["GET", "/runtime-tools/connections/search"],
  ["POST", "/runtime-tools/connections/request"],
];
