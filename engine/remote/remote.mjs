#!/usr/bin/env node
// `engine remote <word>`: the remote door's commands (PLAN-DESKTOP DW5, "Commands"). The door is opened, and a
// PC is allowed or removed, only from a Terminal on this Mac with a typed yes: no page, route, agent or seat
// can do it. Everything printed is for the owner.
//   engine remote status | seats | kit <folder> [--name "<words>"] [--role desk|view] | allow <seat-request.txt>
//                 | remove <n> | on | off
import { existsSync, statSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import {
  ROLES, SEATS_MAX, markerOn, seatCount, nameOk, readKeys, readSeats, remotePaths, remotePorts, writeKeys, writePrivate,
  writeSeats,
} from "./state.mjs";
import { authorizedKeys } from "./door-config.mjs";
import { ensureHostKey, ownerName } from "./door.mjs";
import { parseRequest } from "./request.mjs";
import { macHosts, writeKit } from "./kit.mjs";

const PART = join(dirname(fileURLToPath(import.meta.url)), "..", "parts", "41-remote.sh");

const SAY = Object.freeze({
  terminal: "Run this yourself in Terminal.",
  notRequest: 'This is not a seat request made by "Set up.cmd".',
  code: (fp) => `This PC's code: ${fp}`,
  match: "It must match the code the PC showed.",
  asks: (n, name, role) => `PC ${n} (${name}) asks to join as ${role}. Type yes to allow it.`,
  notWaiting: "That PC is not waiting to join. Nothing was changed.",
  full: "Five PCs are already listed. Remove one first.",
  off: "remote door: off",
  on: (k) => `remote door: on, ${k} PC(s) allowed`,
  unreadable: "The list of PCs could not be read safely. Nothing was changed.",
  noFolder: (p) => `There is no folder at ${p}.`,
  badName: "A PC's name may use letters, numbers, spaces and . _ ' - (up to 40).",
  kitFailed: (p) => `The kit could not be written to ${p}. Nothing was changed.`,
  noneWaiting: "No PC is waiting. Make a kit first: engine remote kit <folder>",
  already: "This PC is already allowed.",
  unchanged: "Nothing was changed.",
  allowed: (n) => `PC ${n} is allowed.`,
  noSeat: (n) => `There is no PC ${n}.`,
  askRemove: (n) => `Type yes to remove PC ${n}.`,
  removed: (n) => `PC ${n} is removed.`,
  askOn: "Type yes to open the remote door.",
  askOff: "Type yes to close the remote door.",
  noSeats: "No PCs are listed.",
});

const USAGE = `Usage: engine remote <command>

  status                 Say whether the remote door is on.
  seats                  List the PCs, one line each.
  kit <folder> [--name "<words>"] [--role desk|view]
                         Write a kit for one more Windows PC into <folder> (a USB stick).
  allow <seat-request.txt>
                         Allow the PC that made this request (you type yes).
  remove <n>             Remove PC <n> (you type yes).
  on                     Open the remote door (you type yes).
  off                    Close the remote door (you type yes).`;

const say = (line) => process.stdout.write(line + "\n");

// The commands that change who may come in need a person at a terminal, and a typed yes.
function needTerminal() {
  if (process.stdin.isTTY) return true;
  say(SAY.terminal);
  return false;
}

function askYes(question) {
  say(question);
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    let answered = false;
    rl.once("line", (line) => { answered = true; rl.close(); done(line.trim() === "yes"); });
    rl.once("close", () => { if (!answered) done(false); });
  });
}

// Runs the door's part (start, stop or health); returns { code, out }.
function part(sub) {
  const r = spawnSync("/bin/bash", [PART, sub], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  return { code: r.status ?? 1, out: (r.stdout || "").trim() };
}

// The door's state is the running process, as the part's health finds it, never the marker alone (REVIEW-DESKTOP
// M2): 0 is on, 2 is running but not answering (still running: it may hold a PC's connection), 1 is off.
const doorRunning = () => { const c = part("health").code; return c === 0 || c === 2; };

function printOut(out) {
  if (out) say(out.split("\n").filter((l) => l.trim() !== "").pop());
}

// After the seats changed: when the door is switched on or is running, it is stopped (which ends every open
// connection) and started again to read the seats anew; with no PC left allowed it is only stopped. A stop that
// fails is said and returned, so a removed PC's connection is never reported as ended when it may not be.
function restartIfOn(paths) {
  if (!markerOn(paths) && !doorRunning()) return 0;
  const stopped = part("stop");
  if (stopped.code !== 0) { printOut(stopped.out); return stopped.code; }
  const seats = readSeats(paths);
  if (!seats || !seats.some((s) => s.state === "allowed")) return 0;
  const r = part("start");
  if (r.code !== 0) printOut(r.out);
  return r.code;
}

function status(cfg) {
  const paths = remotePaths(cfg);
  const seats = readSeats(paths) || [];
  if (doorRunning()) say(SAY.on(seats.filter((s) => s.state === "allowed").length));
  else say(SAY.off);
  return 0;
}

function seatsList(cfg) {
  const seats = readSeats(remotePaths(cfg));
  if (seats === null) { say(SAY.unreadable); return 1; }
  if (seats.length === 0) { say(SAY.noSeats); return 0; }
  for (const s of seats) say(`${s.n}  ${s.name}  ${s.role}  ${s.state}  ${s.fingerprint || "-"}`);
  return 0;
}

function kit(cfg, args) {
  let folder = null;
  let name = "Windows PC";
  let role = "desk";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && i + 1 < args.length) name = args[++i];
    else if (args[i] === "--role" && i + 1 < args.length) role = args[++i];
    else if (folder === null && !args[i].startsWith("--")) folder = args[i];
    else { console.error(USAGE); return 64; }
  }
  if (folder === null || !ROLES.includes(role)) { console.error(USAGE); return 64; }
  if (!nameOk(name)) { say(SAY.badName); return 1; }
  let isFolder = false;
  try { isFolder = statSync(resolve(folder)).isDirectory(); } catch { /* none */ }
  if (!isFolder) { say(SAY.noFolder(folder)); return 1; }
  const paths = remotePaths(cfg);
  const seats = readSeats(paths);
  if (seats === null) { say(SAY.unreadable); return 1; }
  let n = 1;
  while (seats.some((s) => s.n === n)) n++;
  if (seats.length >= SEATS_MAX || n > seatCount(cfg)) { say(SAY.full); return 1; }
  const seat = { n, name, role, state: "waiting", fingerprint: null, added: new Date().toISOString() };
  let out;
  try {
    const host = ensureHostKey(paths);
    if (host === null) throw new Error("no host key");
    out = writeKit({ folder, seat, hostPublic: host.line, owner: ownerName(), hosts: macHosts(), port: remotePorts(cfg).door });
    writeSeats(paths, seats.concat([seat]));
  } catch {
    say(SAY.kitFailed(folder));
    return 1;
  }
  say(out);
  return 0;
}

async function allow(cfg, args) {
  if (args.length !== 1) { console.error(USAGE); return 64; }
  if (!needTerminal()) return 1;
  const req = parseRequest(resolve(args[0]));
  if (req === null) { say(SAY.notRequest); return 1; }
  const paths = remotePaths(cfg);
  const seats = readSeats(paths);
  const keys = readKeys(paths);
  if (seats === null || keys === null) { say(SAY.unreadable); return 1; }
  if (seats.some((s) => s.state === "allowed" && keys[s.n] === req.key)) { say(SAY.already); return 1; }
  const waiting = seats.filter((s) => s.state === "waiting");
  if (!waiting.length) { say(SAY.noneWaiting); return 1; }
  // A request that names its seat (the kit writes "seat-<n>") fills that seat or nothing: never another PC's place,
  // whose port the PC's door.txt would not match (REVIEW-DESKTOP L2). One that names none takes the first waiting.
  const seat = req.seat === null ? waiting[0] : waiting.find((s) => s.n === req.seat);
  if (!seat) { say(SAY.notWaiting); return 1; }
  say(SAY.code(req.fingerprint));
  say(SAY.match);
  // Which PC, its name and its role, before the yes (L2).
  if (!(await askYes(SAY.asks(seat.n, seat.name, seat.role)))) { say(SAY.unchanged); return 1; }
  // Read again after the wait: only the seat chosen above changes, and only as the owner saw it.
  const now = readSeats(paths);
  const nowKeys = readKeys(paths);
  const target = now && now.find((s) => s.n === seat.n && s.state === "waiting" && s.name === seat.name && s.role === seat.role);
  if (!target || nowKeys === null) { say(SAY.unchanged); return 1; }
  nowKeys[seat.n] = req.key;
  target.state = "allowed";
  target.fingerprint = req.fingerprint;
  writeKeys(paths, nowKeys);
  writeSeats(paths, now);
  writePrivate(paths.authorizedKeys, authorizedKeys(now, nowKeys, remotePorts(cfg)));
  say(SAY.allowed(seat.n));
  return restartIfOn(paths) === 0 ? 0 : 1;
}

async function remove(cfg, args) {
  if (args.length !== 1 || !/^[1-5]$/.test(args[0])) { console.error(USAGE); return 64; }
  if (!needTerminal()) return 1;
  const n = Number(args[0]);
  const paths = remotePaths(cfg);
  if (readSeats(paths) === null || readKeys(paths) === null) { say(SAY.unreadable); return 1; }
  if (!readSeats(paths).some((s) => s.n === n)) { say(SAY.noSeat(n)); return 1; }
  if (!(await askYes(SAY.askRemove(n)))) { say(SAY.unchanged); return 1; }
  const seats = readSeats(paths);
  const keys = readKeys(paths);
  if (seats === null || keys === null) { say(SAY.unreadable); return 1; }
  delete keys[n];
  const left = seats.filter((s) => s.n !== n);
  writeKeys(paths, keys);
  writeSeats(paths, left);
  writePrivate(paths.authorizedKeys, authorizedKeys(left, keys, remotePorts(cfg)));
  say(SAY.removed(n));
  return restartIfOn(paths) === 0 ? 0 : 1;
}

async function on(cfg) {
  if (!needTerminal()) return 1;
  if (!(await askYes(SAY.askOn))) { say(SAY.unchanged); return 1; }
  const paths = remotePaths(cfg);
  writePrivate(paths.marker, new Date().toISOString() + "\n");
  const r = part("start");
  printOut(r.out);
  if (r.code !== 0) {
    // A start that failed may still have left sshd running (the part gives up after its wait): it is stopped
    // first, and the marker goes only once nothing runs, so the marker never says off while the door is up (M2).
    const stopped = part("stop");
    if (stopped.code !== 0) { printOut(stopped.out); return 1; }
    try { unlinkSync(paths.marker); } catch { /* gone */ }
    return 1;
  }
  return 0;
}

async function off(cfg) {
  if (!needTerminal()) return 1;
  if (!(await askYes(SAY.askOff))) { say(SAY.unchanged); return 1; }
  const paths = remotePaths(cfg);
  // The door is stopped first; the marker goes only when that worked, so a failed stop leaves it switched on (M2).
  const r = part("stop");
  if (r.code !== 0) { printOut(r.out); return 1; }
  try { if (existsSync(paths.marker)) unlinkSync(paths.marker); } catch { /* gone */ }
  say(SAY.off);
  return 0;
}

async function main(argv) {
  const [word, ...args] = argv;
  if (word === "help" || word === "-h" || word === "--help") { say(USAGE); return 0; }
  if (!["status", "seats", "kit", "allow", "remove", "on", "off"].includes(word)) { console.error(USAGE); return 64; }
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    say("The engine's settings file (engine/config.json) could not be read. Put it back from the repository, then try again.");
    return 1;
  }
  if ((word === "status" || word === "seats" || word === "on" || word === "off") && args.length !== 0) { console.error(USAGE); return 64; }
  switch (word) {
    case "status": return status(cfg);
    case "seats": return seatsList(cfg);
    case "kit": return kit(cfg, args);
    case "allow": return allow(cfg, args);
    case "remove": return remove(cfg, args);
    case "on": return on(cfg);
    default: return off(cfg);
  }
}

process.exitCode = await main(process.argv.slice(2));
