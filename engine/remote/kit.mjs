// The kit for one Windows PC (PLAN-DESKTOP, "The kit folder"): written onto a folder the owner names, usually a
// USB stick. The stick is not trusted: no file is written through a link, an existing file is removed before a
// new one is made in its place, and no private key ever goes on it.
import {
  closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, unlinkSync,
  writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_SRC = join(dirname(fileURLToPath(import.meta.url)), "kit");
export const KIT_NAME = "Company Engine for Windows";
const CLEAN_ENV = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
const ICON_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "mac", "Resources", "icon-1024.png");
// Where the PC's browser and ssh.exe look: these never change, whatever the Mac's own ports are.
const PC_HOME_PORT = 3200;

// The Mac's names on the office network: <LocalHostName>.local, then each private IPv4 address it has now.
export function macHosts() {
  const hosts = [];
  const r = spawnSync("/usr/sbin/scutil", ["--get", "LocalHostName"], { encoding: "utf8", env: CLEAN_ENV, timeout: 5000 });
  const name = (r.stdout || "").trim();
  if (r.status === 0 && /^[A-Za-z0-9-]{1,63}$/.test(name)) hosts.push(`${name}.local`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal || !privateV4(a.address) || hosts.includes(a.address)) continue;
      hosts.push(a.address);
    }
  }
  return hosts;
}

function privateV4(ip) {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

// A real folder (never a link). Made when missing.
function realFolder(path) {
  try {
    const st = lstatSync(path);
    if (!st.isDirectory()) throw new Error(`not a folder: ${path}`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    mkdirSync(path, { mode: 0o755 });
    if (!lstatSync(path).isDirectory()) throw new Error(`not a folder: ${path}`);
  }
}

// Removes whatever file or link is at `path` (never a folder), then makes a new file there.
function writeNew(path, data) {
  try {
    const st = lstatSync(path);
    if (st.isDirectory()) throw new Error(`a folder is in the way: ${path}`);
    unlinkSync(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

const crlf = (text) => text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

// The argument list for this seat: the template, with the app ports kept for `desk` only, and the door's port.
export function sshArgsFor(role, port = 3220) {
  const lines = readFileSync(join(KIT_SRC, "ssh-args.txt"), "utf8").split("\n").filter((l) => l.trim() !== "");
  return lines.filter((l) => {
    const m = /^-L 127\.0\.0\.1:(\d+):/.exec(l);
    return !m || Number(m[1]) === PC_HOME_PORT || role === "desk";
  }).map((l) => (l === "-p 3220" ? `-p ${port}` : l)).join("\n") + "\n";
}

// The loft icon at 256 pixels, a PNG inside an ICO (T6 (10)), made by the icon maker in a private folder.
export function makeIcon() {
  const dir = mkdtempSync(join(tmpdir(), "kit-icon-"));
  try {
    const out = join(dir, "CompanyEngine.ico");
    const r = spawnSync("/bin/bash", [join(KIT_SRC, "make-icon.sh"), ICON_SRC, out], { encoding: "utf8", env: CLEAN_ENV, timeout: 30000 });
    if (r.status !== 0) throw new Error("the icon could not be made");
    const ico = readFileSync(out);
    if (ico.length < 6 || ico.readUInt32BE(0) !== 0x00000100) throw new Error("the icon could not be made");
    return ico;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Writes `<folder>/Company Engine for Windows/` and returns its path.
export function writeKit({ folder, seat, hostPublic, owner, hosts, port }) {
  const root = realpathSync(folder);
  if (!lstatSync(root).isDirectory()) throw new Error("not a folder");
  const kit = join(root, KIT_NAME);
  const files = join(kit, "files");
  realFolder(kit);
  realFolder(files);
  const icon = makeIcon();
  const door = [`seat ${seat.n}`, `port ${port}`, `user ${owner}`, ...hosts.map((h) => `host ${h}`)].join("\n") + "\n";
  writeNew(join(kit, "Set up.cmd"), crlf(readFileSync(join(KIT_SRC, "Set up.cmd"), "utf8")));
  writeNew(join(kit, "Read me.txt"), crlf(readFileSync(join(KIT_SRC, "Read me.txt"), "utf8")));
  writeNew(join(files, "setup.ps1"), crlf(readFileSync(join(KIT_SRC, "setup.ps1"), "utf8")));
  writeNew(join(files, "open.ps1"), crlf(readFileSync(join(KIT_SRC, "open.ps1"), "utf8")));
  writeNew(join(files, "ssh-args.txt"), sshArgsFor(seat.role, port));
  writeNew(join(files, "door.txt"), door);
  writeNew(join(files, "known_hosts"), `company-engine ${hostPublic}\n`);
  writeNew(join(files, "CompanyEngine.ico"), icon);
  // A request left from an earlier PC would be mistaken for this one's.
  try {
    if (!lstatSync(join(kit, "seat-request.txt")).isDirectory()) unlinkSync(join(kit, "seat-request.txt"));
  } catch { /* none */ }
  return kit;
}
