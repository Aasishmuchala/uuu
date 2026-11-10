// The gate's path normalisation and refusal list (CONTRACTS section 6). Pure: no I/O.
//
// The normalised path is used for matching only; the gate forwards the original bytes.
// Anything that cannot be normalised safely is refused by the caller (400 gate_bad_path).

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// [rule id, applies to "write" or "all", patterns]
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

// Returns the id of the first rule that refuses this request, or null.
export function refusal(method, normalisedPath) {
  const write = !isRead(method);
  for (const [id, scope, patterns] of RULES) {
    if (scope === "write" && !write) continue;
    if (patterns.some((re) => re.test(normalisedPath))) return id;
  }
  return null;
}
