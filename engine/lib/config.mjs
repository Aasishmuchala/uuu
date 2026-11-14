// Loads engine/config.json. The Python and bash loaders return the same values.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PORT_KEYS = ["board", "gate", "relay", "home", "benchWeb", "benchSocketio",
  "benchRedisQueue", "benchRedisCache", "benchDb",
  "gateNarrow", "web", "generate", "viewer", "preview", "apps"];
// The doors (PLAN-V5 K1): each lists the agents, by slug, that may reach it.
const DOOR_NAMES = ["web", "generate", "viewer"];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// App Studio (K17): each app's own port lies in this range (not a config key).
const APP_PORTS = { first: 3171, last: 3189 };
const PREVIEW_SITE_PORTS = 9;
const APP_NAME_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

function fail(what) {
  throw new Error(`engine config: ${what}`);
}

function expand(p) {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

// `doors` holds exactly the three doors, each `{ "agents": [slug, ...] }`.
function needDoors(cfg) {
  const d = cfg.doors;
  if (d === null || typeof d !== "object" || Array.isArray(d)) fail("missing key doors");
  const names = Object.keys(d).sort();
  if (names.join(",") !== [...DOOR_NAMES].sort().join(",")) fail(`key doors must name ${DOOR_NAMES.join(", ")}`);
  for (const name of DOOR_NAMES) {
    const agents = need(cfg, `doors.${name}.agents`, "array");
    if (!agents.every((s) => typeof s === "string" && SLUG_RE.test(s))) fail(`key doors.${name}.agents must list agent slugs`);
    // Only the generation door serves apps; the list is optional.
    if ("apps" in d[name]) {
      if (name !== "generate") fail("only the generation door serves apps");
      const apps = d[name].apps;
      if (!Array.isArray(apps) || !apps.every((s) => typeof s === "string" && APP_NAME_RE.test(s))) {
        fail("key doors.generate.apps must list app names");
      }
    }
  }
}

function need(obj, dotted, type) {
  let v = obj;
  for (const part of dotted.split(".")) {
    if (v === null || typeof v !== "object" || !(part in v)) fail(`missing key ${dotted}`);
    v = v[part];
  }
  const ok = type === "array" ? Array.isArray(v)
    : type === "number" ? typeof v === "number"
    : typeof v === "string";
  if (!ok) fail(`key ${dotted} must be a ${type}`);
  return v;
}

export function loadConfig({ path } = {}) {
  const file = path || process.env.ENGINE_CONFIG || join(ENGINE_DIR, "config.json");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`cannot read ${file}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch {
    fail(`${file} is not valid JSON`);
  }
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) fail(`${file} must hold an object`);

  need(cfg, "stateRoot", "string");
  need(cfg, "node24", "string");
  for (const k of PORT_KEYS) need(cfg, `ports.${k}`, "number");
  need(cfg, "bench.site", "string");
  need(cfg, "bench.company", "string");
  need(cfg, "bench.abbr", "string");
  need(cfg, "paperclip.instanceRoot", "string");
  need(cfg, "paperclip.companyName", "string");
  need(cfg, "fence.realClaude", "string");
  for (const k of ["claudeHosts", "codexHosts", "policyPortsAllowed", "readRootsAllowed"]) {
    need(cfg, `fence.${k}`, "array");
  }
  needDoors(cfg);
  need(cfg, "minFreeDiskGb", "number");

  const out = JSON.parse(text);
  out.stateRoot = expand(out.stateRoot);
  out.node24 = expand(out.node24);
  out.paperclip.instanceRoot = expand(out.paperclip.instanceRoot);
  out.fence.realClaude = expand(out.fence.realClaude);

  const p = out.ports;
  const host = "http://127.0.0.1";
  out.engineDir = ENGINE_DIR;
  out.urls = {
    board: `${host}:${p.board}`,
    gate: `${host}:${p.gate}`,
    relay: `${host}:${p.relay}`,
    home: `${host}:${p.home}`,
    bench: `${host}:${p.benchWeb}`,
    gateNarrow: `${host}:${p.gateNarrow}`,
    web: `${host}:${p.web}`,
    generate: `${host}:${p.generate}`,
    viewer: `${host}:${p.viewer}`,
    preview: `${host}:${p.preview}`,
  };
  out.urls.apps = `${host}:${p.apps}`;
  out.appPorts = { ...APP_PORTS };
  // The preview serves each load on the nine ports after its own (viewer/preview.mjs SITE_PORT_COUNT).
  out.previewPorts = { first: p.preview + 1, last: p.preview + PREVIEW_SITE_PORTS };
  if (!("apps" in out.doors.generate)) out.doors.generate.apps = [];
  const s = out.stateRoot;
  out.paths = {
    state: s,
    logs: join(s, "logs"),
    run: join(s, "run"),
    secrets: join(s, "secrets"),
    agentSecrets: join(s, "secrets", "agents"),
    policy: join(s, "policy"),
    ids: join(s, "ids.json"),
    tasks: join(s, "tasks"),
    projectFolder: join(s, "tasks", "company-work"),
    agentFolders: join(s, "tasks", "agents"),
    proofFolder: join(s, "tasks", "_proof"),
    quotaFolder: join(s, "tasks", "_quota"),
    knowledgeDocs: join(s, "knowledge", "docs"),
    lessons: join(s, "lessons"),
    contentDrafts: join(s, "content", "drafts"),
    homeData: join(s, "home"),
    cad: join(s, "cad"),
    cadPython: join(s, "cad", "venv", "bin", "python"),
    proofLast: join(s, "proof", "last.json"),
    fences: join(s, "fences"),
    claudeHome: join(s, "claude-home"),
    codexHome: join(s, "codex-home"),
    books: join(s, "books"),
    benchOwnerKey: join(s, "secrets", "bench-owner-api.txt"),
    models: join(s, "models"),
    modelsState: join(s, "models", "state.json"),
    relayStatus: join(s, "models", "relay-status.json"),
    providerSecrets: join(s, "secrets", "provider"),
    providerKey: join(s, "secrets", "provider", "omega-key"),
    relaySecret: join(s, "secrets", "provider", "relay-secret"),
    playbooks: join(s, "playbooks"),
    research: join(s, "tasks", "research"),
    sharedBrain: join(s, "knowledge", "shared"),
    doors: join(s, "doors"),
    doorsState: join(s, "doors", "state.json"),
    doorSecrets: join(s, "secrets", "doors"),
    webSecret: join(s, "secrets", "doors", "web-secret"),
    generateSecret: join(s, "secrets", "doors", "generate-secret"),
    viewerSecret: join(s, "secrets", "doors", "viewer-secret"),
    runwayKey: join(s, "secrets", "doors", "runway-key"),
    searchKey: join(s, "secrets", "doors", "search-key"),
    webVisits: join(s, "doors", "web-visits.jsonl"),
    ledger: join(s, "doors", "generate-ledger.jsonl"),
    batches: join(s, "doors", "batches"),
    doorWork: join(s, "doors", "work"),
    webStatus: join(s, "doors", "web-status.json"),
    generateStatus: join(s, "doors", "generate-status.json"),
    viewerStatus: join(s, "doors", "viewer-status.json"),
    appsCode: join(ENGINE_DIR, "..", "apps"),
    apps: join(s, "apps"),
    appsState: join(s, "apps", "state.json"),
    appsStatus: join(s, "apps", "host-status.json"),
    appsRun: join(s, "run", "apps"),
    appsLogs: join(s, "logs", "apps"),
    allowances: join(s, "doors", "allowances"),
    higgsfieldAuth: join(s, "secrets", "doors", "higgsfield-oauth.json"),
  };
  return out;
}
