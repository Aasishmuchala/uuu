// The remote door end to end, with this Mac's own /usr/bin/ssh and the PC's own argument list (ssh-args.txt
// from a kit the test made). PLAN-DESKTOP T8 tests 1 to 6 and 12, under rule 3.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { connect } from "node:net";
import {
  OWNER, freeBlock, httpCode, listening, makeWorld, newKey, pcArgs, runSsh, seed, sleep, startSsh, stubs, waitFor,
} from "./helpers.mjs";

let w;
let stub;
let deskKit;
let viewKit;
const k = {};
const running = [];

before(async () => {
  w = await makeWorld();
  // Two kits (seat 1 desk, seat 2 view) make the door's host key and the PC's files.
  const sticks = join(w.root, "sticks");
  mkdirSync(join(sticks, "a"), { recursive: true });
  mkdirSync(join(sticks, "b"), { recursive: true });
  let r = w.cli(["kit", join(sticks, "a")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  deskKit = join(r.stdout.trim(), "files");
  r = w.cli(["kit", join(sticks, "b"), "--role", "view", "--name", "Front desk"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  viewKit = join(r.stdout.trim(), "files");
  k.desk = newKey(w.keys, "desk");
  k.view = newKey(w.keys, "view");
  k.third = newKey(w.keys, "third");
  k.stranger = newKey(w.keys, "stranger");
  k.rsa = newKey(w.keys, "rsa", "rsa");
  seed(w, [{ n: 1, role: "desk", key: k.desk.key }, { n: 2, role: "view", key: k.view.key }, { n: 3, role: "desk", key: k.third.key }]);
  writeFileSync(join(w.remoteDir, "on"), "test\n", { mode: 0o600 });
  const s = w.part("start");
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.match(s.stdout, /The remote door is on\./);
  const p = w.cfg.ports;
  stub = await stubs([w.seatPort(1), w.seatPort(2), w.seatPort(3), p.preview, p.preview + 9, p.home, p.board]);
});

after(async () => {
  for (const c of running) c.proc.kill("SIGKILL");
  await stub?.close();
  w?.cleanup();
});

async function open(kit, key, seat, extra = []) {
  const { args, local } = await pcArgs(w, { kitFiles: kit, key: key.path, seat, extra });
  const c = startSsh(args);
  running.push(c);
  const up = await waitFor(() => listening(local[3200]), 10000);
  assert.ok(up, "the forward did not come up: " + c.out());
  return { c, local };
}

test("1. a desk seat reaches its seat port and a stand-in app port (200)", async () => {
  const before = stub.hits.length;
  const { c, local } = await open(deskKit, k.desk, 1);
  assert.equal(await httpCode(local[3200]), 200);
  assert.equal(await httpCode(local[3160]), 200);
  assert.equal(await httpCode(local[3169]), 200);
  assert.deepEqual(stub.hits.slice(before).sort(), [w.seatPort(1), w.cfg.ports.preview, w.cfg.ports.preview + 9].sort());
  c.proc.kill();
  await c.done;
});

test("2. the same key is refused the home's own port, the board's and another seat's; the stub sees nothing", async () => {
  const p = w.cfg.ports;
  const { c, local } = await open(deskKit, k.desk, 1, [[p.home, "home"], [p.board, "board"], [w.seatPort(2), "seat2"]]);
  const before = stub.hits.length;
  for (const name of ["home", "board", "seat2"]) assert.equal(await httpCode(local[name]), 0, name);
  assert.equal(stub.hits.length, before, "a refused port was reached");
  await sleep(300);
  assert.match(c.out(), /administratively prohibited/);
  c.proc.kill();
  await c.done;
});

async function baseArgs(kit, key, seat) {
  const { args } = await pcArgs(w, { kitFiles: kit, key: key.path, seat });
  // the PC's list without its forwards and without -N: what is left is a plain login
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-L") { i++; continue; }
    if (args[i] === "-N") continue;
    out.push(args[i]);
  }
  return out;
}

test("3. a command, a shell, sftp, -R, -D and agent forwarding are each refused, with no output from the Mac", async () => {
  const base = await baseArgs(deskKit, k.desk, 1);
  const target = base.pop();
  const hitsBefore = stub.hits.length;
  // a command
  let r = runSsh([...base, target, "echo", "hello"]);
  assert.equal(r.status, 255);
  assert.equal(r.stdout, "");
  // a shell
  r = runSsh([...base.filter((a) => a !== "-T"), "-tt", target]);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /Last login|\$ |% /);
  // sftp (its -P is the port)
  const sftp = [];
  for (let i = 0; i < base.length; i++) {
    if (base[i] === "-p") { sftp.push("-P", base[++i]); continue; }
    if (base[i] === "-N" || base[i] === "-T") continue;
    sftp.push(base[i]);
  }
  r = runSsh(["-b", "/dev/null", ...sftp, target], "/usr/bin/sftp");
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
  // -R: nothing listens on the Mac's side afterwards
  const back = await freeBlock(1);
  // (ssh keeps the first value it is given for an option, so the test's own come first)
  r = runSsh(["-o", "ExitOnForwardFailure=yes", ...base, "-N", "-R", `127.0.0.1:${back}:127.0.0.1:${w.seatPort(1)}`, target]);
  assert.equal(r.status, 255);
  assert.match(r.stderr, /remote port forwarding failed/);
  assert.equal(await listening(back), false);
  // -D: a SOCKS request for the home's port is refused
  const socks = await freeBlock(1);
  const d = startSsh([...base, "-N", "-D", `127.0.0.1:${socks}`, target]);
  running.push(d);
  assert.ok(await waitFor(() => listening(socks)), d.out());
  assert.equal(await socksConnect(socks, w.cfg.ports.home), false);
  d.proc.kill();
  await d.done;
  // agent forwarding: no session is ever opened, so no agent is ever asked for
  r = runSsh(["-A", "-o", "ForwardAgent=yes", ...base, target, "true"]);
  assert.equal(r.status, 255);
  assert.equal(r.stdout, "");
  assert.equal(stub.hits.length, hitsBefore, "a stub was reached");
});

// A SOCKS5 CONNECT to 127.0.0.1:<port>; true only when the far side says it succeeded.
function socksConnect(socksPort, port) {
  return new Promise((resolve) => {
    const s = connect(socksPort, "127.0.0.1");
    let stage = 0;
    s.setTimeout(5000, () => { s.destroy(); resolve(false); });
    s.on("connect", () => s.write(Buffer.from([5, 1, 0])));
    s.on("data", (d) => {
      if (stage === 0) {
        stage = 1;
        const b = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, port >> 8, port & 255]);
        s.write(b);
      } else {
        s.destroy();
        resolve(d[1] === 0);
      }
    });
    s.on("error", () => resolve(false));
    s.on("close", () => resolve(false));
  });
}

test("4. a view seat reaches its seat port and is refused every app port", async () => {
  const { args } = await pcArgs(w, { kitFiles: viewKit, key: k.view.path, seat: 2 });
  assert.equal(args.filter((a) => a === "-L").length, 1, "a view kit carries the seat port only");
  const p = w.cfg.ports;
  const { c, local } = await open(viewKit, k.view, 2, [[p.preview, "preview"], [p.preview + 9, "site"], [3171, "app"], [3189, "app2"]]);
  const before = stub.hits.length;
  assert.equal(await httpCode(local[3200]), 200);
  assert.deepEqual(stub.hits.slice(before), [w.seatPort(2)]);
  for (const name of ["preview", "site", "app", "app2"]) assert.equal(await httpCode(local[name]), 0, name);
  assert.deepEqual(stub.hits.slice(before), [w.seatPort(2)]);
  c.proc.kill();
  await c.done;
});

test("5. an unknown key, an RSA key and a password attempt: Permission denied (publickey)", async () => {
  for (const [key, extra] of [[k.stranger, []], [k.rsa, ["-o", "PubkeyAcceptedAlgorithms=+rsa-sha2-512,rsa-sha2-256"]],
    [k.stranger, ["-o", "PreferredAuthentications=password,keyboard-interactive"]]]) {
    const base = await baseArgs(deskKit, key, 1);
    const target = base.pop();
    const r = runSsh([...extra, ...base, "-N", target]);
    assert.equal(r.status, 255);
    assert.match(r.stderr, /Permission denied \(publickey\)/);
  }
});

test("12. a wrong host key in known_hosts: the client exits 255 and no forward is made", async () => {
  const other = newKey(w.keys, "otherhost");
  const known = join(w.root, "known_wrong");
  writeFileSync(known, `company-engine ssh-ed25519 ${other.key}\n`);
  const { args, local } = await pcArgs(w, { kitFiles: deskKit, key: k.desk.path, seat: 1, known });
  const before = stub.hits.length;
  const r = runSsh(args);
  assert.equal(r.status, 255);
  assert.match(r.stderr, /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/);
  assert.equal(await listening(local[3200]), false);
  assert.equal(stub.hits.length, before);
  // the sentence the PC shows for it is fixed in open.ps1
  const open = readFileSync(join(deskKit, "open.ps1"), "utf8");
  assert.match(open, /The computer that answered is not your Mac\. Nothing was sent\./);
  assert.match(open, /HOST KEY\|Host key verification failed/);
});

test("6. after remote remove, the key is refused and its open connection ends within 5 seconds", async () => {
  const { c, local } = await open(deskKit, k.third, 3);
  assert.equal(await httpCode(local[3200]), 200);
  const r = w.tty(["remove", "3"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PC 3 is removed\./);
  const t0 = Date.now();
  const ended = await Promise.race([c.done.then(() => true), sleep(5000).then(() => false)]);
  assert.ok(ended, "the connection was still open after 5 seconds");
  assert.ok(Date.now() - t0 <= 5000);
  // the door came back for the PCs still allowed, and seat 3's key is refused
  assert.ok(await waitFor(() => listening(w.cfg.ports.remote)), "the door did not come back");
  assert.doesNotMatch(readFileSync(join(w.remoteDir, "authorized_keys"), "utf8"), /seat-3/);
  const base = await baseArgs(deskKit, k.third, 3);
  const target = base.pop();
  const again = runSsh([...base, "-N", target]);
  assert.equal(again.status, 255);
  assert.match(again.stderr, /Permission denied \(publickey\)/);
  const { c: c1, local: l1 } = await open(deskKit, k.desk, 1);
  assert.equal(await httpCode(l1[3200]), 200);
  c1.proc.kill();
  await c1.done;
  assert.equal(OWNER.length > 0, true);
});

test("M2. the door running with no marker: status says on, remove ends the PC's connection, the last remove stops it", async () => {
  const { c, local } = await open(deskKit, k.desk, 1);
  assert.equal(await httpCode(local[3200]), 200);
  rmSync(join(w.remoteDir, "on"));
  assert.equal(w.cli(["status"]).stdout, "remote door: on, 2 PC(s) allowed\n");
  const r = w.tty(["remove", "1"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^PC 1 is removed\.$/m);
  const ended = await Promise.race([c.done.then(() => true), sleep(5000).then(() => false)]);
  assert.ok(ended, "the removed PC's connection was still open after 5 seconds");
  // the door came back for the PC still allowed, and still says so
  assert.ok(await waitFor(() => listening(w.cfg.ports.remote)), "the door did not come back");
  assert.equal(w.cli(["status"]).stdout, "remote door: on, 1 PC(s) allowed\n");
  // no PC left: the door is stopped, not started again
  const last = w.tty(["remove", "2"]);
  assert.equal(last.status, 0, last.stdout);
  assert.equal(await listening(w.cfg.ports.remote), false);
  assert.equal(spawnSync("/usr/bin/pgrep", ["-f", join(w.remoteDir, "sshd_config")]).status, 1, "sshd still runs");
  assert.equal(w.cli(["status"]).stdout, "remote door: off\n");
});

test("L4. every line of the door's log has its time, sshd's sign-ins included, and the log is the owner's alone", () => {
  const file = join(w.state, "logs", "remote.log");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
  assert.ok(lines.length > 5);
  for (const l of lines) assert.match(l, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \S/, l);
  assert.ok(lines.some((l) => /^\S+Z Accepted publickey for \S+ from 127\.0\.0\.1 port \d+ ssh2: ED25519 SHA256:/.test(l)), "no timed sign-in line");
  assert.ok(lines.some((l) => /^\S+Z Server listening on 127\.0\.0\.1 port \d+\./.test(l)));
});
