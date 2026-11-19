// The door's configuration read back with `sshd -T`, its seat lines, and the reasons it will not start.
// PLAN-DESKTOP T8 test 7, and the start refusals of its spec. `sshd -T` and `sshd -t` bind nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { OWNER, PART, makeWorld, newKey, seed } from "./helpers.mjs";
import { remotePaths, remotePorts } from "../state.mjs";
import { seatLine, sshdConfig } from "../door-config.mjs";

let w;
let k1;
let k2;
before(async () => {
  w = await makeWorld();
  mkdirSync(join(w.root, "stick"));
  const r = w.cli(["kit", join(w.root, "stick")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  k1 = newKey(w.keys, "one");
  k2 = newKey(w.keys, "two");
});
after(() => w?.cleanup());

const PINNED = (paths, owner) => [
  "port 3220", "addressfamily inet", "listenaddress 0.0.0.0:3220", `hostkey ${paths.hostKey}`,
  "hostkeyalgorithms ssh-ed25519", "pubkeyacceptedalgorithms ssh-ed25519", `authorizedkeysfile ${paths.authorizedKeys}`,
  `pidfile ${paths.pid}`, "usepam no", "passwordauthentication no", "kbdinteractiveauthentication no",
  "pubkeyauthentication yes", "permitrootlogin no",
  `allowusers ${owner}@10.0.0.0/8`, `allowusers ${owner}@172.16.0.0/12`, `allowusers ${owner}@192.168.0.0/16`,
  `allowusers ${owner}@169.254.0.0/16`,
  "allowtcpforwarding local", "permittty no", "forcecommand /usr/bin/false", "maxsessions 0", "x11forwarding no",
  "allowagentforwarding no", "allowstreamlocalforwarding no", "permittunnel no", "gatewayports no", "permituserrc no",
  "permituserenvironment no", "strictmodes yes", "maxauthtries 2", "logingracetime 20", "maxstartups 3:50:6",
  "clientaliveinterval 30", "clientalivecountmax 3", "loglevel VERBOSE", "banner none",
];

function sshdT(file) {
  const r = spawnSync("/usr/sbin/sshd", ["-T", "-f", file], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split("\n");
}

test("7. sshd -T on the door's configuration holds every pinned line", () => {
  const paths = remotePaths(w.cfg);
  const ports = { ...remotePorts({ ...w.cfg, ports: { ...w.cfg.ports, remote: 3220, seats: 3201, preview: 3160 } }) };
  const seats = [{ n: 1, role: "desk", state: "allowed" }, { n: 2, role: "view", state: "allowed" }, { n: 3, role: "desk", state: "waiting" }];
  const file = join(w.root, "pinned_config");
  writeFileSync(file, sshdConfig({ paths, ports, owner: OWNER, seats }));
  const lines = sshdT(file);
  for (const want of PINNED(paths, OWNER)) assert.ok(lines.includes(want), `missing: ${want}`);
  const opens = lines.find((l) => l.startsWith("permitopen "));
  const want = ["127.0.0.1:3201", ...[...Array(10).keys()].map((i) => `127.0.0.1:${3160 + i}`),
    ...[...Array(19).keys()].map((i) => `127.0.0.1:${3171 + i}`), "127.0.0.1:3202"];
  assert.deepEqual(opens.split(" ").slice(1), want);
  for (const never of [3200, 3100, 3110, 3111, 3120, 3130, 3140, 3150, 3170, 3190, 8120, 3203, 3220]) {
    assert.equal(opens.includes(`127.0.0.1:${never} `) || opens.endsWith(`127.0.0.1:${never}`), false, String(never));
  }
  assert.equal(lines.filter((l) => /^(subsystem|acceptenv) /.test(l)).length, 0);
  assert.equal(lines.filter((l) => l.startsWith("listenaddress ")).length, 1);
  // and the file the door itself writes (here on loopback, as every test runs it) passes the same reading
  seed(w, [{ n: 1, role: "desk", key: k1.key }]);
  const r = w.part("start");
  try {
    assert.equal(r.status, 0, r.stdout);
    const written = sshdT(paths.sshdConfig);
    for (const line of PINNED(paths, OWNER)) {
      if (/^(port|listenaddress|allowusers) /.test(line)) continue;
      assert.ok(written.includes(line), `missing from the written file: ${line}`);
    }
    assert.ok(written.includes(`listenaddress 127.0.0.1:${w.cfg.ports.remote}`));
    assert.deepEqual(written.filter((l) => l.startsWith("allowusers ")), [`allowusers ${OWNER}@127.0.0.0/8`]);
    for (const f of [paths.sshdConfig, paths.authorizedKeys]) {
      const st = spawnSync("/usr/bin/stat", ["-f", "%Lp", f], { encoding: "utf8" }).stdout.trim();
      assert.equal(st, "600", f);
    }
  } finally {
    w.part("stop");
  }
});

test("a seat's line: the engine's options and comment, and nothing from the PC but the key", () => {
  const ports = remotePorts({ ...w.cfg, ports: { ...w.cfg.ports, seats: 3201, preview: 3160 } });
  const view = seatLine({ n: 2, role: "view" }, k1.key, ports);
  assert.equal(view, `restrict,port-forwarding,permitopen="127.0.0.1:3202" ssh-ed25519 ${k1.key} seat-2`);
  const desk = seatLine({ n: 1, role: "desk" }, k1.key, ports);
  const opens = desk.match(/permitopen="127\.0\.0\.1:(\d+)"/g).map((s) => Number(/:(\d+)"/.exec(s)[1]));
  assert.deepEqual(opens, [3201, ...[...Array(10).keys()].map((i) => 3160 + i), ...[...Array(19).keys()].map((i) => 3171 + i)]);
  assert.ok(desk.startsWith("restrict,port-forwarding,") && desk.endsWith(` ssh-ed25519 ${k1.key} seat-1`));
});

function startRefusal() {
  const r = w.part("start");
  assert.equal(r.status, 1, r.stdout);
  assert.equal(spawnSync("/usr/bin/nc", ["-z", "127.0.0.1", String(w.cfg.ports.remote)]).status, 1, "the door is listening");
  return r.stdout.trim().split("\n").pop();
}

test("the door will not start without an allowed seat, or when seats.json fails rule 6", () => {
  const paths = remotePaths(w.cfg);
  seed(w, [{ n: 1, role: "desk" }]);
  assert.equal(startRefusal(), "The remote door could not start: no PC is allowed yet.");
  seed(w, [{ n: 1, role: "desk", key: k1.key }, { n: 2, role: "view", key: k2.key }]);
  // readable by others
  chmodSync(paths.seats, 0o644);
  assert.equal(startRefusal(), "The remote door could not start: the list of PCs could not be read safely.");
  chmodSync(paths.seats, 0o600);
  // a link
  renameSync(paths.seats, join(w.root, "seats-elsewhere.json"));
  symlinkSync(join(w.root, "seats-elsewhere.json"), paths.seats);
  assert.equal(startRefusal(), "The remote door could not start: the list of PCs could not be read safely.");
  spawnSync("/bin/rm", [paths.seats]);
  renameSync(join(w.root, "seats-elsewhere.json"), paths.seats);
  // too long
  const text = readFileSync(paths.seats, "utf8");
  writeFileSync(paths.seats, text.replace(/\n$/, "") + " ".repeat(17 * 1024) + "\n");
  assert.equal(startRefusal(), "The remote door could not start: the list of PCs could not be read safely.");
  writeFileSync(paths.seats, text);
  // a FIFO in its place does not hang the door
  renameSync(paths.seats, join(w.root, "seats-saved.json"));
  spawnSync("/usr/bin/mkfifo", ["-m", "600", paths.seats]);
  assert.equal(startRefusal(), "The remote door could not start: the list of PCs could not be read safely.");
  spawnSync("/bin/rm", [paths.seats]);
  renameSync(join(w.root, "seats-saved.json"), paths.seats);
  // its folder open to others
  chmodSync(paths.dir, 0o755);
  assert.equal(startRefusal(), "The remote door could not start: the list of PCs could not be read safely.");
  chmodSync(paths.dir, 0o700);
  // a key that does not match the fingerprint the owner saw
  const keys = JSON.parse(readFileSync(paths.keys, "utf8"));
  keys.keys["2"] = k1.key;
  writeFileSync(paths.keys, JSON.stringify(keys));
  assert.equal(startRefusal(), "The remote door could not start: the list of PCs could not be read safely.");
  seed(w, [{ n: 1, role: "desk", key: k1.key }]);
  // a test that forgets loopback never binds beyond 127.0.0.1
  const env = { ...w.env };
  delete env.ENGINE_REMOTE_LOOPBACK;
  const p = spawnSync("/bin/bash", [PART, "start"],
    { encoding: "utf8", env: { ...env, NODE_TEST_CONTEXT: env.NODE_TEST_CONTEXT || "child" } });
  assert.equal(p.status, 1);
  assert.equal(p.stdout.trim(), "The remote door could not start: a test asked it to listen beyond this Mac.");
  assert.equal(existsSync(paths.pid), false);
});
