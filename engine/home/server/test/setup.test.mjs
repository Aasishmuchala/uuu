// GET /api/setup, version 2, and its two display writes (PLAN-ONBOARD T1 and S1). The setup only looks: no secret is
// opened, no switch or key is written, and the board and the books see only reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchSeed, boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { saveSwitch } from "../lib/apps.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { notConnected } from "../lib/health.mjs";
import { freshState, writeState } from "../lib/models.mjs";
import { COMMANDS, forgetBooks, GROUPS, LATER_IDS, LEADS, NOT_YET_IDS, START_IDS, WORDS } from "../lib/setup.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call, writes } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const seen = { board: [], bench: [] }; // every non-GET request either stub saw, over the whole file

async function withHome(fn, options = {}) {
  forgetBooks();
  const h = await startV2({ routes: ["setup"], inbox: [], search: [], port: 0, ...options });
  try {
    return await fn(h);
  } finally {
    seen.board.push(...writes(h.board));
    seen.bench.push(...h.bench.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`));
    await h.close();
  }
}

const get = async (h) => {
  const r = await call(h.url, "GET", "/api/setup");
  assert.equal(r.status, 200);
  return r;
};
const stepOf = (json, id) => json.steps.find((s) => s.id === id);
const step = async (h, id) => stepOf((await get(h)).json, id);
const docs = (h) => h.config.paths.knowledgeDocs;
const FILLED = "This basic is filled in for the setup test, with more than forty bytes of words.\n";
const PLANS_IDS = ["models", "proof", "basics", "brand", "books", "task", "checker-login", "routines", "web", "viewer", "generation", "higgsfield", "apps", "brain"];

function clearBasics(h) {
  for (const b of BASICS) rmSync(join(docs(h), b.file), { force: true });
}
function fillBasics(h, n) {
  for (const b of BASICS.slice(0, n)) {
    mkdirSync(dirname(join(docs(h), b.file)), { recursive: true });
    writeFileSync(join(docs(h), b.file), FILLED);
  }
}

// The Models state in provider mode, written without the key scrub so even the test never opens the key file.
function providerMode(h, keyState = "ok") {
  const noKey = { ...h.config, paths: { ...h.config.paths, providerKey: join(h.state, "no-such-key") } };
  const s = freshState();
  s.mode = "provider";
  s.key = { savedAt: "2026-11-18T09:00:00.000Z", state: keyState, checkedAt: "2026-11-18T09:00:00.000Z" };
  writeState(noKey, s);
}

// The two logins as files: `checker` is "own" (a plain file in the state), "shared" (a link outside it) or "none".
function setLogins(h, { agent = true, checker = "own" } = {}) {
  const env = join(h.state, "agent.env");
  const auth = join(h.state, "codex-home", "auth.json");
  rmSync(env, { force: true });
  rmSync(auth, { force: true });
  if (agent) writeFileSync(env, "made up\n", { mode: 0o600 });
  if (checker === "none") return;
  mkdirSync(dirname(auth), { recursive: true, mode: 0o700 });
  if (checker === "own") writeFileSync(auth, "{}\n", { mode: 0o600 });
  else {
    const outside = join(dirname(h.state), "owner-codex-auth.json");
    writeFileSync(outside, "{}\n", { mode: 0o600 });
    symlinkSync(outside, auth);
  }
}

// The door's status file as the door writes it.
function writeStatus(h, status) {
  mkdirSync(dirname(h.config.paths.generateStatus), { recursive: true, mode: 0o700 });
  writeFileSync(h.config.paths.generateStatus, JSON.stringify(status), { mode: 0o600 });
}

// A folder of made-up apps for App Studio; the home reads it from config.paths.appsCode.
function makeApps(h, slugs) {
  const root = mkdtempSync(join(tmpdir(), "uuu-setup-apps-"));
  slugs.forEach((slug, i) => {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), JSON.stringify({
      version: 1, slug, name: `App ${slug}`, about: "An app.", port: 3171 + i, entry: ".build/index.mjs", client: "dist",
      engine: ["relay"], tools: [], icon: "icon.svg", memoryMb: 512,
    }), { mode: 0o644 });
    writeFileSync(join(dir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>\n', { mode: 0o644 });
    writeFileSync(join(dir, "READY"), "ready\n");
  });
  h.config.paths.appsCode = root;
  return root;
}

// The files under a folder as path -> "size:mtime:ino", by lstat only (nothing is opened).
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(p.slice(root.length + 1), `${st.size}:${st.mtimeMs}:${st.ino}`);
    }
  };
  walk(root);
  return out;
}
function changed(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

const emptyBoard = () => {
  const s = boardSeedV2();
  s.issues = [];
  return s;
};
const routinesAs = (statuses, seed = boardSeedV2()) => {
  seed.routines = seed.routines.slice(0, statuses.length).map((r, i) => ({ ...r, status: statuses[i] }));
  return seed;
};

// 1
test("a fresh stub home: the answer fits its shape, the three groups and every step in order, six counted", async () => {
  await withHome(async (h) => {
    const r = await get(h);
    assert.deepEqual(sameShape(readShape("setup"), r.json), []);
    assert.deepEqual(Object.keys(r.json), ["open", "show", "dismissed", "finished", "mode", "counts", "later", "groups", "steps", "notYet", "generatedAt"]);
    assert.equal(r.json.switches, undefined);
    assert.equal(r.json.mode, "plans");
    assert.deepEqual(r.json.steps.map((s) => s.id), PLANS_IDS);
    assert.deepEqual(r.json.steps.map((s) => s.id), [...START_IDS, ...LATER_IDS]);
    assert.deepEqual(r.json.steps.map((s) => s.group), [...Array(6).fill("start"), ...Array(8).fill("later")]);
    assert.equal(r.json.counts.total, 6);
    assert.equal(r.json.later.total, 8);
    assert.deepEqual(r.json.groups, [
      { id: "start", title: "Needed to start", say: "Do these and the engine can do real work for you." },
      { id: "later", title: "When you want it", say: "Each of these is off until you choose it. Each line says what it opens up and what it costs or sends off this Mac." },
      { id: "notyet", title: "Not possible yet", say: "These cannot be set up yet. Nothing can be published or sent from here until they exist." },
    ]);
    assert.deepEqual(r.json.groups, GROUPS);
    assert.deepEqual(r.json.steps.map((s) => s.canSkip), [false, false, true, true, true, false, ...Array(8).fill(false)]);
    for (const s of r.json.steps) {
      assert.deepEqual(Object.keys(s), ["id", "title", "group", "state", "canSkip", "skipped", "line", "why", "opens", "costs", "notes", "links", "commands", "facts"]);
      assert.equal(s.title, WORDS[s.id].title);
      for (const l of s.links) assert.match(l.href, /^#\//);
      for (const c of s.commands) assert.ok(Object.values(COMMANDS).includes(c.command));
      if (s.group === "start") {
        assert.equal(s.why, WORDS[s.id].why);
        assert.equal(s.opens, null);
        assert.deepEqual(s.costs, []);
      } else {
        assert.equal(s.canSkip, false);
        assert.equal(s.skipped, false);
        assert.equal(s.why, null);
        assert.equal(s.opens, WORDS[s.id].opens);
        assert.deepEqual(s.costs, WORDS[s.id].costs);
      }
    }
    // Every door is off in a fresh home.
    assert.equal(stepOf(r.json, "web").line, "Off. No agent can reach the internet.");
    assert.equal(stepOf(r.json, "viewer").line, "Off. A page job stops until it is switched on.");
    assert.equal(r.json.dismissed, false);
    assert.equal(r.json.finished, false);
    assert.equal(r.json.show, true);
  });
});

test("order: provider mode leaves out the Checker's own login", async () => {
  await withHome(async (h) => {
    providerMode(h);
    const r = (await get(h)).json;
    assert.equal(r.mode, "provider");
    assert.deepEqual(r.steps.map((s) => s.id), PLANS_IDS.filter((id) => id !== "checker-login"));
    assert.equal(r.later.total, 7);
    assert.equal(r.counts.total, 6);
  });
});

// 2
test("basics: none, two and all nine filled", async () => {
  await withHome(async (h) => {
    clearBasics(h);
    let b = await step(h, "basics");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "0 of 9 basics filled.");
    assert.deepEqual(b.notes, []);
    assert.deepEqual(b.facts, { filled: 0, total: 9, missing: BASICS.map((x) => x.title) });
    assert.deepEqual(b.links, [{ label: "Open Files", href: "#/files" }]);

    fillBasics(h, 2);
    b = await step(h, "basics");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "2 of 9 basics filled.");
    assert.deepEqual(b.notes, ["Still to fill: What we never say, What we sell, Terms, Refunds, Our support promise, Team and Ideal customer."]);
    assert.equal(b.facts.filled, 2);

    fillBasics(h, 8);
    b = await step(h, "basics");
    assert.deepEqual(b.notes, ["Still to fill: Ideal customer."]);

    fillBasics(h, 9);
    b = await step(h, "basics");
    assert.equal(b.state, "done");
    assert.equal(b.line, "All nine basics are filled.");
    assert.deepEqual(b.notes, []);
    assert.deepEqual(b.facts, { filled: 9, total: 9, missing: [] });
  });
});

// 3
test("brand: no kit, a saved kit, a kit that is not JSON", async () => {
  await withHome(async (h) => {
    const kit = join(docs(h), "brand", "kit.json");
    rmSync(kit, { force: true });
    let s = await step(h, "brand");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "No brand kit yet.");
    assert.deepEqual(s.facts, { saved: false });
    assert.deepEqual(s.links, [{ label: "Open the brand kit", href: "#/files/brand-kit" }]);

    mkdirSync(dirname(kit), { recursive: true });
    writeFileSync(kit, JSON.stringify({ name: "Test", colours: [] }));
    s = await step(h, "brand");
    assert.equal(s.state, "done");
    assert.equal(s.line, "Your brand kit is saved.");
    assert.deepEqual(s.facts, { saved: true });

    writeFileSync(kit, "not json");
    s = await step(h, "brand");
    assert.equal(s.state, "unknown");
    assert.equal(s.line, "The brand kit could not be read. Open it and save it again.");
  });
});

// 4
test("models, plans: the two logins are judged by existence only, never opened, and no shared-login note", async () => {
  await withHome(async (h) => {
    const env = join(h.state, "agent.env");
    const auth = join(h.state, "codex-home", "auth.json");
    const outside = join(dirname(h.state), "owner-codex-auth.json");
    try {
      let m = await step(h, "models");
      assert.equal(m.state, "todo");
      assert.equal(m.line, "Plans mode is on, but the Claude agents have no login of their own yet.");
      assert.deepEqual(m.commands, [{ lead: LEADS.only, command: "engine/fence/login-wizard.sh" }]);
      assert.deepEqual(m.links, [{ label: "Open Settings", href: "#/settings" }]);
      assert.deepEqual(m.facts, { mode: "plans", ready: false });

      setLogins(h, { agent: true, checker: "none" });
      m = await step(h, "models");
      assert.equal(m.state, "todo");
      assert.equal(m.line, "Plans mode is on, but the Checker has no Codex login yet.");
      assert.deepEqual(m.commands, [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/fence/login-wizard.sh codex" }]);

      // A link to a file outside the state: ready, and the shared login is no longer said here.
      setLogins(h, { agent: true, checker: "shared" });
      m = await step(h, "models");
      assert.equal(m.state, "done");
      assert.equal(m.line, "Plans mode is on and ready: your agents use your Claude and Codex plans.");
      assert.deepEqual(m.notes, []);
      assert.deepEqual(m.commands, []);
      assert.deepEqual(m.facts, { mode: "plans", ready: true });
      const linked = JSON.stringify(m);
      chmodSync(env, 0o000);
      chmodSync(outside, 0o000);
      assert.equal(JSON.stringify(await step(h, "models")), linked);
      chmodSync(env, 0o600);
      chmodSync(outside, 0o600);

      // A plain file inside the state.
      setLogins(h, { agent: true, checker: "own" });
      m = await step(h, "models");
      assert.equal(m.state, "done");
      assert.deepEqual(m.notes, []);
      assert.deepEqual(m.commands, []);
      const own = JSON.stringify(m);
      chmodSync(env, 0o000);
      chmodSync(auth, 0o000);
      assert.equal(JSON.stringify(await step(h, "models")), own);
    } finally {
      for (const f of [env, auth, outside]) { try { chmodSync(f, 0o600); } catch { /* not there */ } }
    }
  });
});

// 5
test("models, provider: the saved test result gives the line, and the key is never opened or sent", async () => {
  await withHome(async (h) => {
    const p = h.config.paths;
    providerMode(h, "ok");
    let m = await step(h, "models");
    assert.equal(m.state, "todo");
    assert.equal(m.line, "Omega Plus is on, but no key is saved. Open Settings.");
    assert.deepEqual(m.facts, { mode: "provider", ready: false });

    mkdirSync(p.providerSecrets, { recursive: true, mode: 0o700 });
    writeFileSync(p.providerKey, "sk-SECRET-MARKER-123\n", { mode: 0o600 });
    chmodSync(p.providerKey, 0o000);
    const keyBefore = lstatSync(p.providerKey);
    try {
      const cases = [
        ["ok", "done", "Omega Plus is on and ready: the key is saved and its last test passed."],
        ["refused", "todo", "Omega Plus is on, but it refused the key. Open Settings."],
        ["unknown", "todo", "Omega Plus is on, but the key has not been tested. Open Settings and press Test."],
      ];
      for (const [keyState, state, line] of cases) {
        providerMode(h, keyState);
        const bytes = readFileSync(p.modelsState);
        for (let i = 0; i < 3; i += 1) {
          const r = await get(h);
          assert.ok(!r.text.includes("SECRET-MARKER"));
          assert.equal(r.json.mode, "provider");
          m = stepOf(r.json, "models");
          assert.equal(m.state, state);
          assert.equal(m.line, line);
          assert.deepEqual(m.facts, { mode: "provider", ready: state === "done" });
          assert.deepEqual(m.commands, []);
        }
        assert.deepEqual(readFileSync(p.modelsState), bytes);
      }
      const keyAfter = lstatSync(p.providerKey);
      assert.equal(keyAfter.mode, keyBefore.mode);
      assert.equal(keyAfter.mtimeMs, keyBefore.mtimeMs);
    } finally {
      chmodSync(p.providerKey, 0o600);
    }
  });
});

// proof (S1 case 2)
test("the fence check: none yet, held, held with something to do, failed", async () => {
  await withHome(async (h) => {
    const file = h.config.paths.proofLast;
    rmSync(file, { force: true });
    let s = await step(h, "proof");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "The fence has not been checked yet. Run the proof to check it.");
    assert.deepEqual(s.facts, { result: null, at: null });
    assert.deepEqual(s.links, [{ label: "Open Health", href: "#/health" }]);
    assert.deepEqual(s.commands, []);
    assert.equal(s.canSkip, false);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ result: "holds", ranAt: "2026-11-18T09:00:00.000Z" }));
    s = await step(h, "proof");
    assert.equal(s.state, "done");
    assert.equal(s.line, "The fence held at its last check.");
    assert.deepEqual(s.facts, { result: "holds", at: "2026-11-18T09:00:00.000Z" });

    writeFileSync(file, JSON.stringify({ result: "holds-with-todo" }));
    s = await step(h, "proof");
    assert.equal(s.state, "done");
    assert.equal(s.line, "The fence held at its last check, with something still for you to do.");
    assert.deepEqual(s.facts, { result: "holds-with-todo", at: null });

    writeFileSync(file, JSON.stringify({ result: "fails" }));
    s = await step(h, "proof");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "The fence failed its last check. Do not give agents work until it holds again.");
    assert.equal(s.facts.result, "failed");
  });
});

// 6
const COMPANY = { doctype: "Company", name: "Test Company", default_holiday_list: "Holidays 2026" };
const ADDRESS = { doctype: "Address", name: "Test Company-Billing", is_your_company_address: 1, disabled: 0 };
const withDocs = (more) => {
  const s = benchSeed();
  Object.assign(s.docs, more);
  return s;
};

test("books: the default seed, both answers there, the address only", async () => {
  await withHome(async (h) => {
    const b = await step(h, "books");
    // The default seed holds no Company and no Address.
    assert.equal(b.state, "todo");
    assert.deepEqual(b.facts, { connection: "on", company: { address: false, holidays: false } });
  });
  await withHome(async (h) => {
    const b = await step(h, "books");
    assert.equal(b.state, "done");
    assert.equal(b.line, "The books are connected and your company's details are in them.");
    assert.deepEqual(b.links, [{ label: "Open the Books dashboard", href: "#/dashboards/books" }]);
    assert.deepEqual(b.commands, []);
    assert.deepEqual(b.facts, { connection: "on", company: { address: true, holidays: true } });
  }, { benchSeed: withDocs({ Company: [COMPANY], Address: [ADDRESS] }) });
  await withHome(async (h) => {
    const b = await step(h, "books");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "The books are connected. Your company's details are not in them yet.");
    assert.deepEqual(b.notes, [
      "It asks whether the company is registered for GST, the company's address, and the weekly days off and public holidays, then shows it all and saves it in one go.",
      "Until then invoices say \"Nil-Rated\" even where tax is charged, and leave can be drafted but not made final.",
    ]);
    assert.deepEqual(b.commands, [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/books/setup-wizard.sh" }]);
    assert.deepEqual(b.links, [{ label: "Open the Books dashboard", href: "#/dashboards/books" }]);
    assert.deepEqual(b.facts, { connection: "on", company: { address: true, holidays: false } });
    // The reads, as pinned: GETs of Company and Address, and the brain's two DocType questions.
    const reads = () => h.bench.requests.filter((r) => r.path.startsWith("/api/resource/")).map((r) => r.path).sort();
    assert.deepEqual(reads(), ["/api/resource/Address", "/api/resource/Company", "/api/resource/DocType/Contact", "/api/resource/DocType/Project"]);
    // A second answer within 30 seconds asks again only what was not answered (the DocTypes are not in this seed).
    await get(h);
    assert.deepEqual(reads().filter((p) => !p.includes("DocType")), ["/api/resource/Address", "/api/resource/Company"]);
    // The books' ping is asked once per answer, for both the books and the brain.
    assert.equal(h.bench.requests.filter((r) => r.path === "/api/method/ping").length, 2);
  }, { benchSeed: withDocs({ Company: [{ ...COMPANY, default_holiday_list: "" }], Address: [ADDRESS] }) });
});

test("books: not installed, off, and a read that fails", async () => {
  await withHome(async (h) => {
    const b = await step(h, "books");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "The books are not installed on this Mac yet.");
    assert.deepEqual(b.commands, []);
    assert.deepEqual(b.links, [{ label: "Open Health", href: "#/health" }]);
    assert.deepEqual(b.facts, { connection: "not_installed", company: null });
  }, { benchInstalled: false });
  await withHome(async (h) => {
    await h.bench.close();
    const b = await step(h, "books");
    assert.equal(b.state, "unknown");
    assert.equal(b.line, "The books are off, so the setup cannot see what they hold.");
    assert.deepEqual(b.links, [{ label: "Open Health", href: "#/health" }]);
    assert.deepEqual(b.facts, { connection: "off", company: null });
  });
  await withHome(async (h) => {
    const b = await step(h, "books");
    assert.equal(b.state, "unknown");
    assert.equal(b.line, "The books are connected, but they did not answer just now.");
    assert.deepEqual(b.facts, { connection: "on", company: null });
  }, { benchSeed: { ...benchSeed(), missingDoctypes: ["Company"] } });
});

// 7
test("task: no goal, the default seed, a question only, the board off", async () => {
  await withHome(async (h) => {
    const r = await get(h);
    const t = stepOf(r.json, "task");
    assert.equal(t.state, "todo");
    assert.equal(t.line, "No task yet.");
    assert.deepEqual(t.links, [{ label: "Choose a job", href: "#/jobs" }]);
    assert.deepEqual(t.facts, { count: 0 });
    assert.equal(r.json.open, true);
  }, { boardSeed: emptyBoard() });
  await withHome(async (h) => {
    const r = await get(h);
    const t = stepOf(r.json, "task");
    assert.equal(t.state, "done");
    assert.equal(t.line, "Your first task is on the board.");
    assert.deepEqual(t.links, [{ label: "Open Tasks", href: "#/tasks" }]);
    assert.ok(t.facts.count >= 1);
    assert.equal(r.json.open, false);
  });
  const asked = boardSeedV2();
  const goal = asked.issues.find((i) => !i.parentId && i.projectId);
  asked.issues = [goal];
  await withHome(async (h) => {
    const t = await step(h, "task");
    assert.equal(t.state, "todo");
    assert.deepEqual(t.facts, { count: 0 });
  }, { boardSeed: asked, decisions: { [`ask:${goal.id}`]: { at: "2026-11-18T09:00:00.000Z", text: "Do we charge for delivery?" } } });
  await withHome(async (h) => {
    await h.board.close();
    const r = await get(h);
    const t = stepOf(r.json, "task");
    assert.equal(t.state, "unknown");
    assert.equal(t.line, "The board is off, so the setup cannot see your tasks.");
    assert.deepEqual(t.links, [{ label: "Open Health", href: "#/health" }]);
    assert.deepEqual(t.facts, { count: null });
    assert.equal(r.json.open, false);
  });
});

// checker-login (S1 case 3)
test("the Checker's own login: none, a link to the owner's, its own; never opened", async () => {
  await withHome(async (h) => {
    const auth = join(h.state, "codex-home", "auth.json");
    const outside = join(dirname(h.state), "owner-codex-auth.json");
    const codex = [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/fence/login-wizard.sh codex" }];
    try {
      setLogins(h, { agent: false, checker: "none" });
      let s = await step(h, "checker-login");
      assert.equal(s.group, "later");
      assert.equal(s.state, "todo");
      assert.equal(s.line, "The Checker has no Codex login yet.");
      assert.deepEqual(s.commands, codex);
      assert.deepEqual(s.links, []);
      assert.deepEqual(s.facts, { checkerLogin: false, checkerOwnLogin: false });
      assert.equal(s.opens, "The Checker stops depending on your own login, and the proof's note about it goes away.");

      setLogins(h, { agent: false, checker: "shared" });
      s = await step(h, "checker-login");
      assert.equal(s.state, "todo");
      assert.equal(s.line, "The Checker is using your own Codex login for now.");
      assert.deepEqual(s.commands, codex);
      assert.deepEqual(s.facts, { checkerLogin: true, checkerOwnLogin: false });
      const linked = JSON.stringify(s);
      chmodSync(outside, 0o000);
      assert.equal(JSON.stringify(await step(h, "checker-login")), linked);
      chmodSync(outside, 0o600);

      setLogins(h, { agent: false, checker: "own" });
      s = await step(h, "checker-login");
      assert.equal(s.state, "done");
      assert.equal(s.line, "The Checker has its own Codex login.");
      assert.deepEqual(s.commands, []);
      assert.deepEqual(s.facts, { checkerLogin: true, checkerOwnLogin: true });
      const own = JSON.stringify(s);
      chmodSync(auth, 0o000);
      assert.equal(JSON.stringify(await step(h, "checker-login")), own);
    } finally {
      for (const f of [auth, outside]) { try { chmodSync(f, 0o600); } catch { /* not there */ } }
    }
  });
});

// routines (S1 case 4)
test("routines: none on, one of two on, none at all, the board off", async () => {
  await withHome(async (h) => {
    const s = await step(h, "routines");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "No routine is switched on.");
    assert.deepEqual(s.facts, { on: 0, total: 2 });
    assert.deepEqual(s.links, [{ label: "Open Routines", href: "#/routines" }]);
    assert.deepEqual(s.costs, ["Each run costs one run of that agent on your plan."]);
  }, { boardSeed: routinesAs(["paused", "paused"]) });
  await withHome(async (h) => {
    const s = await step(h, "routines");
    assert.equal(s.state, "done");
    assert.equal(s.line, "1 of 2 routines are switched on.");
    assert.deepEqual(s.facts, { on: 1, total: 2 });
    // The board is asked for its routines once per answer, and only by GET.
    assert.equal(h.board.requests.filter((r) => /\/routines$/.test(r.path)).length, 1);
  });
  await withHome(async (h) => {
    const s = await step(h, "routines");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "No routine is set up yet.");
    assert.deepEqual(s.facts, { on: 0, total: 0 });
  }, { boardSeed: routinesAs([]) });
  await withHome(async (h) => {
    await h.board.close();
    const s = await step(h, "routines");
    assert.equal(s.state, "unknown");
    assert.equal(s.line, "The board is off, so the setup cannot see your routines.");
    assert.deepEqual(s.facts, { on: null, total: null });
  });
});

// web and viewer (S1 case 5)
test("the web and the page viewer: off, on, and a switches file that cannot be read", async () => {
  await withHome(async (h) => {
    updateDoors(h.config, (s) => { s.web.on = false; s.viewer.on = false; });
    let r = (await get(h)).json;
    assert.deepEqual([stepOf(r, "web").state, stepOf(r, "web").line], ["todo", "Off. No agent can reach the internet."]);
    assert.deepEqual([stepOf(r, "viewer").state, stepOf(r, "viewer").line], ["todo", "Off. A page job stops until it is switched on."]);
    assert.deepEqual(stepOf(r, "web").facts, { on: false });
    assert.deepEqual(stepOf(r, "web").links, [{ label: "Open Settings", href: "#/settings" }]);
    assert.deepEqual(stepOf(r, "web").costs, ["When this is on, the addresses the Researcher opens and the words it searches for leave this Mac."]);
    assert.deepEqual(stepOf(r, "viewer").costs, ["Chrome has to be installed on this Mac. The viewer never touches your own Chrome or its profile."]);

    updateDoors(h.config, (s) => { s.web.on = true; s.viewer.on = true; });
    r = (await get(h)).json;
    assert.deepEqual([stepOf(r, "web").state, stepOf(r, "web").line], ["done", "On. Only the Researcher can read the web."]);
    assert.deepEqual([stepOf(r, "viewer").state, stepOf(r, "viewer").line], ["done", "On. Only the Builder and the Art director can ask."]);
    assert.equal(r.later.done, 3); // the two doors and the default seed's one active routine

    writeFileSync(h.config.paths.doorsState, "not json", { mode: 0o600 });
    r = (await get(h)).json;
    for (const id of ["web", "viewer", "generation", "higgsfield", "brain"]) {
      assert.equal(stepOf(r, id).state, "unknown", id);
      assert.equal(stepOf(r, id).line, "Its switch could not be read. Open Settings.", id);
    }
  });
});

// generation (S1 case 6)
test("Runway: each way in and switch the table names, the limits, and no secret opened", async () => {
  await withHome(async (h) => {
    const p = h.config.paths;
    const runwayOauth = join(p.doorSecrets, "runway-oauth.json");
    const hfOauth = join(p.doorSecrets, "higgsfield-oauth.json");
    mkdirSync(p.doorSecrets, { recursive: true, mode: 0o700 });
    writeFileSync(runwayOauth, '{"access_token":"tok-SECRETMARKER"}\n', { mode: 0o600 });
    writeFileSync(hfOauth, '{"access_token":"tok-SECRETMARKER"}\n', { mode: 0o600 });
    chmodSync(runwayOauth, 0o000);
    chmodSync(hfOauth, 0o000);
    const before = [lstatSync(runwayOauth), lstatSync(hfOauth)].map((st) => `${st.mode}:${st.mtimeMs}`);
    const setOn = (on) => updateDoors(h.config, (s) => { s.generate.on = on; s.generate.dailyCredits = 300; s.generate.monthlyCredits = 1000; });
    const status = (runway) => {
      if (runway === undefined) rmSync(p.generateStatus, { force: true });
      else writeStatus(h, { higgsfield: { signedIn: false, refused: false }, runway });
    };
    const gen = async () => {
      const r = await get(h);
      assert.ok(!r.text.includes("SECRETMARKER"));
      return stepOf(r.json, "generation");
    };
    const LIMITS = "Most to spend in a day: $3.00. Most to spend in a month: $10.00. A limit of 0 stops all making.";
    const TWO = "There are two ways in: a Runway key, or signing in to your Runway account. Either is enough.";
    try {
      // [key saved, switch on, status runway object, state, line]
      const noKey = [
        [false, undefined, "todo", "No Runway key is saved."],
        [false, { signedIn: false, refused: false }, "todo", "No Runway key is saved and you are not signed in to Runway."],
        [false, { signedIn: true, refused: false }, "todo", "You are signed in to Runway. Generation is off."],
        [false, { signedIn: false, refused: true }, "todo", "Runway asked you to sign in again."],
        [true, undefined, "todo", "Generation is on, but there is no way in to Runway yet."],
        [true, { signedIn: true, refused: false }, "done", "Generation is on."],
        [true, { signedIn: false, refused: true }, "todo", "Runway asked you to sign in again."],
      ];
      for (const [on, runway, state, line] of noKey) {
        setOn(on);
        status(runway);
        const s = await gen();
        assert.deepEqual([s.state, s.line], [state, line], JSON.stringify({ on, runway }));
        assert.deepEqual(s.notes, runway === undefined ? [LIMITS] : [LIMITS, TWO]);
        assert.equal(s.facts.keySaved, false);
        assert.equal(s.facts.signedIn, runway === undefined ? null : runway.signedIn === true && runway.refused !== true);
        assert.deepEqual([s.facts.daily, s.facts.monthly, s.facts.on], [300, 1000, on]);
      }

      mkdirSync(dirname(p.runwayKey), { recursive: true, mode: 0o700 });
      writeFileSync(p.runwayKey, "key_SECRETMARKER\n", { mode: 0o600 });
      chmodSync(p.runwayKey, 0o000);
      const keyBefore = lstatSync(p.runwayKey);
      const withKey = [
        [false, undefined, "todo", "A Runway key is saved. Generation is off."],
        [true, undefined, "done", "Generation is on."],
        [true, { signedIn: false, refused: true }, "done", "Generation is on."],
      ];
      for (const [on, runway, state, line] of withKey) {
        setOn(on);
        status(runway);
        const s = await gen();
        assert.deepEqual([s.state, s.line], [state, line], JSON.stringify({ on, runway }));
        assert.equal(s.facts.keySaved, true);
      }
      const keyAfter = lstatSync(p.runwayKey);
      assert.equal(keyAfter.mode, keyBefore.mode);
      assert.equal(keyAfter.mtimeMs, keyBefore.mtimeMs);
      const s = await gen();
      assert.deepEqual(s.costs, [
        "This costs money beyond your plans. Nothing is spent until you approve a cost.",
        "Runway's terms say it may use what you send to train its models unless you have an Enterprise agreement. Do not use Generation for client work you may not share.",
      ]);
      assert.deepEqual(s.links, [{ label: "Open Settings", href: "#/settings" }]);
      assert.deepEqual([lstatSync(runwayOauth), lstatSync(hfOauth)].map((st) => `${st.mode}:${st.mtimeMs}`), before);
    } finally {
      for (const f of [runwayOauth, hfOauth, p.runwayKey]) { try { chmodSync(f, 0o600); } catch { /* not there */ } }
    }
  });
});

// higgsfield (S1 case 7)
test("Higgsfield: the five rows of its table", async () => {
  await withHome(async (h) => {
    const rows = [
      [false, { signedIn: false, refused: true }, "todo", "Higgsfield asked you to sign in again."],
      [false, { signedIn: false, refused: false }, "todo", "Not signed in. Higgsfield is off."],
      [false, { signedIn: true, refused: false }, "todo", "Signed in. Higgsfield is off."],
      [true, { signedIn: false, refused: false }, "todo", "On, but not signed in."],
      [true, { signedIn: true, refused: false }, "done", "On. Your apps and the Artist may use it, inside what you approve."],
    ];
    for (const [on, higgsfield, state, line] of rows) {
      updateDoors(h.config, (s) => { s.generate.higgsfield.on = on; });
      writeStatus(h, { higgsfield });
      const s = await step(h, "higgsfield");
      assert.deepEqual([s.state, s.line], [state, line], JSON.stringify({ on, higgsfield }));
      assert.deepEqual(s.facts, { on, signedIn: higgsfield.signedIn, refused: higgsfield.refused });
    }
    // No status file: not signed in.
    rmSync(h.config.paths.generateStatus, { force: true });
    updateDoors(h.config, (s) => { s.generate.higgsfield.on = false; });
    assert.equal((await step(h, "higgsfield")).line, "Not signed in. Higgsfield is off.");
  });
});

// apps (S1 case 8)
test("App Studio: no app, none on, one on with no allowance", async () => {
  await withHome(async (h) => {
    const empty = mkdtempSync(join(tmpdir(), "uuu-setup-noapps-"));
    const made = [];
    try {
      h.config.paths.appsCode = empty;
      let s = await step(h, "apps");
      assert.equal(s.state, "todo");
      assert.equal(s.line, "There is no app yet.");
      assert.deepEqual(s.facts, { apps: 0, on: 0 });
      assert.deepEqual(s.links, [{ label: "Open App Studio", href: "#/apps" }]);

      made.push(makeApps(h, ["alpha", "beta"]));
      s = await step(h, "apps");
      assert.equal(s.state, "todo");
      assert.equal(s.line, "No app is switched on.");
      assert.deepEqual(s.notes, []);
      assert.deepEqual(s.facts, { apps: 2, on: 0 });

      saveSwitch(h.config, "alpha", true);
      s = await step(h, "apps");
      assert.equal(s.state, "done");
      assert.equal(s.line, "1 of 2 apps are switched on.");
      assert.deepEqual(s.notes, ["App alpha: This app cannot spend anything right now."]);
      assert.ok(s.notes[0].endsWith("This app cannot spend anything right now."));
      assert.deepEqual(s.facts, { apps: 2, on: 1 });
    } finally {
      for (const d of [empty, ...made]) rmSync(d, { recursive: true, force: true });
    }
  });
});

// brain (S1 case 9)
const doctype = (name, track) => ({ doctype: "DocType", name, ...(track === undefined ? {} : { track_changes: track }) });

test("the brain: Track changes asked of the books, read only", async () => {
  await withHome(async (h) => {
    const s = await step(h, "brain");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "Off. The books keep a history for Project and Contact, so it can be switched on.");
    assert.deepEqual(s.notes, []);
    assert.deepEqual(s.facts, { on: false, trackChanges: { project: true, contact: true } });
    assert.deepEqual(s.links, [{ label: "Open Settings", href: "#/settings" }]);
  }, { benchSeed: withDocs({ DocType: [doctype("Project", 1), doctype("Contact", 1)] }) });
  await withHome(async (h) => {
    let s = await step(h, "brain");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "Off. Before you switch it on, turn on Track changes for Contact in the books.");
    assert.deepEqual(s.notes, ["In the books, open Customize Form for each one and tick Track Changes."]);
    assert.deepEqual(s.facts.trackChanges, { project: true, contact: false });

    updateDoors(h.config, (st) => { st.brain.on = true; });
    s = await step(h, "brain");
    assert.equal(s.state, "done");
    assert.equal(s.line, "On. Agents search your files instead of reading them whole.");
    assert.deepEqual(s.notes, ["Track changes is off for Contact in the books, so the brain cannot see who changed those records."]);
  }, { benchSeed: withDocs({ DocType: [doctype("Project", 1), doctype("Contact", 0)] }) });
  await withHome(async (h) => {
    const s = await step(h, "brain");
    assert.equal(s.line, "Off. Before you switch it on, turn on Track changes for Project and Contact in the books.");
  }, { benchSeed: withDocs({ DocType: [doctype("Project", 0), doctype("Contact")] }) });
  await withHome(async (h) => {
    const s = await step(h, "brain");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "Off. The setup could not ask the books whether Track changes is on for Project and Contact.");
    assert.deepEqual(s.facts.trackChanges, { project: null, contact: null });
  });
  await withHome(async (h) => {
    await h.bench.close();
    const s = await step(h, "brain");
    assert.equal(s.line, "Off. The setup could not ask the books whether Track changes is on for Project and Contact.");
  }, { benchSeed: withDocs({ DocType: [doctype("Project", 1), doctype("Contact", 1)] }) });
});

// notYet (S1 case 10)
test("not possible yet: Health's own entries and words, in order", async () => {
  await withHome(async (h) => {
    const r = (await get(h)).json;
    assert.deepEqual(r.notYet.map((x) => x.id), ["publishing", "email", "whatsapp", "gst_portal", "board_login"]);
    assert.deepEqual(r.notYet.map((x) => x.id), [...NOT_YET_IDS]);
    const health = notConnected(join(h.config.paths.books, "skipped-apps.txt"));
    for (const x of r.notYet) {
      assert.deepEqual(Object.keys(x), ["id", "title", "line", "how"]);
      const want = health.find((e) => e.id === x.id);
      assert.deepEqual(x, { id: want.id, title: want.label, line: want.explain, how: want.how });
    }
  });
});

// 8
test("skip for now: kept, ignored once the step is done, refused for models, proof and bad values", async () => {
  await withHome(async (h) => {
    clearBasics(h);
    const r = await call(h.url, "POST", "/api/setup/skip", { body: { step: "basics", skip: true } });
    assert.equal(r.status, 200);
    let b = stepOf(r.json, "basics");
    assert.equal(b.state, "skipped");
    assert.equal(b.skipped, true);
    assert.equal(b.line, "0 of 9 basics filled.");
    assert.equal(r.json.counts.skipped, 1);
    assert.deepEqual(sameShape(readShape("setup"), r.json), []);

    fillBasics(h, 9);
    const after = (await get(h)).json;
    b = stepOf(after, "basics");
    assert.equal(b.state, "done");
    assert.equal(b.skipped, true);
    assert.equal(after.counts.skipped, 0);

    const back = await call(h.url, "POST", "/api/setup/skip", { body: { step: "basics", skip: false } });
    assert.equal(back.status, 200);
    assert.equal(stepOf(back.json, "basics").skipped, false);

    const refused = [
      { step: "models", skip: true }, { step: "proof", skip: true }, { step: "task", skip: true }, { step: "web", skip: true },
      { step: "checker-login", skip: true }, { step: "brand", skip: "yes" }, { step: "other", skip: true }, {},
    ];
    for (const body of refused) {
      const bad = await call(h.url, "POST", "/api/setup/skip", { body });
      assert.equal(bad.status, 400);
      assert.deepEqual(bad.json, { error: { message: "That step cannot be skipped.", next: "Do the step, or hide the setup instead.", code: "bad_step" } });
    }
    const none = await call(h.url, "POST", "/api/setup/skip");
    assert.equal(none.status, 400);
    assert.equal(none.json.error.code, "bad_step");
    assert.equal((await step(h, "models")).skipped, false);
  });
});

// 9
test("hide the setup, then show it again", async () => {
  await withHome(async (h) => {
    assert.equal((await get(h)).json.open, true);
    const hide = await call(h.url, "POST", "/api/setup/dismiss", { body: { dismissed: true } });
    assert.equal(hide.status, 200);
    assert.equal(hide.json.dismissed, true);
    assert.equal(hide.json.show, false);
    assert.equal(hide.json.open, false);
    const show = await call(h.url, "POST", "/api/setup/dismiss", { body: { dismissed: false } });
    assert.equal(show.status, 200);
    assert.equal(show.json.dismissed, false);
    assert.equal(show.json.show, true);
    assert.equal(show.json.open, true);
    for (const body of [{}, { dismissed: "yes" }, { dismissed: 1 }]) {
      const bad = await call(h.url, "POST", "/api/setup/dismiss", { body });
      assert.equal(bad.status, 400);
      assert.deepEqual(bad.json, { error: { message: "That is not a choice here.", next: "Hide the setup or show it again.", code: "bad_choice" } });
    }
  }, { boardSeed: emptyBoard() });
});

// 10
test("finished: three steps skipped, the models ready, the fence held and a task on the board", async () => {
  await withHome(async (h) => {
    clearBasics(h);
    setLogins(h, { agent: true, checker: "own" });
    for (const s of ["basics", "brand", "books"]) {
      const r = await call(h.url, "POST", "/api/setup/skip", { body: { step: s, skip: true } });
      assert.equal(r.status, 200);
    }
    const r = (await get(h)).json;
    assert.deepEqual(r.steps.filter((s) => s.group === "start").map((s) => s.state), ["done", "done", "skipped", "skipped", "skipped", "done"]);
    assert.deepEqual(r.counts, { done: 3, skipped: 3, total: 6 });
    assert.equal(r.finished, true);
    assert.equal(r.show, false);
    assert.equal(r.open, false);
    assert.equal(r.dismissed, false);
  });
});

// counts and finished (S1 case 11)
test("the optional steps never change counts, finished, show or open", async () => {
  // Every optional step done, the six still to do.
  await withHome(async (h) => {
    const made = [];
    try {
      clearBasics(h);
      rmSync(join(docs(h), "brand", "kit.json"), { force: true });
      rmSync(h.config.paths.proofLast, { force: true });
      setLogins(h, { agent: false, checker: "own" });
      updateDoors(h.config, (s) => { s.web.on = true; s.viewer.on = true; s.generate.on = true; s.generate.higgsfield.on = true; s.brain.on = true; });
      writeStatus(h, { higgsfield: { signedIn: true, refused: false }, runway: { signedIn: true, refused: false } });
      made.push(makeApps(h, ["alpha"]));
      saveSwitch(h.config, "alpha", true);
      const r = (await get(h)).json;
      assert.deepEqual(r.steps.filter((s) => s.group === "later").map((s) => s.state), Array(8).fill("done"));
      assert.deepEqual(r.later, { done: 8, total: 8 });
      assert.deepEqual(r.steps.filter((s) => s.group === "start").map((s) => s.state), Array(6).fill("todo"));
      assert.deepEqual(r.counts, { done: 0, skipped: 0, total: 6 });
      assert.equal(r.finished, false);
      assert.equal(r.show, true);
      assert.equal(r.open, true);
      // Ten more answers with every reader in use change nothing under state/.
      const start = snapshot(h.state);
      for (let i = 0; i < 10; i += 1) await get(h);
      assert.deepEqual(changed(start, snapshot(h.state)), []);
    } finally {
      for (const d of made) rmSync(d, { recursive: true, force: true });
    }
  }, { boardSeed: emptyBoard(), benchSeed: withDocs({ DocType: [doctype("Project", 1), doctype("Contact", 1)] }) });
  // The six finished, every optional step still to do.
  await withHome(async (h) => {
    const empty = mkdtempSync(join(tmpdir(), "uuu-setup-noapps-"));
    try {
      h.config.paths.appsCode = empty;
      setLogins(h, { agent: true, checker: "shared" });
      for (const s of ["basics", "brand", "books"]) await call(h.url, "POST", "/api/setup/skip", { body: { step: s, skip: true } });
      const r = (await get(h)).json;
      assert.deepEqual(r.steps.filter((s) => s.group === "later").map((s) => s.state), Array(8).fill("todo"));
      assert.deepEqual(r.later, { done: 0, total: 8 });
      assert.equal(r.counts.done + r.counts.skipped, 6);
      assert.equal(r.finished, true);
      assert.equal(r.show, false);
      assert.equal(r.open, false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, { boardSeed: routinesAs(["paused", "paused"]) });
});

// 11 and S1 case 12
test("ten GETs change nothing, and the two writes change only home/decisions.json", async () => {
  await withHome(async (h) => {
    const start = snapshot(h.state);
    for (let i = 0; i < 10; i += 1) await get(h);
    assert.deepEqual(changed(start, snapshot(h.state)), []);
    await call(h.url, "POST", "/api/setup/skip", { body: { step: "brand", skip: true } });
    await call(h.url, "POST", "/api/setup/dismiss", { body: { dismissed: true } });
    assert.deepEqual(changed(start, snapshot(h.state)), ["home/decisions.json"]);
    const saved = JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));
    assert.deepEqual(saved["setup:skipped"], { basics: false, brand: true, books: false });
    assert.equal(typeof saved["setup:dismissed"], "string");
    await call(h.url, "POST", "/api/setup/dismiss", { body: { dismissed: false } });
    assert.equal(JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"))["setup:dismissed"], null);
    assert.ok(h.bench.requests.every((r) => r.method === "GET"));
    assert.ok(h.board.requests.every((r) => r.method === "GET"));
  });
});

test("nothing acts: over the whole file the board and the books saw only reads", () => {
  assert.deepEqual(seen.board, []);
  assert.deepEqual(seen.bench, []);
});

// 12 and S1 case 13
test("source rule: the setup's two files name no forbidden call or secret path", () => {
  const FORBIDDEN = new RegExp([
    "\\b(buildView|fillNewPicks|readKey|readSecret|updateState|updateDoors|saveSwitch|callDoor|runTest|relayProbe",
    "|readFileSync|openSync|createReadStream|child_process|writeFileSync|renameSync|mkdirSync|rmSync|unlinkSync|spawn|execFile",
    "|writeAllowance|stopAllowance|saveDoorKey|removeDoorKey|ownerToken|higgsfieldAuth|runwayAuth)\\b",
    "|ctx\\.board\\.(post|patch|put|delete)\\b|ctx\\.bench\\.(post|put|delete)\\b",
    "|paths\\.(secrets|agentSecrets|providerSecrets|providerKey|relaySecret|doorSecrets|webSecret|generateSecret|viewerSecret|brainSecret|runwayKey|searchKey|benchOwnerKey)\\b",
    "|secrets|oauth",
  ].join(""));
  for (const rel of ["lib/setup.mjs", "routes/setup.mjs"]) {
    const text = readFileSync(join(SERVER, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    assert.equal(FORBIDDEN.exec(text), null, `${rel} names a forbidden call or path`);
    // The only writes: the two display records.
    const sets = text.match(/\.set\(/g) || [];
    if (rel === "routes/setup.mjs") assert.equal(sets.length, 2);
    else assert.deepEqual(text.match(/decisions\.set\(/g), null);
    // The door's status file is read only through the trust rule, with the pinned cap.
    if (rel === "lib/setup.mjs") {
      assert.deepEqual(text.match(/readTrustedText\([^)]*\)/g), ["readTrustedText(ctx.config.paths.generateStatus, STATUS_MAX_BYTES)"]);
      assert.match(text, /const STATUS_MAX_BYTES = 262144;/);
    }
  }
});
