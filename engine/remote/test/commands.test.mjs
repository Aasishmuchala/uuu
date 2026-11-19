// `engine remote`'s commands: the terminal rule, seat requests, kits. PLAN-DESKTOP T8 tests 8 to 11.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { OWNER, makeWorld, newKey, snapshot } from "./helpers.mjs";

let w;
let sticks;
const NOT_REQUEST = 'This is not a seat request made by "Set up.cmd".';

before(async () => {
  w = await makeWorld();
  sticks = join(w.root, "sticks");
  mkdirSync(sticks);
});
after(() => w?.cleanup());

function stick(name) {
  const d = join(sticks, name);
  mkdirSync(d, { recursive: true });
  return d;
}

test("10. remote kit twice gives two waiting seats; a sixth PC is refused", () => {
  const a = w.cli(["kit", stick("k1")]);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(a.stdout.trim(), join(sticks, "k1", "Company Engine for Windows"));
  const b = w.cli(["kit", stick("k2"), "--name", "Front desk", "--role", "view"]);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  const seats = JSON.parse(readFileSync(join(w.remoteDir, "seats.json"), "utf8")).seats;
  assert.deepEqual(seats.map((s) => [s.n, s.name, s.role, s.state, s.fingerprint]),
    [[1, "Windows PC", "desk", "waiting", null], [2, "Front desk", "view", "waiting", null]]);
  assert.equal(statSync(join(w.remoteDir, "seats.json")).mode & 0o777, 0o600);
  assert.equal(statSync(w.remoteDir).mode & 0o777, 0o700);
  for (const n of [3, 4, 5]) assert.equal(w.cli(["kit", stick(`k${n}`)]).status, 0);
  const before = snapshot(w.remoteDir);
  const six = w.cli(["kit", stick("k6")]);
  assert.equal(six.status, 1);
  assert.equal(six.stdout.trim(), "Five PCs are already listed. Remove one first.");
  assert.deepEqual(snapshot(w.remoteDir), before);
  assert.deepEqual(readdirSync(join(sticks, "k6")), []);
  const list = w.cli(["seats"]);
  assert.equal(list.stdout.trim().split("\n").length, 5);
  assert.match(list.stdout, /^2 {2}Front desk {2}view {2}waiting {2}-$/m);
});

test("11. the kit: known_hosts, door.txt, no private key, the icon, and scripts with no download and no other address", () => {
  const kit = join(sticks, "k1", "Company Engine for Windows");
  const files = join(kit, "files");
  assert.deepEqual(readdirSync(kit).sort(), ["Read me.txt", "Set up.cmd", "files"]);
  assert.deepEqual(readdirSync(files).sort(),
    ["CompanyEngine.ico", "door.txt", "known_hosts", "open.ps1", "setup.ps1", "ssh-args.txt"]);
  const known = readFileSync(join(files, "known_hosts"), "utf8");
  assert.equal(known.split("\n").filter(Boolean).length, 1);
  assert.match(known, /^company-engine ssh-ed25519 [A-Za-z0-9+/]{68}\n$/);
  // the kit's own door port in a test is a stand-in; the template's is 3220
  const door = readFileSync(join(files, "door.txt"), "utf8").split("\n").filter(Boolean);
  assert.equal(door[0], "seat 1");
  assert.equal(door[1], `port ${w.cfg.ports.remote}`);
  assert.equal(door[2], `user ${OWNER}`);
  assert.ok(door.slice(3).length >= 1 && door.slice(3).every((l) => /^host [A-Za-z0-9][A-Za-z0-9.-]*$/.test(l)), door.join("|"));
  const grep = spawnSync("/usr/bin/grep", ["-rl", "PRIVATE KEY", kit], { encoding: "utf8" });
  assert.equal(grep.stdout.trim().split("\n").filter(Boolean).length, 0);
  const ico = readFileSync(join(files, "CompanyEngine.ico"));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(ico.readUInt8(6), 0, "256 pixels wide (0 in an ICO entry)");
  for (const name of ["setup.ps1", "open.ps1"]) {
    const text = readFileSync(join(files, name), "utf8");
    for (const bad of ["Invoke-Expression", "iex ", "DownloadString", "Invoke-WebRequest", "Start-BitsTransfer", "-EncodedCommand", "RunAs"]) {
      assert.equal(text.includes(bad), false, `${name} holds ${bad}`);
    }
    for (const ip of text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []) assert.equal(ip, "127.0.0.1", `${name} names ${ip}`);
    for (const url of text.match(/https?:\/\/[^\s'"`/]+/gi) || []) assert.match(url, /^http:\/\/127\.0\.0\.1(:3200)?$/, `${name} names ${url}`);
    assert.ok(text.split("\r\n").length - 1 <= 150, `${name} is longer than 150 lines`);
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text), `${name} is not plain ASCII`);
  }
  assert.match(readFileSync(join(kit, "Set up.cmd"), "utf8"), /\r\n/);
  // a desk kit forwards the seat and every app port; a view kit the seat only
  const args = readFileSync(join(files, "ssh-args.txt"), "utf8");
  assert.equal(args.match(/^-L /gm).length, 30);
  assert.match(args, /^-L 127\.0\.0\.1:3200:127\.0\.0\.1:\{SEATPORT\}$/m);
  const view = readFileSync(join(sticks, "k2", "Company Engine for Windows", "files", "ssh-args.txt"), "utf8");
  assert.deepEqual(view.match(/^-L .*$/gm), ["-L 127.0.0.1:3200:127.0.0.1:{SEATPORT}"]);
  assert.match(readFileSync(join(sticks, "k2", "Company Engine for Windows", "files", "door.txt"), "utf8"), /^seat 2$/m);
});

// open.ps1's check of ssh-args.txt, as written there: the pinned lines read from the script itself, each whole.
function pinnedOf(ps1) {
  const m = /^\$Pinned = @\(([\s\S]*?)\)\r?$/m.exec(ps1);
  assert.ok(m, "open.ps1 holds no $Pinned list");
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}
function psAccepts(pinned, text, port) {
  const lines = text.split(/\r?\n/).filter((l) => l !== "");
  const must = [...pinned, `-p ${port}`];
  const apps = [];
  for (let p = 3160; p <= 3189; p++) if (p !== 3170) apps.push(`-L 127.0.0.1:${p}:127.0.0.1:${p}`);
  const may = [...must, ...apps];
  if (lines.some((l) => !may.includes(l))) return false;
  if (must.some((l) => lines.filter((x) => x === l).length !== 1)) return false;
  return lines.at(-1) === "{USER}@{HOST}";
}

test("open.ps1 takes ssh-args.txt only as the Mac wrote it: whole lines, with their values (L3)", () => {
  const ps1 = readFileSync(join(sticks, "k1", "Company Engine for Windows", "files", "open.ps1"), "utf8");
  const pinned = pinnedOf(ps1);
  // The script compares whole lines: no pattern of option names is left, and the app ports are the pinned two runs.
  assert.match(ps1, /\$may -cnotcontains \$line/);
  assert.match(ps1, /\$_ -ceq \$line/);
  assert.match(ps1, /@\(3160\.\.3169\) \+ @\(3171\.\.3189\)/);
  assert.doesNotMatch(ps1, /StrictHostKeyChecking\|/);
  // The pinned list is the plan's, every value included.
  const plan = readFileSync(new URL("../kit/ssh-args.txt", import.meta.url), "utf8").split("\n")
    .filter((l) => l !== "" && l !== "-p 3220" && !/^-L 127\.0\.0\.1:31[6-8]\d:/.test(l));
  assert.deepEqual(pinned, plan);
  assert.ok(pinned.includes("-o StrictHostKeyChecking=yes") && pinned.includes("-o UserKnownHostsFile={KNOWN}"));
  // Both kits pass as written.
  const port = w.cfg.ports.remote;
  for (const k of ["k1", "k2"]) {
    assert.equal(psAccepts(pinned, readFileSync(join(sticks, k, "Company Engine for Windows", "files", "ssh-args.txt"), "utf8"), port), true, k);
  }
  // A changed file does not.
  const desk = readFileSync(join(sticks, "k1", "Company Engine for Windows", "files", "ssh-args.txt"), "utf8").replace(/\r\n/g, "\n");
  const changed = {
    "no host check": desk.replace("-o StrictHostKeyChecking=yes", "-o StrictHostKeyChecking=no"),
    "another known_hosts": desk.replace("-o UserKnownHostsFile={KNOWN}", "-o UserKnownHostsFile=NUL"),
    "accept-new": desk.replace("-o StrictHostKeyChecking=yes", "-o StrictHostKeyChecking=accept-new"),
    "another alias": desk.replace("-o HostKeyAlias=company-engine", "-o HostKeyAlias=other"),
    "agent on": desk.replace("-o ForwardAgent=no", "-o ForwardAgent=yes"),
    "the Mac's own port": desk.replace("-L 127.0.0.1:3200:127.0.0.1:{SEATPORT}", "-L 127.0.0.1:3200:127.0.0.1:3200"),
    "an app port to another": desk.replace("-L 127.0.0.1:3171:127.0.0.1:3171", "-L 127.0.0.1:3171:127.0.0.1:3100"),
    "another door port": desk.replace(`-p ${port}`, "-p 22"),
    "a line twice": desk + "-o BatchMode=yes\n",
    "a line gone": desk.replace("-o BatchMode=yes\n", ""),
    "a new option": desk.replace("-N\n", "-N\n-o ProxyCommand=calc.exe\n"),
    "target not last": desk.replace("{USER}@{HOST}\n", "").replace("-N\n", "{USER}@{HOST}\n-N\n"),
  };
  for (const [name, text] of Object.entries(changed)) {
    assert.notEqual(text, desk, name);
    assert.equal(psAccepts(pinned, text, port), false, name);
  }
});

test("9. on, off, allow and remove with stdin not a terminal: Run this yourself in Terminal., exit 1, nothing changed", () => {
  const req = join(w.root, "req.txt");
  writeFileSync(req, `${newKey(w.keys, "nt").line} seat-1\n`);
  const before = snapshot(w.state);
  for (const args of [["on"], ["off"], ["allow", req], ["remove", "1"]]) {
    const r = w.cli(args, "yes\n");
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.stdout, "Run this yourself in Terminal.\n", args.join(" "));
  }
  assert.deepEqual(snapshot(w.state), before);
  assert.equal(w.cli(["status"]).stdout, "remote door: off\n");
});

test("allow at a terminal: shows the PC's code, asks for yes, then fills the waiting seat", () => {
  const k = newKey(w.keys, "pc2");
  const req = join(w.root, "req2.txt");
  writeFileSync(req, `${k.line} seat-2\r\n`);
  const fp = spawnSync("/usr/bin/ssh-keygen", ["-l", "-f", k.path + ".pub"], { encoding: "utf8" }).stdout.split(" ")[1];
  const before = snapshot(w.state);
  const no = w.tty(["allow", req], "no");
  assert.equal(no.status, 1);
  assert.match(no.stdout, new RegExp(`^This PC's code: ${fp.replace(/[+/]/g, "\\$&")}$`, "m"));
  // Which PC, its name and its role come before the question, after the code (REVIEW-DESKTOP L2).
  const lines = no.stdout.split("\n");
  const at = lines.findIndex((l) => l.startsWith("This PC's code: "));
  assert.deepEqual(lines.slice(at + 1, at + 3), ["It must match the code the PC showed.", "PC 2 (Front desk) asks to join as view. Type yes to allow it."]);
  assert.deepEqual(snapshot(w.state), before);
  const yes = w.tty(["allow", req], "yes");
  assert.equal(yes.status, 0, yes.stdout);
  assert.match(yes.stdout, /^PC 2 is allowed\.$/m);
  const seat = JSON.parse(readFileSync(join(w.remoteDir, "seats.json"), "utf8")).seats.find((s) => s.n === 2);
  assert.equal(seat.state, "allowed");
  assert.equal(seat.fingerprint, fp);
  const ak = readFileSync(join(w.remoteDir, "authorized_keys"), "utf8");
  assert.equal(ak, `restrict,port-forwarding,permitopen="127.0.0.1:${w.seatPort(2)}" ssh-ed25519 ${k.key} seat-2\n`);
  assert.equal(statSync(join(w.remoteDir, "authorized_keys")).mode & 0o777, 0o600);
  // the same PC twice
  const again = w.tty(["allow", req], "yes");
  assert.equal(again.status, 1);
  assert.match(again.stdout, /^This PC is already allowed\.$/m);
});

test("allow refuses a request that names a seat not waiting, before any question; one naming none takes the first waiting (L2)", () => {
  const seatsFile = join(w.remoteDir, "seats.json");
  const k = newKey(w.keys, "pc-l2");
  const req = (name, comment) => {
    const p = join(w.root, `req-${name}.txt`);
    writeFileSync(p, comment ? `${k.line} ${comment}\n` : `${k.line}\n`);
    return p;
  };
  const before = snapshot(w.state);
  const refused = (r) => {
    assert.equal(r.status, 1, r.stdout);
    assert.equal(r.stdout.trim(), "That PC is not waiting to join. Nothing was changed.");
  };
  // seat 2 is allowed by now: a request naming it is refused, with no code shown and no question
  refused(w.tty(["allow", req("s2", "seat-2")], "yes"));
  // seat 5 taken off the list: a request still naming it is refused, never given to another waiting seat
  const seats = readFileSync(seatsFile);
  const data = JSON.parse(seats.toString("utf8"));
  writeFileSync(seatsFile, JSON.stringify({ seats: data.seats.filter((s) => s.n !== 5) }), { mode: 0o600 });
  refused(w.tty(["allow", req("s5", "seat-5")], "yes"));
  writeFileSync(seatsFile, seats, { mode: 0o600 });
  // a waiting seat named: that one is offered, with its number, name and role
  const four = w.tty(["allow", req("s4", "seat-4")], "no");
  assert.equal(four.status, 1, four.stdout);
  assert.match(four.stdout, /^PC 4 \(Windows PC\) asks to join as desk\. Type yes to allow it\.$/m);
  // none named: the first waiting seat
  const plain = w.tty(["allow", req("plain", null)], "no");
  assert.match(plain.stdout, /^PC 1 \(Windows PC\) asks to join as desk\. Type yes to allow it\.$/m);
  assert.deepEqual(snapshot(w.state), before);
});

test("8. twelve bad seat requests: each refused with the fixed sentence, exit 1, authorized_keys unchanged", () => {
  const good = newKey(w.keys, "good");
  const rsa = newKey(w.keys, "rsa8", "rsa");
  const bad = join(w.root, "bad");
  mkdirSync(bad);
  // the right length and shape, but the key inside names another type
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25518"), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 7)]);
  const wrongType = blob.toString("base64");
  assert.equal(wrongType.length, 68);
  assert.notEqual(spawnSync("/usr/bin/ssh-keygen", ["-l", "-f", "/dev/stdin"], { input: `ssh-ed25519 ${wrongType}\n` }).status, 0);
  const cases = {
    "two-lines": `${good.line} seat-1\n${good.line} seat-1\n`,
    "break-inside": `ssh-ed25519 ${good.key.slice(0, 30)}\n${good.key.slice(30)} seat-1\n`,
    "option-prefix": `command="/bin/sh" ${good.line} seat-1\n`,
    rsa: `${rsa.line} seat-1\n`,
    "67-chars": `ssh-ed25519 ${good.key.slice(0, 67)} seat-1\n`,
    "69-chars": `ssh-ed25519 ${good.key}A seat-1\n`,
    "non-ascii": `${good.line} sièt-1\n`,
    "201-bytes": `${good.line} ${"x".repeat(200 - good.line.length - 1)}\n`,
    empty: "",
    "keygen-rejects": `ssh-ed25519 ${wrongType} seat-1\n`,
  };
  const paths = [];
  for (const [name, text] of Object.entries(cases)) {
    const p = join(bad, name);
    writeFileSync(p, text);
    paths.push(p);
  }
  assert.equal(readFileSync(join(bad, "201-bytes")).length, 201);
  // a link to a good request, and a folder
  writeFileSync(join(w.root, "real.txt"), `${good.line} seat-1\n`);
  symlinkSync(join(w.root, "real.txt"), join(bad, "link"));
  paths.push(join(bad, "link"));
  mkdirSync(join(bad, "folder"));
  paths.push(join(bad, "folder"));
  assert.equal(paths.length, 12);
  const ak = join(w.remoteDir, "authorized_keys");
  const before = readFileSync(ak);
  const state = snapshot(w.state);
  for (const p of paths) {
    const r = w.tty(["allow", p], "yes");
    assert.equal(r.status, 1, p + ": " + r.stdout);
    assert.equal(r.stdout.trim(), NOT_REQUEST, p);
  }
  assert.deepEqual(readFileSync(ak), before);
  assert.deepEqual(snapshot(w.state), state);
  // and a FIFO does not hang the reader
  const fifo = join(bad, "fifo");
  assert.equal(spawnSync("/usr/bin/mkfifo", [fifo]).status, 0);
  const t0 = Date.now();
  const r = w.tty(["allow", fifo], "yes");
  assert.equal(r.stdout.trim(), NOT_REQUEST);
  assert.ok(Date.now() - t0 < 10000);
  assert.deepEqual(readFileSync(ak), before);
});
