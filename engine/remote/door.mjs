#!/usr/bin/env node
// The remote door's own program (PLAN-DESKTOP DW2): its host key, and the two files sshd reads, rebuilt from the
// fixed template and the seats at every start. 41-remote.sh runs `door.mjs prepare` before it starts
// /usr/sbin/sshd, and `door.mjs port` to know where the door listens.
//   door.mjs prepare | port
import { closeSync, existsSync, fstatSync, lstatSync, readSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { openNoLinks } from "../lib/nolinks.mjs";
import {
  ensurePrivateFolder, fingerprintOf, readKeys, readPrivate, readSeats, remotePaths, remotePorts, writePrivate,
} from "./state.mjs";
import { authorizedKeys, checkPorts, sshdConfig } from "./door-config.mjs";

const SSHD = "/usr/sbin/sshd";
const KEYGEN = "/usr/bin/ssh-keygen";
const CLEAN_ENV = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
const USER_RE = /^[a-z_][a-z0-9_.-]{0,31}$/i;

// The door's fixed reasons for not starting: `The remote door could not start: <reason>.`
export const NOT_STARTED = Object.freeze({
  seats: "the list of PCs could not be read safely",
  none: "no PC is allowed yet",
  hostKey: "its key is missing or not private",
  folders: "a folder on the way to its files can be changed by others",
  ports: "its ports overlap the engine's own",
  check: "its settings did not pass sshd's own check",
  wide: "a test asked it to listen beyond this Mac",
});
export const notStarted = (reason) => `The remote door could not start: ${reason}.`;

// This Mac's short user name: the only account the door lets in.
export function ownerName() {
  const name = userInfo().username;
  if (!USER_RE.test(name)) throw new Error("the user name cannot go in the door's settings");
  return name;
}

export const loopbackOnly = () => process.env.ENGINE_REMOTE_LOOPBACK === "1";

// Makes the door's host key once (ed25519, no passphrase, mode 600 in a 700 folder). Never printed.
export function ensureHostKey(paths) {
  ensurePrivateFolder(paths.secrets);
  if (!existsSync(paths.hostKey) && !isLink(paths.hostKey)) {
    const r = spawnSync(KEYGEN, ["-q", "-t", "ed25519", "-N", "", "-C", "company-engine", "-f", paths.hostKey],
      { encoding: "utf8", env: CLEAN_ENV, timeout: 20000 });
    if (r.status !== 0) throw new Error("the door's key could not be made");
  }
  return hostKeyPublic(paths);
}

function isLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

// The host key's public half, `ssh-ed25519 <key>`, read from the private file's own .pub (checked like a seat file).
export function hostKeyPublic(paths) {
  if (readPrivate(paths.hostKey, 4096) === null) return null;
  return readPublic(paths.hostKeyPub);
}

function readPublic(path) {
  let text = null;
  let fd;
  try {
    fd = openNoLinks(path);
    const st = fstatSync(fd);
    if (st.isFile() && st.uid === process.getuid() && (st.mode & 0o022) === 0 && st.size <= 1024) {
      const buf = Buffer.alloc(1025);
      text = buf.subarray(0, readSync(fd, buf, 0, 1025, 0)).toString("latin1");
    }
  } catch {
    text = null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const m = /^ssh-ed25519 ([A-Za-z0-9+/]{68})(?: [ -~]*)?\n?$/.exec(text || "");
  return m ? { line: `ssh-ed25519 ${m[1]}`, fingerprint: fingerprintOf(m[1]) } : null;
}

// StrictModes: every folder from the door's files up to the home folder (or the root) must be the owner's or
// root's, and writable by nobody else (T6 (8)).
function foldersSafe(paths) {
  const home = userInfo().homedir;
  for (const start of [paths.dir, paths.secrets]) {
    let d = start;
    for (;;) {
      let st;
      try { st = statSync(d); } catch { return false; }
      if ((st.uid !== process.getuid() && st.uid !== 0) || (st.mode & 0o022) !== 0) return false;
      if (d === home || d === "/") break;
      d = dirname(d);
    }
  }
  return true;
}

// Rebuilds authorized_keys and sshd_config from the seats, then lets sshd check the result. Returns null when the
// door may start, or the fixed reason it may not.
export function prepare(cfg) {
  const paths = remotePaths(cfg);
  const ports = remotePorts(cfg);
  const loopback = loopbackOnly();
  // A test never binds beyond 127.0.0.1 (rule 3), even by mistake.
  if (!loopback && process.env.NODE_TEST_CONTEXT) return NOT_STARTED.wide;
  const seats = readSeats(paths);
  const keys = readKeys(paths);
  if (seats === null || keys === null) return NOT_STARTED.seats;
  const allowed = seats.filter((s) => s.state === "allowed");
  if (allowed.length === 0) return NOT_STARTED.none;
  for (const s of allowed) if (!keys[s.n] || fingerprintOf(keys[s.n]) !== s.fingerprint) return NOT_STARTED.seats;
  try { checkPorts(allowed, ports); } catch { return NOT_STARTED.ports; }
  if (hostKeyPublic(paths) === null) return NOT_STARTED.hostKey;
  let owner;
  try { owner = ownerName(); } catch { return NOT_STARTED.check; }
  writePrivate(paths.authorizedKeys, authorizedKeys(seats, keys, ports));
  writePrivate(paths.sshdConfig, sshdConfig({ paths, ports, owner, seats, loopback }));
  ensurePrivateFolder(dirname(paths.pid));
  if (!foldersSafe(paths)) return NOT_STARTED.folders;
  const t = spawnSync(SSHD, ["-t", "-f", paths.sshdConfig], { encoding: "utf8", env: CLEAN_ENV, timeout: 20000 });
  if (t.status !== 0) return NOT_STARTED.check;
  return null;
}

function main(argv) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    console.log("The engine's settings file could not be read.");
    return 1;
  }
  if (argv[0] === "port") {
    console.log(String(remotePorts(cfg).door));
    return 0;
  }
  if (argv[0] === "prepare") {
    let reason;
    try { reason = prepare(cfg); } catch { reason = NOT_STARTED.check; }
    if (reason === null) return 0;
    console.log(notStarted(reason));
    return 1;
  }
  console.error("Usage: door.mjs prepare | port");
  return 64;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
