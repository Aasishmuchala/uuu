// App Studio's manifest reader (PLAN-V5 K17): every rule of app.json once, the trust rule,
// two apps on one port, the folders listed, and where an app's files and sockets live.
// Temp folders only (short ones in /private/tmp, so a socket path fits); the repo's own Render to Film manifest is read, never changed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../lib/config.mjs";
import { MAX_APPS, TOO_LONG, appPaths, readManifests } from "../manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOD = Object.freeze({
  version: 1, slug: "demo", name: "Demo", about: "A made-up app for the tests.", port: 3171,
  entry: ".build/index.mjs", client: "dist", engine: ["generate", "relay"], tools: ["ffmpeg", "ffprobe"],
  icon: "icon.svg", memoryMb: 2048,
});

const roots = [];
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function cfgAt(root) {
  return {
    paths: {
      state: join(root, "state"), appsCode: join(root, "apps"), apps: join(root, "state", "apps"),
      appsRun: join(root, "state", "run", "apps"), appsLogs: join(root, "state", "logs", "apps"),
    },
    appPorts: { first: 3171, last: 3189 },
  };
}

// A temp apps folder holding one app per entry of `apps` ({ slug, manifest, ... }).
function world(apps) {
  const root = realpathSync(mkdtempSync("/private/tmp/uuu-am-"));
  roots.push(root);
  mkdirSync(join(root, "apps"));
  for (const a of apps) addApp(root, a);
  return { root, cfg: cfgAt(root) };
}
function addApp(root, { slug = "demo", manifest = GOOD, text, icon = "icon.svg", iconBytes = 200, ready = false, mode = 0o644 }) {
  const folder = join(root, "apps", slug);
  mkdirSync(folder, { recursive: true });
  const body = text !== undefined ? text : JSON.stringify(typeof manifest === "function" ? manifest({ ...GOOD, slug }) : { ...manifest, slug: manifest.slug === "demo" ? slug : manifest.slug });
  if (body !== null) {
    writeFileSync(join(folder, "app.json"), body);
    chmodSync(join(folder, "app.json"), mode);
  }
  if (icon) writeFileSync(join(folder, icon), Buffer.alloc(iconBytes, 0x20));
  if (ready) writeFileSync(join(folder, "READY"), "");
  return folder;
}
const only = (cfg) => {
  const list = readManifests(cfg);
  assert.equal(list.length, 1, JSON.stringify(list));
  return list[0];
};
const problemOf = (patch) => {
  const { cfg } = world([{ manifest: (m) => ({ ...m, ...patch }) }]);
  const e = only(cfg);
  assert.equal(e.ok, false, `expected a damaged app for ${JSON.stringify(patch)}`);
  assert.equal(e.slug, "demo");
  return e.problem;
};

test("a good manifest is read whole, and an app without READY is not installed", () => {
  const { cfg } = world([{}]);
  assert.deepEqual(only(cfg), { ok: true, app: { ...GOOD }, installed: false });
});

test("READY as a regular file makes the app installed; a link or a folder named READY does not", () => {
  const { root, cfg } = world([{ ready: true }]);
  assert.equal(only(cfg).installed, true);
  const folder = join(root, "apps", "demo");
  rmSync(join(folder, "READY"));
  writeFileSync(join(root, "elsewhere"), "");
  symlinkSync(join(root, "elsewhere"), join(folder, "READY"));
  assert.equal(only(cfg).installed, false);
  rmSync(join(folder, "READY"));
  mkdirSync(join(folder, "READY"));
  assert.equal(only(cfg).installed, false);
});

// Each field wrong once: [what, patch, problem].
const VECTORS = [
  ["version 2", { version: 2 }, "bad_version"],
  ["version as text", { version: "1" }, "bad_version"],
  ["a slug other than the folder's", { slug: "other" }, "bad_slug"],
  ["an empty name", { name: "" }, "bad_name"],
  ["a name of 41 characters", { name: "n".repeat(41) }, "bad_name"],
  ["a name on two lines", { name: "Two\nlines" }, "bad_name"],
  ["about of 121 characters", { about: "a".repeat(121) }, "bad_about"],
  ["about with a control character", { about: "Bell\u0007" }, "bad_about"],
  ["port 3170 (the host's own)", { port: 3170 }, "bad_port"],
  ["port 3190", { port: 3190 }, "bad_port"],
  ["a port that is not whole", { port: 3171.5 }, "bad_port"],
  ["a port as text", { port: "3171" }, "bad_port"],
  ["entry with a .. segment", { entry: "../outside.mjs" }, "bad_entry"],
  ["entry with .. inside", { entry: ".build/../../x.mjs" }, "bad_entry"],
  ["an absolute entry", { entry: "/tmp/x.mjs" }, "bad_entry"],
  ["an entry with a space", { entry: "my app.mjs" }, "bad_entry"],
  ["an entry read as an option", { entry: "--inspect" }, "bad_entry"],
  ["an entry over 80 characters", { entry: `${"e".repeat(81)}` }, "bad_entry"],
  ["client with a .. segment", { client: "../dist" }, "bad_client"],
  ["engine naming the web door", { engine: ["generate", "web"] }, "bad_engine"],
  ["engine named twice", { engine: ["relay", "relay"] }, "bad_engine"],
  ["engine as text", { engine: "generate" }, "bad_engine"],
  ["a tool that is not ffmpeg or ffprobe", { tools: ["ffmpeg", "curl"] }, "bad_tools"],
  ["an icon that is not svg or png", { icon: "icon.gif" }, "bad_icon"],
  ["an icon outside the folder", { icon: "../icon.svg" }, "bad_icon"],
  ["an icon that is not there", { icon: "missing.png" }, "bad_icon"],
  ["memory under 256", { memoryMb: 128 }, "bad_memoryMb"],
  ["memory over 4096", { memoryMb: 5000 }, "bad_memoryMb"],
];
for (const [what, patch, problem] of VECTORS) {
  test(`damaged: ${what} → ${problem}`, () => {
    assert.equal(problemOf(patch), problem);
  });
}

test("every key is required and no other key is allowed", () => {
  const { cfg } = world([{ manifest: (m) => { const c = { ...m }; delete c.memoryMb; return c; } }]);
  assert.equal(only(cfg).problem, "manifest_keys");
  assert.equal(problemOf({ extra: true }), "manifest_keys");
});

test("app.json that is not one JSON object, or missing", () => {
  assert.equal(only(world([{ text: "{ not json" }]).cfg).problem, "manifest_not_json");
  assert.equal(only(world([{ text: "[1, 2]" }]).cfg).problem, "manifest_not_json");
  assert.equal(only(world([{ text: null }]).cfg).problem, "manifest_missing");
});

test("app.json by the trust rule: a link, a file others may change, or 20 KB is never read", () => {
  const linked = world([{ text: null }]);
  writeFileSync(join(linked.root, "real.json"), JSON.stringify(GOOD));
  symlinkSync(join(linked.root, "real.json"), join(linked.root, "apps", "demo", "app.json"));
  assert.equal(only(linked.cfg).problem, "manifest_untrusted");
  assert.equal(only(world([{ mode: 0o664 }]).cfg).problem, "manifest_untrusted");
  const big = JSON.stringify({ ...GOOD, about: "x" }).replace("}", `${" ".repeat(20 * 1024)}}`);
  assert.equal(only(world([{ text: big }]).cfg).problem, "manifest_too_big");
});

test("the icon: a link, or 300 KB, makes the app damaged; 256 KB is fine", () => {
  const { root, cfg } = world([{ icon: null }]);
  writeFileSync(join(root, "elsewhere.svg"), "<svg/>");
  symlinkSync(join(root, "elsewhere.svg"), join(root, "apps", "demo", "icon.svg"));
  assert.equal(only(cfg).problem, "bad_icon");
  assert.equal(only(world([{ iconBytes: 300 * 1024 }]).cfg).problem, "bad_icon");
  assert.equal(only(world([{ iconBytes: 256 * 1024 }]).cfg).ok, true);
});

test("two apps on one port are both damaged; an app on another port stays good", () => {
  const { cfg } = world([
    { slug: "aa", manifest: (m) => ({ ...m, port: 3175 }) },
    { slug: "bb", manifest: (m) => ({ ...m, port: 3175 }) },
    { slug: "cc", manifest: (m) => ({ ...m, port: 3176 }) },
  ]);
  const list = readManifests(cfg);
  assert.deepEqual(list.map((e) => [e.ok ? e.app.slug : e.slug, e.ok ? "good" : e.problem]),
    [["aa", "port_shared"], ["bb", "port_shared"], ["cc", "good"]]);
});

test("only folders named by the slug rule are apps, sorted, at most 20; an app folder that is a link is damaged", () => {
  const { root, cfg } = world([]);
  for (let i = 0; i < 22; i += 1) {
    addApp(root, { slug: `app${String(i).padStart(2, "0")}`, manifest: (m) => ({ ...m, port: 3171 + (i % 19) }) });
  }
  mkdirSync(join(root, "apps", "Upper"));
  mkdirSync(join(root, "apps", "_hidden"));
  writeFileSync(join(root, "apps", "README.md"), "not an app");
  writeFileSync(join(root, "apps", "plainfile"), "not an app");
  const list = readManifests(cfg);
  assert.equal(list.length, MAX_APPS);
  assert.deepEqual(list.map((e) => (e.ok ? e.app.slug : e.slug)), Array.from({ length: 20 }, (_, i) => `app${String(i).padStart(2, "0")}`));

  const linked = world([]);
  mkdirSync(join(linked.root, "real-folder"));
  symlinkSync(join(linked.root, "real-folder"), join(linked.root, "apps", "sneaky"));
  assert.deepEqual(readManifests(linked.cfg), [{ ok: false, slug: "sneaky", problem: "folder_link" }]);
});

test("no apps folder: no apps", () => {
  const root = realpathSync(mkdtempSync("/private/tmp/uuu-am-"));
  roots.push(root);
  assert.deepEqual(readManifests(cfgAt(root)), []);
});

test("appPaths: each folder and socket of an app, under the config's real folders", () => {
  const { root, cfg } = world([{}]);
  const s = join(root, "state");
  assert.deepEqual(appPaths(cfg, "demo"), {
    code: join(root, "apps", "demo"),
    deps: join(s, "apps", "demo", "deps"),
    store: join(s, "apps", "demo", "store"),
    data: join(s, "apps", "demo", "data"),
    tmp: join(s, "apps", "demo", "tmp"),
    home: join(s, "apps", "demo", "home"),
    run: join(s, "run", "apps", "demo"),
    appSock: join(s, "run", "apps", "demo", "app.sock"),
    engineSock: join(s, "run", "apps", "demo", "engine.sock"),
    log: join(s, "logs", "apps", "demo.log"),
  });
  assert.throws(() => appPaths(cfg, "../demo"), /no app by that name/);
  assert.throws(() => appPaths(cfg, "Demo"), /no app by that name/);
});

test("appPaths: a socket path of 104 bytes or more is refused (macOS keeps 103 and the ending zero)", () => {
  // "/private/tmp/" + n + "/ab/engine.sock": 28 + n bytes.
  const at = (n) => ({ paths: { ...cfgAt("/private/tmp").paths, appsRun: `/private/tmp/${"r".repeat(n)}` } });
  assert.equal(Buffer.byteLength(appPaths(at(75), "ab").engineSock), 103);
  assert.throws(() => appPaths(at(76), "ab"), { message: TOO_LONG });
  assert.equal(TOO_LONG, "This app's folder path is too long for this Mac.");
});

test("the repo's own Render to Film manifest is good, on port 3171", { skip: existsSync(join(HERE, "..", "..", "..", "apps", "render-to-film", "app.json")) ? false : "no apps/render-to-film in this checkout" }, () => {
  const cfg = loadConfig({ path: join(HERE, "..", "..", "config.json") });
  const rtf = readManifests(cfg).find((e) => e.ok && e.app.slug === "render-to-film");
  assert.ok(rtf, "render-to-film is listed and good");
  assert.equal(rtf.app.port, 3171);
  assert.deepEqual(rtf.app.engine, ["generate", "relay"]);
});
