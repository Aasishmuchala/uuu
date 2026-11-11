// The gate's body rules for allowed writes (CONTRACTS section 6). Pure: no I/O.
//
// An allowed write can still carry fields that change far more than the task: paperclip
// 2026.1106.0 lays a task's `assigneeAdapterOverrides.adapterConfig` over the agent's own
// launch settings at run time (command, env, cwd), and builds a whole agent from the payload
// of an approved `hire_agent` approval. So for every allow-list row whose body is JSON, the
// gate reads the whole body, refuses anything it cannot read exactly as the board would, and
// lets through only the top-level keys the work routine sends. The bytes it read are the
// bytes it forwards.

// Large enough for the board's longest document (524,288 characters, up to about 1.6 MB as
// UTF-8 JSON); everything the routine sends is far smaller.
export const BODY_LIMIT = 2 * 1024 * 1024;

// Deeper than any body the routine sends; also keeps the scan below off the stack limit.
export const MAX_DEPTH = 64;

// Top-level keys each body kind may carry, and the rule that refuses any other key. Sources:
// the `paperclip` skill (SKILL.md, references/issue-documents.md, references/artifacts.md,
// scripts/paperclip-issue-update.sh, scripts/paperclip-upload-artifact.sh) for what the
// routine sends, and @paperclipai/shared dist/validators (issue.js, work-product.js,
// approval.js) for the exact key names.
export const BODY_KEYS = {
  checkout: { rule: "not-allowed-field", keys: ["agentId", "expectedStatuses"] },
  title: { rule: "not-allowed-field", keys: ["title", "onlyIfProvisional"] },
  comment: { rule: "not-allowed-field", keys: ["body", "attachmentIds"] },
  "task-update": {
    rule: "task-fields",
    keys: ["status", "comment", "title", "description", "priority", "assigneeAgentId", "goalId", "parentId",
      "billingCode", "blockedByIssueIds", "unblockDescriptor", "reviewInteractionId"],
  },
  "task-create": {
    rule: "task-fields",
    keys: ["title", "description", "status", "priority", "assigneeAgentId", "parentId", "goalId",
      "blockedByIssueIds", "billingCode", "unblockDescriptor", "initialPlan", "idempotencyKey"],
  },
  // The board reads no body here, so an empty one is fine too.
  release: { rule: "not-allowed-field", keys: [], emptyOk: true },
  document: { rule: "not-allowed-field", keys: ["title", "format", "body", "baseRevisionId"] },
  "work-product": {
    rule: "not-allowed-field",
    keys: ["type", "provider", "title", "status", "reviewState", "isPrimary", "healthStatus", "summary",
      "createdByRunId", "metadata"],
  },
  interaction: {
    rule: "not-allowed-field",
    keys: ["kind", "idempotencyKey", "title", "summary", "resolverPolicy", "continuationPolicy", "payload",
      "addresseeAgentId", "addresseeUserId"],
  },
  // Keyed by the last path segment (the answer).
  "interaction-answer": {
    rule: "not-allowed-field",
    byAnswer: {
      accept: ["selectedOptionIds", "selectedClientKeys"],
      reject: ["reason"],
      respond: ["answers", "summaryMarkdown"],
      verdicts: ["verdicts"],
      "resolve-from-comment": ["commentId", "decision", "selectedOptionIds", "reason"],
      withdraw: ["reason"],
    },
  },
  approval: { rule: "not-allowed-field", keys: ["type", "requestedByAgentId", "issueIds", "payload"] },
  "approval-comment": { rule: "not-allowed-field", keys: ["body"] },
};

// The one approval type an agent may raise. The board only records its payload and shows
// it; every other type (`hire_agent` above all) makes the board act on the payload.
export const APPROVAL_TYPE = "request_board_approval";

// Keys refused at ANY depth (letter case ignored): launch settings and the fields that pick
// or move a task's folder. `projectId` picks the project folder a task runs in.
const LAUNCH_EXACT = new Set(["assigneeadapteroverrides", "adapterconfig", "adaptertype", "runner", "command",
  "args", "env", "extraargs", "cwd", "instructionsfilepath", "homemode", "runtimeconfig", "projectid",
  "inheritexecutionworkspacefromissueid"]);
function isLaunchKey(key) {
  const k = key.toLowerCase();
  return LAUNCH_EXACT.has(k) || k.includes("adapter") || k.includes("workspace") || k.startsWith("instructions");
}

// Keys refused at any depth that are not launch settings: server-owned tool and secret
// approvals, remembered tool permissions, and prototype tricks.
const OTHER_EXACT = new Set(["__proto__", "toolaction", "secretproposal", "rememberaction"]);

// Content-Type must be application/json, with at most a UTF-8 charset.
const JSON_TYPE = /^application\/json[ \t]*(;[ \t]*charset[ \t]*=[ \t]*("utf-8"|utf-8)[ \t]*)?$/i;

class BadJson extends Error {}

// Throws BadJson unless `text` is exactly one JSON value (RFC 8259) with no object holding
// the same key twice (compared after unescaping) and nesting no deeper than MAX_DEPTH.
// JSON.parse keeps only the last of two equal keys; refusing them means no value can hide
// behind another.
export function scanJson(text) {
  let i = 0;
  const n = text.length;
  const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const HEX4 = /^[0-9a-fA-F]{4}$/;
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  };
  const string = () => {
    const start = i;
    i += 1;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i += 1;
        return text.slice(start, i);
      }
      if (c === 0x5c) {
        const e = text[i + 1];
        if (e !== undefined && "\"\\/bfnrt".includes(e)) i += 2;
        else if (e === "u" && HEX4.test(text.slice(i + 2, i + 6))) i += 6;
        else throw new BadJson();
        continue;
      }
      if (c < 0x20) throw new BadJson();
      i += 1;
    }
    throw new BadJson();
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) throw new BadJson();
    ws();
    const c = text[i];
    if (c === "{") {
      i += 1;
      const seen = new Set();
      ws();
      if (text[i] === "}") { i += 1; return; }
      for (;;) {
        ws();
        if (text[i] !== "\"") throw new BadJson();
        const key = JSON.parse(string());
        if (seen.has(key)) throw new BadJson();
        seen.add(key);
        ws();
        if (text[i] !== ":") throw new BadJson();
        i += 1;
        value(depth + 1);
        ws();
        if (text[i] === ",") { i += 1; continue; }
        if (text[i] === "}") { i += 1; return; }
        throw new BadJson();
      }
    }
    if (c === "[") {
      i += 1;
      ws();
      if (text[i] === "]") { i += 1; return; }
      for (;;) {
        value(depth + 1);
        ws();
        if (text[i] === ",") { i += 1; continue; }
        if (text[i] === "]") { i += 1; return; }
        throw new BadJson();
      }
    }
    if (c === "\"") { string(); return; }
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) { i += word.length; return; }
    }
    NUMBER.lastIndex = i;
    if (NUMBER.test(text)) { i = NUMBER.lastIndex; return; }
    throw new BadJson();
  };
  value(0);
  ws();
  if (i !== n) throw new BadJson();
}

// The rule a refused key gives, looking at every object key at every depth; null if none.
function deepKeyRule(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = deepKeyRule(item);
      if (r) return r;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;
  let other = null;
  for (const key of Object.keys(node)) {
    if (isLaunchKey(key)) return "task-launch-settings";
    if (OTHER_EXACT.has(key.toLowerCase())) other = other ?? "not-allowed-field";
    const r = deepKeyRule(node[key]);
    if (r === "task-launch-settings") return r;
    other = other ?? r;
  }
  return other;
}

// Header checks: one Content-Type at most, and no compression. Returns "bad-body" or null.
function headerRefusal(rawHeaders) {
  const types = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (name === "content-type") types.push(rawHeaders[i + 1]);
    // The board would inflate a compressed body the gate cannot read.
    if (name === "content-encoding" && rawHeaders[i + 1].trim().toLowerCase() !== "identity") return "bad-body";
    if (name === "transfer-encoding" && rawHeaders[i + 1].trim().toLowerCase() !== "chunked") return "bad-body";
  }
  if (types.length > 1) return "bad-body";
  return null;
}

// Returns the id of the rule that refuses this body, or null when it may pass.
// `kind` is the row's body kind (ALLOW in rules.mjs), `path` the normalised path,
// `rawHeaders` the request's headers as Node gives them, and `body` a Buffer holding the
// whole body (the gate never reads more than BODY_LIMIT). Order: bad-body (headers, UTF-8,
// JSON, duplicate keys, an object), task-launch-settings (any depth), not-allowed-field
// (other keys refused at any depth), then the row's top-level keys, then the approval type.
export function bodyRefusal(kind, path, rawHeaders, body) {
  const spec = BODY_KEYS[kind];
  if (!spec) return "bad-body";
  const headerRule = headerRefusal(rawHeaders);
  if (headerRule) return headerRule;
  if (body.length === 0 && spec.emptyOk) return null;
  let contentType;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === "content-type") contentType = rawHeaders[i + 1];
  }
  if (typeof contentType !== "string" || !JSON_TYPE.test(contentType.trim())) return "bad-body";
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return "bad-body";
  }
  let value;
  try {
    scanJson(text);
    value = JSON.parse(text);
  } catch {
    return "bad-body";
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "bad-body";
  const deep = deepKeyRule(value);
  if (deep) return deep;
  let keys = spec.keys;
  if (spec.byAnswer) keys = spec.byAnswer[path.slice(path.lastIndexOf("/") + 1)] ?? [];
  if (Object.keys(value).some((k) => !keys.includes(k))) return spec.rule;
  if (kind === "approval" && value.type !== APPROVAL_TYPE) return "approval-type";
  return null;
}
