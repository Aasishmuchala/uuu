// Loads engine/config.json. The Python and bash loaders return the same values.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PORT_KEYS = ["board", "gate", "home", "benchWeb", "benchSocketio",
  "benchRedisQueue", "benchRedisCache", "benchDb"];

function fail(what) {
  throw new Error(`engine config: ${what}`);
}

function expand(p) {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
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
    home: `${host}:${p.home}`,
    bench: `${host}:${p.benchWeb}`,
  };
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
  };
  return out;
}
