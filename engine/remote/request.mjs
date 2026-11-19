// A seat request (PLAN-DESKTOP, "A seat request"): the one line "Set up.cmd" writes on the stick. It is hostile
// until proved otherwise: read without following a link, one line of plain ASCII in the pinned shape, a real
// ed25519 key that ssh-keygen accepts. Only the 68-character key ever goes on; the comment is read for a seat
// number and nothing else.
import { closeSync, fstatSync, mkdtempSync, readSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openNoLinks } from "../lib/nolinks.mjs";
import { fingerprintOf } from "./state.mjs";

export const REQUEST_CAP = 200;
const LINE_RE = /^ssh-ed25519 ([A-Za-z0-9+/]{68})( [ -~]{0,64})?\r?\n?$/;
const KEYGEN = "/usr/bin/ssh-keygen";

// The bytes of the request file, or null when it is not a small real file.
function readRequest(path) {
  let fd;
  try {
    fd = openNoLinks(path);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size === 0 || st.size > REQUEST_CAP) return null;
    const buf = Buffer.alloc(REQUEST_CAP + 1);
    let got = 0;
    for (;;) {
      const n = readSync(fd, buf, got, buf.length - got, null);
      if (n === 0) break;
      got += n;
      if (got > REQUEST_CAP) return null;
    }
    return buf.subarray(0, got);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// A real ed25519 public key: the wire form is "ssh-ed25519" and 32 bytes, nothing more.
function blobOk(key) {
  const b = Buffer.from(key, "base64");
  if (b.length !== 51 || b.toString("base64").replace(/=+$/, "") !== key) return false;
  return b.readUInt32BE(0) === 11 && b.subarray(4, 15).toString("latin1") === "ssh-ed25519" && b.readUInt32BE(15) === 32;
}

// ssh-keygen's own fingerprint of the key alone (never of the file given), or null when it refuses it.
function keygenFingerprint(key) {
  const dir = mkdtempSync(join(tmpdir(), "seat-request-"));
  try {
    const f = join(dir, "key.pub");
    writeFileSync(f, `ssh-ed25519 ${key}\n`, { mode: 0o600 });
    const r = spawnSync(KEYGEN, ["-l", "-E", "sha256", "-f", f], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, timeout: 10000 });
    if (r.status !== 0) return null;
    const m = /^256 (SHA256:[A-Za-z0-9+/]{43}) .*\(ED25519\)\s*$/.exec(r.stdout.trim());
    return m ? m[1] : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// { key, fingerprint, seat } or null. `seat` is the number the PC's kit named, when it named one.
export function parseRequest(path) {
  const buf = readRequest(path);
  if (buf === null) return null;
  for (const byte of buf) if (byte > 0x7e || (byte < 0x20 && byte !== 0x0a && byte !== 0x0d)) return null;
  const m = LINE_RE.exec(buf.toString("latin1"));
  if (!m) return null;
  const key = m[1];
  if (!blobOk(key)) return null;
  const fingerprint = keygenFingerprint(key);
  if (fingerprint === null || fingerprint !== fingerprintOf(key)) return null;
  const named = /^ seat-([1-5])$/.exec(m[2] || "");
  return { key, fingerprint, seat: named ? Number(named[1]) : null };
}
