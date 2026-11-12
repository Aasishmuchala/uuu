// The narrow gate's rules (PLAN-V5 K10): what a walled agent, the Researcher, may read and
// write on the board. Pure but for the `ask` function `ownership` is given.
//
// The narrow listener applies every rule of the ordinary gate first (rules.mjs, body.mjs),
// then these, which only ever refuse more:
// - The raw target must be exactly one of the routes below: lower-case words, no trailing
//   "/", no "%" escape, no query string at all, no method-override header, and a read
//   carries no body. Anything else is `narrow-read` (GET, HEAD, OPTIONS) or `narrow-write`.
// - A write body may carry only the keys below (fewer than the ordinary gate allows).
// - A route with an issue id passes only when the board's own record says that issue is
//   assigned to the caller, or is one of the first four ancestors of an issue that is.
//   Otherwise `narrow-not-yours`. Ownership is never read from a request or from text an
//   agent wrote: only from the board's answers to GET /api/agents/me and
//   GET /api/issues/<id>, asked with the caller's own token.

import { createHash } from "node:crypto";

// An issue or comment id as it may appear in a path: a UUID or an identifier ("STH-12").
const ID = "[A-Za-z0-9][A-Za-z0-9-]{0,63}";
export const ID_PATTERN = new RegExp(`^${ID}$`);

// [method, pattern on the raw path, kind]. The first capture is the issue id, if any.
export const NARROW_READS = [
  ["GET", /^\/api\/agents\/me$/, "identity"],
  ["GET", /^\/api\/agents\/me\/inbox-lite$/, "inbox"],
  ["GET", new RegExp(`^/api/issues/(${ID})$`), "issue"],
  ["GET", new RegExp(`^/api/issues/(${ID})/comments$`), "comments"],
  ["GET", new RegExp(`^/api/issues/(${ID})/comments/${ID}$`), "comment"],
  ["GET", new RegExp(`^/api/issues/(${ID})/heartbeat-context$`), "context"],
];

// The body kind (body.mjs) of each write, so the ordinary body rules still apply.
export const NARROW_WRITES = [
  ["POST", new RegExp(`^/api/issues/(${ID})/checkout$`), "checkout"],
  ["POST", new RegExp(`^/api/issues/(${ID})/comments$`), "comment"],
  ["PATCH", new RegExp(`^/api/issues/(${ID})$`), "task-update"],
  ["POST", new RegExp(`^/api/issues/(${ID})/release$`), "release"],
];

// Top-level keys a narrow write may carry. `blockedByIssueIds`, `parentId`,
// `assigneeAgentId` and `attachmentIds` are left out: each would let the caller point its
// own task at another one and read that one's title or files back through its own task.
export const NARROW_BODY_KEYS = {
  checkout: ["agentId", "expectedStatuses"],
  comment: ["body"],
  "task-update": ["status", "comment", "unblockDescriptor"],
  release: [],
};

export const AGENT_TTL_MS = 5 * 60 * 1000;
export const ISSUE_TTL_MS = 10 * 60 * 1000;
export const MAX_TOKENS = 50;
export const MAX_ISSUES_PER_TOKEN = 100;
export const ANCESTOR_STEPS = 4;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The route a request takes on the narrow listener: { kind, issueId, write } or { rule }.
// `rawUrl` is the request target as sent; `overrides` is true when any method-override
// header is present; `hasBody` when a read declares a body.
export function narrowRoute(method, rawUrl, { overrides = false, hasBody = false } = {}) {
  const m = String(method).toUpperCase();
  const write = !READ_METHODS.has(m);
  const rule = write ? "narrow-write" : "narrow-read";
  if (typeof rawUrl !== "string" || rawUrl.includes("?") || overrides) return { rule };
  if (!write && hasBody) return { rule };
  const rows = write ? NARROW_WRITES : NARROW_READS;
  for (const [rm, re, kind] of rows) {
    if (rm !== m) continue;
    const match = re.exec(rawUrl);
    if (match) return { kind, issueId: match[1] ?? null, write };
  }
  return { rule };
}

// The rule refusing a write body on the narrow listener, or null. `value` is the body the
// ordinary body rules already accepted (one JSON object), or null for an empty body.
export function narrowBodyRefusal(kind, value) {
  const keys = NARROW_BODY_KEYS[kind];
  if (!keys) return "narrow-write";
  if (value === null || value === undefined) return kind === "release" ? null : "narrow-write";
  if (typeof value !== "object" || Array.isArray(value)) return "narrow-write";
  if (Object.keys(value).some((k) => !keys.includes(k))) return "narrow-write";
  return null;
}

// What a token is known to be, by the SHA-256 of the token (never the token itself), for
// at most MAX_TOKENS tokens, least recently used dropped first.
export function createCache({ now = Date.now, max = MAX_TOKENS } = {}) {
  const entries = new Map();
  const keyOf = (token) => createHash("sha256").update(String(token)).digest("hex");
  return {
    now,
    keyOf,
    get size() {
      return entries.size;
    },
    has(token) {
      return entries.has(keyOf(token));
    },
    // The entry for this token, created when missing; marks it as the most recently used.
    entry(token) {
      const key = keyOf(token);
      let e = entries.get(key);
      if (e) entries.delete(key);
      else e = { agentId: null, agentAt: 0, issues: new Map() };
      entries.set(key, e);
      while (entries.size > max) entries.delete(entries.keys().next().value);
      return e;
    },
    drop(token) {
      entries.delete(keyOf(token));
    },
  };
}

// Issue ids are remembered in upper case: the board reads an identifier in any letter case
// and a UUID likewise, so every spelling of one id is the same issue.
function remember(entry, id, at) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return;
  const key = id.toUpperCase();
  entry.issues.delete(key);
  entry.issues.set(key, at);
  while (entry.issues.size > MAX_ISSUES_PER_TOKEN) entry.issues.delete(entry.issues.keys().next().value);
}

// An answer from the board is usable only when it came back at all, is not a server
// error, and (for 200) is a JSON object.
function judge(answer) {
  if (!answer || answer.error || typeof answer.status !== "number") return "board-down";
  if (answer.status === 401) return "no-token";
  if (answer.status >= 500) return "board-down";
  if (answer.status !== 200) return "no";
  const v = answer.json;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return "board-down";
  return "ok";
}

// Whether `issueId` belongs to the caller. `ask(token, path)` asks the board with the
// caller's token and resolves to { status, json } or { error }. Resolves to
// { result: "yours" | "not-yours" | "no-token" | "board-down", agentId }.
// The token's cache entry is dropped on any 401. Only positive answers are remembered, so
// a newly assigned task is never refused from memory.
export async function ownership(cache, token, issueId, ask) {
  let entry = cache.entry(token);
  let at = cache.now();
  if (!entry.agentId || at - entry.agentAt > AGENT_TTL_MS) {
    const answer = await ask(token, "/api/agents/me");
    const verdict = judge(answer);
    if (verdict === "no-token") {
      cache.drop(token);
      return { result: "no-token", agentId: null };
    }
    if (verdict === "board-down") return { result: "board-down", agentId: null };
    const id = verdict === "ok" ? answer.json.id : null;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return { result: "not-yours", agentId: null };
    entry = cache.entry(token);
    at = cache.now();
    if (entry.agentId !== id) entry.issues.clear();
    entry.agentId = id;
    entry.agentAt = at;
  }
  const agentId = entry.agentId;
  if (issueId === null || issueId === undefined) return { result: "yours", agentId };
  if (typeof issueId !== "string" || !ID_PATTERN.test(issueId)) return { result: "not-yours", agentId };
  const key = issueId.toUpperCase();
  const seen = entry.issues.get(key);
  if (seen !== undefined && at - seen <= ISSUE_TTL_MS) return { result: "yours", agentId };
  if (seen !== undefined) entry.issues.delete(key);

  const answer = await ask(token, `/api/issues/${issueId}`);
  const verdict = judge(answer);
  if (verdict === "no-token") {
    cache.drop(token);
    return { result: "no-token", agentId: null };
  }
  if (verdict === "board-down") return { result: "board-down", agentId };
  if (verdict !== "ok") return { result: "not-yours", agentId };
  const issue = answer.json;
  if (typeof issue.assigneeAgentId !== "string" || issue.assigneeAgentId !== agentId) {
    return { result: "not-yours", agentId };
  }
  // The board's own record of this issue's ancestors, nearest first.
  entry = cache.entry(token);
  at = cache.now();
  remember(entry, issueId, at);
  remember(entry, issue.id, at);
  remember(entry, issue.identifier, at);
  const ancestors = Array.isArray(issue.ancestors) ? issue.ancestors.slice(0, ANCESTOR_STEPS) : [];
  for (const a of ancestors) {
    if (a === null || typeof a !== "object") break;
    remember(entry, a.id, at);
    remember(entry, a.identifier, at);
  }
  return { result: "yours", agentId };
}
