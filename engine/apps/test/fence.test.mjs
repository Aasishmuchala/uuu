// The app fence's settings (PLAN-V5 K18), mode by mode, against settings written out here
// line by line; the spellings of the program-config names; the file they are written to.
// What the sandbox tool then does with them is proved in app-exec.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import {
  CONFIG_NAMES, MODES, REGISTRY, SYSTEM_READS, TOOL_READS, anyCase, appFence, configDenies, ownerHome, writeSettings,
} from "../fence.mjs";

const ROOT = realpathSync(mkdtempSync("/private/tmp/uuu-af-"));
test.after(() => rmSync(ROOT, { recursive: true, force: true }));
const HOME = realpathSync(userInfo().homedir);
const UID = process.getuid();
const NODE24 = realpathSync(join(HOME, ".nvm", "versions", "node", "v24.13.0"));
const S = join(ROOT, "state");
const CODE = join(ROOT, "apps", "demo");
const A = join(S, "apps", "demo");
const RUN = join(S, "run", "apps", "demo");
mkdirSync(CODE, { recursive: true });
mkdirSync(A, { recursive: true });
const CFG = {
  node24: NODE24,
  paths: {
    state: S, appsCode: join(ROOT, "apps"), apps: join(S, "apps"),
    appsRun: join(S, "run", "apps"), appsLogs: join(S, "logs", "apps"),
  },
  appPorts: { first: 3171, last: 3189 },
};
const APP = { slug: "demo" };

// K18's table, written out. denyWrite here holds only the lines that are not program-config
// names; those are checked apart (count, roots and samples) below.
const DENY_READ = ["/", HOME, "/private/tmp", "/private/tmp/claude", `/private/tmp/claude-${UID}`, "/private/var/folders",
  "/tmp", "/tmp/claude", `/tmp/claude-${UID}`, "/var/folders"].sort();
// What every mode reads of the system, the disk being denied as a whole (T85), written out.
const SYSTEM = ["/System", "/bin", "/dev", "/etc", "/private/etc/localtime", "/private/var/db/timezone", "/private/var/select/sh",
  "/sbin", "/usr/bin", "/usr/lib", "/usr/libexec", "/usr/sbin", "/usr/share", "/var"];
const DENY_WRITE = [join(CODE, "READY"), join(CODE, "app.json"), "/private/tmp/claude", "/tmp/claude"].sort();
const FIXTURE = {
  run: {
    filesystem: {
      denyRead: DENY_READ,
      allowRead: [NODE24, CODE, join(A, "data"), join(A, "deps"), join(A, "home"), join(A, "tmp"), RUN, ...SYSTEM].sort(),
      allowWrite: [join(A, "data"), join(A, "home"), join(A, "tmp"), RUN].sort(),
      denyWrite: DENY_WRITE,
    },
    network: { allowedDomains: [], deniedDomains: [], allowUnixSockets: [RUN] },
  },
  build: {
    filesystem: {
      denyRead: DENY_READ,
      allowRead: [NODE24, CODE, join(A, "deps"), join(A, "home"), join(A, "tmp"), ...SYSTEM].sort(),
      allowWrite: [join(CODE, ".build"), join(CODE, "dist"), join(A, "home"), join(A, "tmp")].sort(),
      denyWrite: DENY_WRITE,
    },
    network: { allowedDomains: [], deniedDomains: [], allowUnixSockets: [] },
  },
  test: {
    filesystem: {
      denyRead: DENY_READ,
      allowRead: [NODE24, CODE, join(A, "deps"), join(A, "home"), join(A, "tmp"), ...SYSTEM].sort(),
      allowWrite: [join(A, "home"), join(A, "tmp")].sort(),
      denyWrite: DENY_WRITE,
    },
    network: { allowedDomains: [], deniedDomains: [], allowUnixSockets: [] },
  },
  install: {
    filesystem: {
      denyRead: DENY_READ,
      allowRead: [NODE24, join(A, "deps"), join(A, "home"), join(A, "store"), join(A, "tmp"), ...SYSTEM].sort(),
      allowWrite: [join(A, "deps"), join(A, "home"), join(A, "store"), join(A, "tmp")].sort(),
      denyWrite: DENY_WRITE,
    },
    network: { allowedDomains: ["registry.npmjs.org"], deniedDomains: [], allowUnixSockets: [] },
  },
};
const isConfigLine = (s) => /[[\u017f\u212a]/.test(s);
function split(settings) {
  const fs = settings.filesystem;
  return {
    plain: { ...settings, filesystem: { ...fs, denyWrite: fs.denyWrite.filter((s) => !isConfigLine(s)) } },
    config: fs.denyWrite.filter(isConfigLine),
  };
}

for (const mode of MODES) {
  test(`${mode}: the settings are K18's, line by line`, () => {
    const { plain } = split(appFence(CFG, APP, mode));
    assert.deepEqual(plain, FIXTURE[mode]);
  });

  test(`${mode}: the program-config names are denied at every writable root, in every spelling`, () => {
    const s = appFence(CFG, APP, mode);
    const { config } = split(s);
    const roots = FIXTURE[mode].filesystem.allowWrite;
    // 12 spellings of the 8 names, four lines each, for each root.
    assert.equal(config.length, 48 * roots.length);
    assert.deepEqual(config, [...configDenies(roots)].sort());
    for (const r of roots) assert.equal(config.filter((l) => l.startsWith(`${r}/`)).length, 48, r);
    const w = roots[roots.length - 1];
    for (const line of [`${w}/[Cc][Ll][Aa][Uu][Dd][Ee].[Mm][Dd]`, `${w}/**/.[Cc][Ll][Aa][Uu][Dd][Ee]/**`,
      `${w}/**/[Aa][Gg][Ee][Nn][Tt]\u017f.[Mm][Dd]`, `${w}/.[Mm][Cc][Pp].[Jj]\u017f[Oo][Nn]`,
      `${w}/**/.[Cc][Oo][Dd][Ee][Xx]/**`, `${w}/[Aa][Gg][Ee][Nn][Tt][Ss].[Oo][Vv][Ee][Rr][Rr][Ii][Dd][Ee].[Mm][Dd]`]) {
      assert.ok(config.includes(line), line);
    }
  });
}

test("no mode ever has allowLocalBinding or allowAllUnixSockets, and every list is sorted", () => {
  for (const mode of MODES) {
    const s = appFence(CFG, APP, mode);
    assert.equal("allowLocalBinding" in s.network, false, mode);
    assert.equal("allowAllUnixSockets" in s.network, false, mode);
    assert.doesNotMatch(JSON.stringify(s), /allowLocalBinding|allowAllUnixSockets|strictAllowlist/);
    for (const list of [...Object.values(s.filesystem), ...Object.values(s.network)]) {
      assert.deepEqual(list, [...list].sort(), mode);
    }
    assert.deepEqual(Object.keys(s.filesystem), ["denyRead", "allowRead", "allowWrite", "denyWrite"]);
    assert.deepEqual(Object.keys(s.network), ["allowedDomains", "deniedDomains", "allowUnixSockets"]);
  }
  assert.equal(REGISTRY, "registry.npmjs.org");
});

test("only the install reaches a host, only the registry; only the run reaches a socket, only its own folder", () => {
  for (const mode of MODES) {
    const n = appFence(CFG, APP, mode).network;
    assert.deepEqual(n.allowedDomains, mode === "install" ? ["registry.npmjs.org"] : []);
    assert.deepEqual(n.allowUnixSockets, mode === "run" ? [RUN] : []);
  }
});

// T85: /Volumes and /Users/Shared were readable, and with them every disk, other users' homes
// and Homebrew's databases. The disk is denied as a whole; only the app's own folders, Node and
// SYSTEM_READS (plus its tools' folders) are opened again, and nothing of these lies in those.
const OUTSIDE = ["/Volumes", "/Volumes/Macintosh HD", "/Users", "/Users/Shared", "/Users/Guest", "/Library", "/Library/Keychains",
  "/Applications", "/usr/local", "/usr/local/etc", "/opt", "/opt/homebrew", "/opt/homebrew/var", "/opt/homebrew/etc",
  "/private", "/private/etc", "/private/etc/hosts", "/private/var", "/private/var/db", "/private/var/root", "/cores"];
const opens = (list, p) => list.some((r) => p === r || p.startsWith(`${r}/`));
for (const mode of MODES) {
  test(`${mode}: the whole disk is denied; nothing outside the home folder is opened but the system's own folders`, () => {
    const fs = appFence(CFG, { ...APP, tools: ["ffmpeg", "ffprobe"] }, mode).filesystem;
    assert.ok(fs.denyRead.includes("/"));
    for (const p of OUTSIDE) assert.equal(opens(fs.allowRead, p), false, p);
    for (const p of OUTSIDE) assert.equal(opens(fs.allowWrite, p), false, p);
    // What a program needs is opened again.
    for (const p of ["/usr/lib/libSystem.B.dylib", "/System/Library", "/bin/sh", "/dev/null", "/private/var/db/timezone/zoneinfo",
      NODE24, "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/Cellar/ffmpeg"]) {
      assert.equal(opens(fs.allowRead, p), true, p);
    }
  });
}

test("ffmpeg's and ffprobe's folders are opened only to an app whose manifest names them", () => {
  const without = appFence(CFG, APP, "run").filesystem.allowRead;
  assert.equal(without.some((p) => p.startsWith("/opt")), false);
  const one = appFence(CFG, { ...APP, tools: ["ffprobe"] }, "run").filesystem.allowRead;
  assert.deepEqual(one.filter((p) => p.startsWith("/opt")), ["/opt/homebrew/Cellar", "/opt/homebrew/bin/ffprobe", "/opt/homebrew/opt"]);
  const odd = appFence(CFG, { ...APP, tools: ["constructor", "__proto__", "bash"] }, "run").filesystem.allowRead;
  assert.equal(odd.some((p) => p.startsWith("/opt")), false);
  assert.deepEqual([...SYSTEM_READS].sort(), SYSTEM);
  assert.deepEqual(Object.keys(TOOL_READS), ["ffmpeg", "ffprobe"]);
});

test("pure: the environment changes nothing, and the same call gives the same settings", () => {
  const before = appFence(CFG, APP, "run");
  const saved = { HOME: process.env.HOME, ENGINE_CONFIG: process.env.ENGINE_CONFIG, TMPDIR: process.env.TMPDIR };
  try {
    process.env.HOME = "/private/tmp";
    process.env.ENGINE_CONFIG = "/nowhere/config.json";
    process.env.TMPDIR = "/private/tmp/elsewhere";
    assert.deepEqual(appFence(CFG, APP, "run"), before);
    assert.equal(ownerHome(), HOME);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("an unknown mode, a missing app or a bad slug is refused", () => {
  assert.throws(() => appFence(CFG, APP, "shell"), /no mode shell/);
  assert.throws(() => appFence(CFG, null, "run"), /no app/);
  assert.throws(() => appFence(CFG, { slug: "../x" }, "run"), /no app by that name/);
});

test("a folder that would hold the engine's state or the owner's home is never opened", () => {
  // The state lying inside an app's data folder: opening data would open the state.
  const odd = { ...CFG, paths: { ...CFG.paths, state: join(S, "apps", "demo", "data", "inner") } };
  assert.throws(() => appFence(odd, APP, "run"), /holds folders the fence protects/);
  const wide = { ...CFG, node24: "/" };
  assert.throws(() => appFence(wide, APP, "build"), /holds folders the fence protects/);
});

test("anyCase: each letter as a two-letter set, and s and k once more as the disk folds them", () => {
  assert.deepEqual(anyCase(".codex"), [".[Cc][Oo][Dd][Ee][Xx]"]);
  assert.deepEqual(anyCase("AGENTS.md"), ["[Aa][Gg][Ee][Nn][Tt][Ss].[Mm][Dd]", "[Aa][Gg][Ee][Nn][Tt]\u017f.[Mm][Dd]"]);
  assert.deepEqual(anyCase("ks"), ["[Kk][Ss]", "[Kk]\u017f", "\u212a[Ss]", "\u212a\u017f"]);
  assert.equal(CONFIG_NAMES.reduce((n, name) => n + anyCase(name).length, 0), 12);
  assert.deepEqual(configDenies(["/r"]).slice(0, 4),
    ["/r/.[Cc][Ll][Aa][Uu][Dd][Ee]", "/r/.[Cc][Ll][Aa][Uu][Dd][Ee]/**", "/r/**/.[Cc][Ll][Aa][Uu][Dd][Ee]", "/r/**/.[Cc][Ll][Aa][Uu][Dd][Ee]/**"]);
});

test("writeSettings: named after the content under <state>/fences, 0644, reused only when the same", () => {
  const state = join(ROOT, "ws");
  const settings = appFence(CFG, APP, "test");
  const path = writeSettings(settings, state);
  assert.match(path, new RegExp(`^${join(state, "fences")}/[0-9a-f]{20}\\.json$`));
  assert.equal(statSync(path).mode & 0o777, 0o644);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), settings);
  const ino = statSync(path).ino;
  assert.equal(writeSettings(settings, state), path);
  assert.equal(statSync(path).ino, ino, "an identical file is used as it is");
  // A file changed on disk is replaced; a link in its place is replaced by a file, its target untouched.
  writeFileSync(path, "{}");
  writeSettings(settings, state);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), settings);
  const target = join(ROOT, "target.json");
  writeFileSync(target, JSON.stringify(settings, null, 1));
  rmSync(path);
  symlinkSync(target, path);
  writeSettings(settings, state);
  assert.equal(lstatSync(path).isSymbolicLink(), false);
  assert.equal(readFileSync(target, "utf8"), JSON.stringify(settings, null, 1));
  // Another mode's settings get a file of their own.
  assert.notEqual(writeSettings(appFence(CFG, APP, "run"), state), path);
});
