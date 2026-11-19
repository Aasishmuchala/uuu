// An agent inside the fence can reach neither the seats nor the remote door, nor read or write the door's folders
// (REVIEW-DESKTOP, seat 4: probed in the review, kept here). The fence's own planner (engine/fence/fence_plan.py,
// unchanged) is asked, with the engine's real fence settings, in a temporary home and state; nothing runs fenced.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_DIR } from "./helpers.mjs";

const config = JSON.parse(readFileSync(join(ENGINE_DIR, "config.json"), "utf8"));
const root = realpathSync(mkdtempSync(join(tmpdir(), "remote-fence-")));
after(() => rmSync(root, { recursive: true, force: true }));

const H = join(root, "H");
const S = join(H, "S");
const I = join(H, "I");
for (const d of ["tasks/company-work", "knowledge/docs", "lessons", "secrets/agents", "secrets/remote", "claude-home/tmp", "remote", "logs", "run"]) {
  mkdirSync(join(S, d), { recursive: true });
}
mkdirSync(join(I, "workspaces", "w1"), { recursive: true });

// Asks the planner once per case; prints one line per case: "<name> refused|planned <what the plan allows>".
const PROBE = `
import json, sys
sys.path.insert(0, sys.argv[1])
from fence_plan import Refused, plan
cases = json.loads(sys.argv[2])
base = json.loads(sys.argv[3])
for name, over in cases:
    inputs = dict(base)
    if "policy" in over:
        policy = {"agentId": "d03db636-70c7-4bac-8e29-41665aa8e9a4", "slug": "bookkeeper", "localServices": [],
                  "readFolders": [], "lessonsFile": None, "envFile": None, "taskFolder": "read-write"}
        policy.update(over.pop("policy"))
        inputs["policy"] = policy
    inputs.update(over)
    try:
        out = plan(inputs)
        print(name, "planned", json.dumps(out["network"]["allowedDomains"]), json.dumps(out["filesystem"]))
    except Refused as e:
        print(name, "refused")
`;

function ask(cases) {
  const base = {
    home: H, uid: process.getuid(), state: S, taskFolder: join(S, "tasks", "company-work"), tool: "claude",
    agentHome: join(S, "claude-home"), innerTmp: join(S, "claude-home", "tmp"), nodeRoot: join(H, "node"),
    realClaudeDir: join(H, "cc"), instanceRoot: I, gatePort: config.ports.gate, boardPort: config.ports.board,
    extraRead: [], extraWrite: [], policy: null, config: config.fence,
  };
  const r = spawnSync("/usr/bin/python3", ["-I", "-c", PROBE, join(ENGINE_DIR, "fence"), JSON.stringify(cases), JSON.stringify(base)],
    { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = new Map();
  for (const line of r.stdout.trim().split("\n")) {
    const [name, verdict, ...rest] = line.split(" ");
    out.set(name, { verdict, rest: rest.join(" ") });
  }
  return out;
}

const seatPorts = [1, 2, 3, 4, 5].map((n) => config.ports.seats + n - 1);
const doorPort = config.ports.remote;
const folders = [join(S, "remote"), join(S, "secrets", "remote"), join(S, "logs"), join(S, "run")];

test("the fence planner refuses the seat ports, the door's port and the Mac's home port as an agent's local service", () => {
  assert.deepEqual(seatPorts, [3201, 3202, 3203, 3204, 3205]);
  assert.equal(doorPort, 3220);
  const ports = [...seatPorts, doorPort, config.ports.home, config.ports.apps + 1, config.ports.preview];
  const verdicts = ask([...ports, 8120].map((p) => [`port-${p}`, { policy: { localServices: [`127.0.0.1:${p}`] } }]));
  assert.equal(verdicts.get("port-8120")?.verdict, "planned", "the probe itself: a port the engine allows is planned");
  for (const p of ports) assert.equal(verdicts.get(`port-${p}`)?.verdict, "refused", `127.0.0.1:${p}`);
  // and the engine's own list of ports agents may be given names none of them
  for (const p of [...seatPorts, doorPort]) assert.equal(config.fence.policyPortsAllowed.includes(p), false, p);
});

test("the fence planner refuses the remote door's folders, the logs and run, as an agent's read or write folders", () => {
  const cases = [];
  folders.forEach((f, i) => {
    cases.push([`policy-read-${i}`, { policy: { readFolders: [f] } }]);
    cases.push([`extra-read-${i}`, { extraRead: [f] }]);
    cases.push([`extra-write-${i}`, { extraWrite: [f] }]);
    cases.push([`file-read-${i}`, { extraRead: [join(f, "seats.json")] }]);
  });
  cases.push(["docs", { policy: { readFolders: [join(S, "knowledge", "docs")] } }]);
  const verdicts = ask(cases);
  assert.equal(verdicts.get("docs")?.verdict, "planned", "the probe itself: a folder agents may read is planned");
  cases.pop();
  for (const [name] of cases) assert.equal(verdicts.get(name)?.verdict, "refused", name);
});

test("a plain plan reaches none of those ports and opens none of those folders", () => {
  const out = ask([["plain", {}]]).get("plain");
  assert.equal(out.verdict, "planned");
  for (const p of [...seatPorts, doorPort, config.ports.home]) assert.equal(out.rest.includes(`:${p}"`), false, `port ${p}`);
  const fs = JSON.parse(out.rest.slice(out.rest.indexOf("] ") + 2));
  const opened = [...(fs.allowRead || []), ...(fs.allowWrite || [])];
  for (const f of folders) assert.equal(opened.some((x) => x === f || x.startsWith(f + "/")), false, f);
});
