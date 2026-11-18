// The scroll-craft kit's list (PLAN-ASTRYX T13): every file of engine/scrollcraft-kit/scrollcraft/ with its bytes and
// sha256, where it came from, the addresses its text names and the calls that reach out. Node 24, no dependency.
// It only reads and hashes files; it never runs, imports or fetches anything.
//   node engine/scrollcraft-kit/lock.mjs --verify   every file in scrollcraft/ is in the list as listed, and nothing else
//   node engine/scrollcraft-kit/lock.mjs --write    writes scrollcraft.lock.json from the folder (after a reviewed change)
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KIT_DIR = join(HERE, "scrollcraft");
export const LOCK_PATH = join(HERE, "scrollcraft.lock.json");
export const COMMIT = "75d81f7";
const UPSTREAM = "plugins/nateherk-design/skills/scroll-craft/engine/";
// Where each file came from: the upstream repository's path, or this engine.
export const FROM = Object.freeze({
  "LICENSE.txt": "upstream: LICENSE",
  "scrollcraft.css": `upstream: ${UPSTREAM}scrollcraft.css`,
  "scrollcraft.js": `upstream: ${UPSTREAM}scrollcraft.js`,
  "scrollcraft-brand.css": "engine",
  "scrollcraft-mount.js": "engine",
});
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const ENDINGS = [".js", ".css", ".txt"];
export const FILE_MAX = 256 * 1024;
export const ADDRESS_RE = /https?:\/\/[^\s"'`)<>\\]+/g;
export const CALLS = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "importScripts", "new Worker",
  "SharedWorker", "serviceWorker", "eval(", "new Function", "import(", "@import", "localStorage", "document.cookie"];

const sha = (b) => createHash("sha256").update(b).digest("hex");

// The list as the folder is now -> the lock object. Throws on anything that is not a plain, listed kind of file.
export function lockOf(dir = KIT_DIR) {
  const files = [];
  const addresses = new Set();
  const calls = Object.fromEntries(CALLS.map((c) => [c, 0]));
  for (const name of readdirSync(dir).sort()) {
    const st = lstatSync(join(dir, name));
    if (!st.isFile() || !NAME_RE.test(name) || !ENDINGS.some((e) => name.endsWith(e)) || st.size > FILE_MAX) {
      throw new Error(`scrollcraft/${name} is not a plain .js, .css or .txt file of at most 256 KB`);
    }
    if (!FROM[name]) throw new Error(`scrollcraft/${name} has no known source`);
    const b = readFileSync(join(dir, name));
    files.push({ name, bytes: b.length, sha256: sha(b), from: FROM[name] });
    const text = b.toString("latin1");
    if (!name.endsWith(".txt")) {
      for (const m of text.matchAll(ADDRESS_RE)) addresses.add(m[0]);
      for (const c of CALLS) calls[c] += text.split(c).length - 1;
    }
  }
  return {
    version: 1,
    scrollcraft: COMMIT,
    source: `github.com/nateherkai/scroll-craft at commit ${COMMIT} (MIT, Nate Herk); the engine's own files are marked "engine"`,
    files,
    addresses: [...addresses].sort(),
    calls,
  };
}

export const lockText = (lock) => `${JSON.stringify(lock, null, 2)}\n`;

// -> [] when the committed list is the folder as it is, else one line per difference.
export function verify(dir = KIT_DIR, lockPath = LOCK_PATH) {
  let want;
  try { want = JSON.parse(readFileSync(lockPath, "utf8")); } catch { return ["scrollcraft.lock.json could not be read"]; }
  let have;
  try { have = lockOf(dir); } catch (e) { return [e.message]; }
  const out = [];
  const byName = new Map((want.files || []).map((f) => [f.name, f]));
  for (const f of have.files) {
    const w = byName.get(f.name);
    if (!w) out.push(`scrollcraft/${f.name} is not in the list`);
    else if (w.bytes !== f.bytes || w.sha256 !== f.sha256) out.push(`scrollcraft/${f.name} is not the file the list names`);
    byName.delete(f.name);
  }
  for (const n of byName.keys()) out.push(`scrollcraft/${n} is in the list and not in the folder`);
  if (!out.length && lockText(have) !== lockText(want)) out.push("scrollcraft.lock.json is not the list the folder gives");
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--write" && process.argv.length === 3) {
    writeFileSync(LOCK_PATH, lockText(lockOf()));
    console.log("scroll-craft kit: the list is written.");
  } else if (mode === "--verify" && process.argv.length === 3) {
    const bad = verify();
    if (bad.length) { for (const l of bad) console.log(l); process.exit(1); }
    const lock = lockOf();
    console.log(`scroll-craft kit: ${lock.files.length} files, ${lock.files.reduce((s, f) => s + f.bytes, 0)} bytes, as listed.`);
  } else {
    console.error("usage: node engine/scrollcraft-kit/lock.mjs --verify | --write");
    process.exit(2);
  }
}
