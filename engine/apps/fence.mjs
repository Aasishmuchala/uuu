// The app fence (PLAN-V5 K18): what the sandbox tool (`srt`, the agent fence's own) is told
// when an app's code, its packages or its build runs. app-exec is the only caller. Zero
// dependencies.
//
// appFence(cfg, app, mode) is pure: it reads no environment variable and writes no file; it
// only looks at the disk for the real paths of the config's folders and asks the user
// database for the owner's home. Every list is sorted. For each mode (run, build, test,
// install) it gives K18's table, and what the agent fence's lessons add:
//   denyRead   the whole disk ("/"), so nothing outside the home folder is read either (other
//              disks under /Volumes, /Users/Shared, other users' homes, /Library, /usr/local,
//              Homebrew's own data such as its databases under /opt/homebrew/var; T85). Named
//              too, as before: the owner's home; as the walled agent's fence and the web door's
//              watch do, the system's temp areas (other runs' temp folders, the owner's own
//              TMPDIR); and the sandbox tool's and Claude Code's own temp folders.
//   allowRead  run: code, deps, data, run, tmp, home, Node 24; build and test: code, deps,
//              tmp, home, Node 24; install: deps, store, tmp, home, Node 24. In every mode, what
//              a Node program and a build need of the system (SYSTEM_READS: its libraries and
//              programs, /dev, the local time zone, the shell's own link), and, for an app whose
//              manifest names ffmpeg or ffprobe, that program and the Homebrew folders its
//              libraries live in (TOOL_READS), never the rest of /opt/homebrew.
//   allowWrite run: data, run, tmp, home; build: code/.build, code/dist, tmp, home; test: tmp,
//              home; install: deps, store, tmp, home.
//   denyWrite  code/app.json and code/READY; the sandbox tool's own temp folder, which srt
//              otherwise always leaves writable; and at every writable root, in every
//              spelling the disk takes, the names Claude Code and Codex load as settings,
//              instructions, skills or hooks (fence_plan.py's CONFIG_NAMES, K2a), so nothing
//              an app writes is ever loaded by an agent, the owner's tools or a builder.
//   network    allowedDomains none (install: registry.npmjs.org only); allowUnixSockets the
//              run folder (run only). Never allowLocalBinding (it opens every local port),
//              never allowAllUnixSockets.
// Every writable root must exist before the sandbox tool starts (app-exec makes them): inside,
// nothing may make or move a folder above a name it denies.
//
// As a script (app-exec only, run with an environment built from nothing):
//   node fence.mjs --settings <slug> <mode>
// writes the settings as fence_plan.py's write_settings does (named after their content's
// SHA-256 under <state>/fences/, 0644, an existing file used only when identical) and prints
// the path; on a refusal one line "app-exec: <why>" and exit 78.
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { appPaths, findApp, realOrGiven } from "./manifest.mjs";

export const MODES = Object.freeze(["run", "build", "test", "install"]);
export const REGISTRY = "registry.npmjs.org";
// Names Claude Code and Codex load from a folder they work in (fence_plan.py, CONFIG_NAMES).
export const CONFIG_NAMES = Object.freeze([".claude", "CLAUDE.md", "CLAUDE.local.md", ".mcp.json", "AGENTS.md",
  "AGENTS.override.md", ".codex", ".agents"]);
// Characters other than its two cases that this disk folds onto a letter (fence_plan.py,
// DISK_FOLDS: LONG S, KELVIN SIGN). A [Ss] set does not match them, so each is its own literal.
const DISK_FOLDS = { s: ["\u017f"], k: ["\u212a"] };
// The sandbox tool's own temp folder (fence_plan.py, SANDBOX_OWN_TMP).
export const SANDBOX_OWN_TMP = Object.freeze(["/private/tmp/claude", "/tmp/claude"]);
// The system's temp areas (fence_plan.py, TEMP_AREAS; the web door's DENY_READ).
export const TEMP_AREAS = Object.freeze(["/private/var/folders", "/var/folders", "/private/tmp", "/tmp"]);
// What every mode reads of the system, the disk being denied as a whole (T85): the system's own
// libraries and programs (dyld's cache lives under /System), devices, the local time zone
// (/etc/localtime, a link through the links /etc and /var into /private/var/db/timezone; the
// two root links are named alone, so nothing behind them but the time zone is opened), and the
// link /bin/sh reads to find the shell. Not /usr/local, not the rest of /private.
export const SYSTEM_READS = Object.freeze(["/System", "/bin", "/sbin", "/dev", "/usr/bin", "/usr/lib", "/usr/libexec",
  "/usr/sbin", "/usr/share", "/etc", "/var", "/private/etc/localtime", "/private/var/db/timezone", "/private/var/select/sh"]);
// ffmpeg and ffprobe as app-exec names them (K18), and the Homebrew folders their libraries load
// from (its Cellar, and opt's links into it); never Homebrew's etc or var.
export const TOOL_READS = Object.freeze({
  ffmpeg: ["/opt/homebrew/bin/ffmpeg", "/opt/homebrew/Cellar", "/opt/homebrew/opt"],
  ffprobe: ["/opt/homebrew/bin/ffprobe", "/opt/homebrew/Cellar", "/opt/homebrew/opt"],
});
const REFUSED_EXIT = 78;

// Every spelling the disk takes for `name`, as glob patterns: each letter as a two-letter set
// ([Cc]), and once more for every combination of DISK_FOLDS' characters. The first is the
// plain letter-set form (fence_plan.py, _any_case).
export function anyCase(name) {
  let spellings = [""];
  for (const c of name) {
    const lower = c.toLowerCase();
    const upper = c.toUpperCase();
    const options = [lower !== upper ? `[${upper}${lower}]` : c, ...(DISK_FOLDS[lower] || [])];
    spellings = spellings.flatMap((s) => options.map((o) => s + o));
  }
  return spellings;
}

// Four entries per spelling of each name for each writable root: the name at the top, inside
// it, at any depth, and inside it at any depth (fence_plan.py, _deny_entries).
export function configDenies(roots) {
  const out = [];
  for (const root of roots) {
    for (const name of CONFIG_NAMES) {
      for (const n of anyCase(name)) out.push(`${root}/${n}`, `${root}/${n}/**`, `${root}/**/${n}`, `${root}/**/${n}/**`);
    }
  }
  return out;
}

// The owner's home from the user database (never $HOME), by its real path.
export function ownerHome() {
  return realpathSync(userInfo().homedir);
}

const sorted = (list) => [...new Set(list)].sort();
// The disk ignores letter case, so every comparison of paths does too.
function inside(path, root) {
  const p = path.toLowerCase();
  const r = root.toLowerCase().replace(/\/+$/, "");
  return r === "" || p === r || p.startsWith(`${r}/`);
}

export function appFence(cfg, app, mode) {
  if (!MODES.includes(mode)) throw new Error(`the app fence has no mode ${mode}`);
  if (app === null || typeof app !== "object") throw new Error("the app fence was given no app");
  const p = appPaths(cfg, app.slug);
  const home = ownerHome();
  const state = realOrGiven(cfg.paths.state);
  const node = realOrGiven(cfg.node24);
  const uid = process.getuid();
  const tools = (Array.isArray(app.tools) ? app.tools : []).flatMap((t) => (Object.hasOwn(TOOL_READS, t) ? TOOL_READS[t] : []));
  const own = {
    run: [p.code, p.deps, p.data, p.run, p.tmp, p.home, node],
    build: [p.code, p.deps, p.tmp, p.home, node],
    test: [p.code, p.deps, p.tmp, p.home, node],
    install: [p.deps, p.store, p.tmp, p.home, node],
  }[mode];
  const reads = [...own, ...SYSTEM_READS, ...tools];
  const writes = {
    run: [p.data, p.run, p.tmp, p.home],
    build: [join(p.code, ".build"), join(p.code, "dist"), p.tmp, p.home],
    test: [p.tmp, p.home],
    install: [p.deps, p.store, p.tmp, p.home],
  }[mode];
  // A folder opened to an app never holds the owner's home or the engine's state, and is
  // never the whole disk (the backstop behind the config's own folders).
  for (const x of [...reads, ...writes]) {
    if (!x.startsWith("/") || inside(home, x) || inside(state, x)) {
      throw new Error(`refusing to open ${x} to an app: it holds folders the fence protects`);
    }
  }
  return {
    filesystem: {
      denyRead: sorted(["/", home, `/private/tmp/claude-${uid}`, `/tmp/claude-${uid}`, ...SANDBOX_OWN_TMP, ...TEMP_AREAS]),
      allowRead: sorted(reads),
      allowWrite: sorted(writes),
      denyWrite: sorted([join(p.code, "app.json"), join(p.code, "READY"), ...SANDBOX_OWN_TMP, ...configDenies(writes)]),
    },
    network: {
      allowedDomains: mode === "install" ? [REGISTRY] : [],
      deniedDomains: [],
      allowUnixSockets: mode === "run" ? [p.run] : [],
    },
  };
}

// fence_plan.py's write_settings: named after the content, never overwriting another fence's
// rules, an existing file used only when it is exactly the same and not a link.
export function writeSettings(settings, state) {
  const text = JSON.stringify(settings, null, 1);
  const folder = join(state, "fences");
  mkdirSync(folder, { recursive: true });
  const out = join(folder, `${createHash("sha256").update(text).digest("hex").slice(0, 20)}.json`);
  let same = false;
  try {
    same = !lstatSync(out).isSymbolicLink() && readFileSync(out, "utf8") === text;
  } catch { /* not there yet */ }
  if (!same) {
    const tmp = `${out}.${process.pid}.tmp`;
    try { unlinkSync(tmp); } catch { /* none left over */ }
    writeFileSync(tmp, text, { flag: "wx", mode: 0o644 });
    chmodSync(tmp, 0o644);
    renameSync(tmp, out);
  }
  return out;
}

function main(argv) {
  if (argv.length !== 3 || argv[0] !== "--settings") throw new Error("usage: fence.mjs --settings <slug> <mode>");
  const [, slug, mode] = argv;
  if (!MODES.includes(mode)) throw new Error(`the app fence has no mode ${mode}`);
  // engine/config.json beside this folder, never a file named by the environment.
  const cfg = loadConfig({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "config.json") });
  const { app } = findApp(cfg, slug);
  process.stdout.write(`${writeSettings(appFence(cfg, app, mode), cfg.paths.state)}\n`);
}

const self = fileURLToPath(import.meta.url);
let invoked = false;
try {
  invoked = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(self);
} catch { /* imported */ }
if (invoked) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`app-exec: ${String((err && err.message) || err).split("\n")[0]}\n`);
    process.exit(REFUSED_EXIT);
  }
}
