// The gate's path normalisation, refusal list and allow-list (CONTRACTS section 6). Pure: no I/O.
//
// The normalised path is used for matching only; the gate forwards the original bytes.
// Anything that cannot be normalised safely is refused by the caller (400 gate_bad_path).
//
// Reads (GET, HEAD, OPTIONS) pass unless a refusal rule names them. Every other method is a
// write, and a write passes only when it matches a row of ALLOW: paperclip gives every agent
// default grants the owner cannot remove, so the gate lets through only what the work
// routine of the `paperclip` skill needs.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// [rule id, applies to "write" or "all", patterns]. Checked first, in order.
export const RULES = [
  ["agents-write", "write", [/^\/api\/agents(\/.*)?$/]],
  ["agents-create", "write", [/^\/api\/companies\/[^/]+\/(agents|agent-hires)(\/.*)?$/]],
  ["company-write", "write", [/^\/api\/companies(\/[^/]+)?$/]],
  ["members", "all", [/\/members(\/.*)?$/]],
  ["board-keys", "all", [/^\/api\/board-api-keys(\/.*)?$/]],
  ["board-chat", "all", [/^\/(api\/)?board(\/.*)?$/]],
  ["task-folder", "write", [/^\/api\/issues\/[^/]+\/workspace(\/.*)?$/]],
  ["projects", "write", [/^\/api\/companies\/[^/]+\/projects(\/.*)?$/, /^\/api\/projects(\/.*)?$/]],
  ["instance", "write", [/^\/api\/instance(\/.*)?$/]],
  ["secrets", "all", [/(^|\/)(secrets|secret-proposals)(\/.*)?$/]],
  ["export-import", "all", [/\/(export|exports|import|imports)(\/.*)?$/]],
  ["adapters", "write", [/^\/api\/companies\/[^/]+\/(adapters|setup-token-login-sessions)(\/.*)?$/]],
  // Tool gateways and runtime tools (MCP, connections): every method, for now.
  ["tools-endpoint", "all", [/^\/(api\/)?(mcp|runtime-tools)(\/.*)?$/]],
];

// The writes the work routine needs: [method, pattern, routine step, body kind]. Nothing
// else that changes state gets through (rule `not-allowed`). Sources: the `paperclip` skill's
// heartbeat procedure (SKILL.md, references/artifacts.md, scripts/paperclip-upload-artifact.sh)
// and the routes in @paperclipai/server dist/routes/issues.js and approvals.js. The body kind
// names the body rules in body.mjs; `null` is the file upload, which is a form, not JSON.
export const ALLOW = [
  ["POST", /^\/api\/issues\/[^/]+\/checkout$/, "check out a task", "checkout"],
  ["PUT", /^\/api\/issues\/[^/]+\/title$/, "name a provisional task after checkout", "title"],
  ["POST", /^\/api\/issues\/[^/]+\/comments$/, "comment on a task", "comment"],
  ["PATCH", /^\/api\/issues\/[^/]+$/, "update the task's status or fields", "task-update"],
  ["POST", /^\/api\/companies\/[^/]+\/issues$/, "create a child task", "task-create"],
  ["POST", /^\/api\/issues\/[^/]+\/release$/, "release a task", "release"],
  ["PUT", /^\/api\/issues\/[^/]+\/documents\/[^/]+$/, "write a task document", "document"],
  ["POST", /^\/api\/issues\/[^/]+\/work-products$/, "record a work product", "work-product"],
  ["POST", /^\/api\/companies\/[^/]+\/issues\/[^/]+\/attachments$/, "upload the file of a work product", null],
  ["POST", /^\/api\/issues\/[^/]+\/interactions$/, "raise an interaction on its task", "interaction"],
  ["POST", /^\/api\/issues\/[^/]+\/interactions\/[^/]+\/(accept|reject|respond|verdicts|resolve-from-comment|withdraw)$/,
    "answer an interaction (or withdraw its own)", "interaction-answer"],
  ["POST", /^\/api\/companies\/[^/]+\/approvals$/, "request an approval", "approval"],
  ["POST", /^\/api\/approvals\/[^/]+\/comments$/, "comment on an approval it raised", "approval-comment"],
];

// Returns the normalised path, or null when the target cannot be read safely.
// Steps: origin-form only (a single leading "/"), no "#", path before "?", percent-decode
// once, lower-case, collapse repeated "/", drop a trailing "/". Refused: a decoding error,
// a "%" left after decoding, "\", any byte outside printable ASCII (controls, spaces,
// non-ASCII), a "." or ".." segment, or a decoded path that starts with "//".
export function normalisePath(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  if (rawUrl[0] !== "/" || rawUrl[1] === "/") return null;
  if (rawUrl.includes("#")) return null;
  const q = rawUrl.indexOf("?");
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("%") || decoded.includes("\\")) return null;
  if (!/^[\x21-\x7e]+$/.test(decoded)) return null;
  if (decoded[0] !== "/" || decoded[1] === "/") return null;
  let p = decoded.toLowerCase().replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  for (const seg of p.split("/")) {
    if (seg === "." || seg === "..") return null;
  }
  return p;
}

export function isRead(method) {
  return READ_METHODS.has(String(method).toUpperCase());
}

// True when the raw path (before "?") has no percent escape and no empty segment, so the
// board routes it by the same segments the gate matched. An allowed write must be plain:
// "/api/issues/x%2Fcomments" normalises to an allowed shape but is a different route.
export function isPlainPath(rawUrl) {
  const q = rawUrl.indexOf("?");
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
  return !rawPath.includes("%") && !rawPath.includes("//");
}

// Returns the id of the rule that refuses this request, or null when it may pass.
// Order: the refusal list; then, for a write, the raw path must be plain (when given) and
// the method and normalised path must match a row of ALLOW, else `not-allowed`.
export function refusal(method, normalisedPath, rawUrl) {
  const m = String(method).toUpperCase();
  const write = !READ_METHODS.has(m);
  for (const [id, scope, patterns] of RULES) {
    if (scope === "write" && !write) continue;
    if (patterns.some((re) => re.test(normalisedPath))) return id;
  }
  if (!write) return null;
  if (typeof rawUrl === "string" && !isPlainPath(rawUrl)) return "not-allowed";
  if (ALLOW.some(([am, re]) => am === m && re.test(normalisedPath))) return null;
  return "not-allowed";
}

// The allow-list row a write matches, or null. Used by the gate to pick the body rules.
export function allowRow(method, normalisedPath) {
  const m = String(method).toUpperCase();
  return ALLOW.find(([am, re]) => am === m && re.test(normalisedPath)) ?? null;
}
