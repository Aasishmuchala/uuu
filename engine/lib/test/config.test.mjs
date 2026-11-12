import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..");
const engineDir = join(libDir, "..");
const real = JSON.parse(readFileSync(join(engineDir, "config.json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "cfgtest-"));

function writeCfg(name, obj) {
  const p = join(tmp, name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}
function clone() { return JSON.parse(JSON.stringify(real)); }
function py(args, env = {}) {
  return spawnSync("/usr/bin/python3", [join(libDir, "config.py"), ...args],
    { encoding: "utf8", env: { ...process.env, ENGINE_CONFIG: "", ...env } });
}

test("pinned ports and urls", () => {
  const c = loadConfig();
  assert.equal(c.ports.gate, 3110);
  assert.equal(c.ports.relay, 3120);
  assert.equal(c.ports.benchDb, 3317);
  assert.deepEqual(c.urls, {
    board: "http://127.0.0.1:3100", gate: "http://127.0.0.1:3110",
    relay: "http://127.0.0.1:3120", home: "http://127.0.0.1:3200", bench: "http://127.0.0.1:8120",
    gateNarrow: "http://127.0.0.1:3111", web: "http://127.0.0.1:3130", generate: "http://127.0.0.1:3140",
    viewer: "http://127.0.0.1:3150", preview: "http://127.0.0.1:3160",
  });
  assert.equal(c.engineDir, engineDir);
});

test("tilde is expanded", () => {
  const c = loadConfig();
  assert.equal(c.stateRoot, join(homedir(), ".paperclip/uuu-engine"));
  assert.equal(c.node24, join(homedir(), ".nvm/versions/node/v24.13.0"));
  assert.equal(c.fence.realClaude, join(homedir(), ".local/bin/claude"));
  assert.equal(c.paperclip.instanceRoot, join(homedir(), ".paperclip/instances/default"));
  assert.ok(!JSON.stringify(c).includes('"~'));
});

test("paths cover every key", () => {
  const c = loadConfig();
  const keys = ("state logs run secrets agentSecrets policy ids tasks projectFolder agentFolders proofFolder quotaFolder knowledgeDocs lessons contentDrafts homeData cad cadPython proofLast fences claudeHome codexHome books benchOwnerKey models modelsState relayStatus providerSecrets providerKey relaySecret "
    + "playbooks research sharedBrain doors doorsState doorSecrets webSecret generateSecret viewerSecret "
    + "runwayKey searchKey webVisits ledger batches doorWork webStatus generateStatus viewerStatus").split(" ");
  assert.deepEqual(Object.keys(c.paths).sort(), keys.sort());
  assert.equal(c.paths.projectFolder, join(c.stateRoot, "tasks/company-work"));
  assert.equal(c.paths.benchOwnerKey, join(c.stateRoot, "secrets/bench-owner-api.txt"));
  assert.equal(c.paths.models, join(c.stateRoot, "models"));
  assert.equal(c.paths.modelsState, join(c.stateRoot, "models/state.json"));
  assert.equal(c.paths.relayStatus, join(c.stateRoot, "models/relay-status.json"));
  assert.equal(c.paths.providerSecrets, join(c.stateRoot, "secrets/provider"));
  assert.equal(c.paths.providerKey, join(c.stateRoot, "secrets/provider/omega-key"));
  assert.equal(c.paths.relaySecret, join(c.stateRoot, "secrets/provider/relay-secret"));
});

test("the doors' ports, paths and agents (PLAN-V5 K1)", () => {
  const c = loadConfig();
  const s = c.stateRoot;
  assert.deepEqual([c.ports.gateNarrow, c.ports.web, c.ports.generate, c.ports.viewer, c.ports.preview],
    [3111, 3130, 3140, 3150, 3160]);
  assert.deepEqual(c.fence.policyPortsAllowed, [8120]);
  assert.deepEqual(c.fence.readRootsAllowed, ["knowledge/docs", "lessons", "cad", "art", "media"]);
  assert.deepEqual(c.doors, {
    web: { agents: ["researcher"] }, generate: { agents: ["artist"] },
    viewer: { agents: ["builder", "art-director"] },
  });
  const want = {
    playbooks: "playbooks", research: "tasks/research", sharedBrain: "knowledge/shared", doors: "doors",
    doorsState: "doors/state.json", doorSecrets: "secrets/doors", webSecret: "secrets/doors/web-secret",
    generateSecret: "secrets/doors/generate-secret", viewerSecret: "secrets/doors/viewer-secret",
    runwayKey: "secrets/doors/runway-key", searchKey: "secrets/doors/search-key",
    webVisits: "doors/web-visits.jsonl", ledger: "doors/generate-ledger.jsonl", batches: "doors/batches",
    doorWork: "doors/work", webStatus: "doors/web-status.json", generateStatus: "doors/generate-status.json",
    viewerStatus: "doors/viewer-status.json",
  };
  for (const [k, rel] of Object.entries(want)) assert.equal(c.paths[k], join(s, rel), k);
});

test("a config without a door's port or with a bad doors block is refused", () => {
  for (const k of ["gateNarrow", "web", "generate", "viewer", "preview"]) {
    const c = clone();
    delete c.ports[k];
    assert.throws(() => loadConfig({ path: writeCfg(`p-${k}.json`, c) }), new RegExp(`^Error: engine config: .*ports\\.${k}`));
    const r = py(["--json"], { ENGINE_CONFIG: writeCfg(`pp-${k}.json`, c) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`^engine config: .*ports\\.${k}`));
  }
  const bad = [
    (c) => { delete c.doors; },
    (c) => { c.doors = []; },
    (c) => { delete c.doors.viewer; },
    (c) => { c.doors.other = { agents: [] }; },
    (c) => { c.doors.web = ["researcher"]; },
    (c) => { c.doors.web.agents = "researcher"; },
    (c) => { c.doors.web.agents = ["Researcher"]; },
    (c) => { c.doors.generate.agents = ["../artist"]; },
    (c) => { c.doors.viewer.agents = [5]; },
  ];
  bad.forEach((change, i) => {
    const c = clone();
    change(c);
    assert.throws(() => loadConfig({ path: writeCfg(`d${i}.json`, c) }), /^Error: engine config: .*doors/, String(i));
    const r = py(["--json"], { ENGINE_CONFIG: writeCfg(`dp${i}.json`, c) });
    assert.equal(r.status, 1, String(i));
    assert.match(r.stderr, /^engine config: .*doors/);
  });
  const empty = clone();
  empty.doors.web.agents = [];
  assert.deepEqual(loadConfig({ path: writeCfg("de.json", empty) }).doors.web, { agents: [] });
});

test("a config without the relay's port is refused", () => {
  const c = clone();
  delete c.ports.relay;
  assert.throws(() => loadConfig({ path: writeCfg("g.json", c) }), /^Error: engine config: .*ports\.relay/);
});

test("missing key, bad JSON and missing file throw the pinned error", () => {
  const c = clone();
  delete c.ports.gate;
  assert.throws(() => loadConfig({ path: writeCfg("a.json", c) }), /^Error: engine config: .*ports\.gate/);
  assert.throws(() => loadConfig({ path: writeCfg("b.json", "{nope") }), /^Error: engine config: /);
  assert.throws(() => loadConfig({ path: join(tmp, "none.json") }), /^Error: engine config: /);
});

test("ENGINE_CONFIG replaces the file", () => {
  const c = clone();
  c.ports.gate = 4999;
  const p = writeCfg("c.json", c);
  const old = process.env.ENGINE_CONFIG;
  process.env.ENGINE_CONFIG = p;
  try { assert.equal(loadConfig().ports.gate, 4999); }
  finally { if (old === undefined) delete process.env.ENGINE_CONFIG; else process.env.ENGINE_CONFIG = old; }
  assert.equal(loadConfig({ path: p }).urls.gate, "http://127.0.0.1:4999");
});

test("JS and Python agree", () => {
  const r = py(["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  const j = loadConfig();
  assert.deepEqual(p.paths, j.paths);
  assert.deepEqual(p.urls, j.urls);
  assert.deepEqual(p, JSON.parse(JSON.stringify(j)));
});

test("Python honours ENGINE_CONFIG and reports errors", () => {
  const c = clone();
  c.ports.home = 4888;
  const ok = py(["--json"], { ENGINE_CONFIG: writeCfg("d.json", c) });
  assert.equal(JSON.parse(ok.stdout).urls.home, "http://127.0.0.1:4888");
  const bad = py(["--shell"], { ENGINE_CONFIG: writeCfg("e.json", "{nope") });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^engine config: /);
});

test("config.sh sets the variables", () => {
  const r = spawnSync("/bin/bash", ["-c",
    `set -euo pipefail; . "${join(libDir, "config.sh")}"; echo "$CFG_PORT_GATE|$CFG_STATE|$CFG_GATE_URL|$CFG_PROJECT_FOLDER|$CFG_MIN_FREE_GB|$CFG_PORT_RELAY|$CFG_RELAY_URL|$CFG_MODELS_STATE|$CFG_PROVIDER_KEY|$CFG_RELAY_SECRET|$CFG_PORT_GATE_NARROW|$CFG_PORT_WEB|$CFG_PORT_GENERATE|$CFG_PORT_VIEWER|$CFG_PORT_PREVIEW|$CFG_GATE_NARROW_URL|$CFG_WEB_URL|$CFG_GENERATE_URL|$CFG_VIEWER_URL|$CFG_PREVIEW_URL|$CFG_DOORS_STATE|$CFG_PLAYBOOKS|$CFG_RESEARCH"`],
    { encoding: "utf8", env: { ...process.env, ENGINE_CONFIG: "" } });
  assert.equal(r.status, 0, r.stderr);
  const s = join(homedir(), ".paperclip/uuu-engine");
  assert.equal(r.stdout.trim(), `3110|${s}|http://127.0.0.1:3110|${s}/tasks/company-work|8|3120|http://127.0.0.1:3120|`
    + `${s}/models/state.json|${s}/secrets/provider/omega-key|${s}/secrets/provider/relay-secret|`
    + "3111|3130|3140|3150|3160|http://127.0.0.1:3111|http://127.0.0.1:3130|http://127.0.0.1:3140|"
    + `http://127.0.0.1:3150|http://127.0.0.1:3160|${s}/doors/state.json|${s}/playbooks|${s}/tasks/research`);
});

test("config.sh returns 1 with a message on a bad file", () => {
  const bad = writeCfg("f.json", "{nope");
  const r = spawnSync("/bin/bash", ["-c",
    `set -euo pipefail; . "${join(libDir, "config.sh")}" && echo sourced || echo "rc=$?"`],
    { encoding: "utf8", env: { ...process.env, ENGINE_CONFIG: bad } });
  assert.match(r.stdout, /rc=1/);
  assert.match(r.stderr, /^engine config: /);
});

test("books/lib.sh agrees with config.json", { skip: !existsSync(join(engineDir, "books/lib.sh")) }, () => {
  const text = readFileSync(join(engineDir, "books/lib.sh"), "utf8");
  const val = (name) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].replace(/^"|"$/g, "");
  const p = real.ports;
  assert.equal(val("DB_PORT"), String(p.benchDb));
  assert.equal(val("WEB_PORT"), String(p.benchWeb));
  assert.equal(val("SOCKETIO_PORT"), String(p.benchSocketio));
  assert.equal(val("REDIS_QUEUE_PORT"), String(p.benchRedisQueue));
  assert.equal(val("REDIS_CACHE_PORT"), String(p.benchRedisCache));
  assert.equal(val("SITE"), real.bench.site);
  assert.equal(val("ENGINE_HOME"), "$HOME/" + real.stateRoot.replace(/^~\//, ""));
});
