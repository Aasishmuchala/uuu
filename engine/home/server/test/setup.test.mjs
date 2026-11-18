// GET /api/setup and its two display writes (PLAN-ONBOARD T1). The setup only looks: no secret is opened, no
// switch or key is written, and the board and the books see only reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchSeed, boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { freshState, writeState } from "../lib/models.mjs";
import { COMMANDS, forgetBooks, LEADS, STEP_IDS, SWITCH_IDS, WORDS } from "../lib/setup.mjs";
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
const docs = (h) => h.config.paths.knowledgeDocs;
const FILLED = "This basic is filled in for the setup test, with more than forty bytes of words.\n";

function clearBasics(h) {
  for (const b of BASICS) rmSync(join(docs(h), b.file), { force: true });
}
function fillBasics(h, n) {
  for (const b of BASICS.slice(0, n)) {
    mkdirSync(dirname(join(docs(h), b.file)), { recursive: true });
    writeFileSync(join(docs(h), b.file), FILLED);
  }
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

// 1
test("a fresh stub home: the answer fits its shape, steps and switches in order, five counted", async () => {
  await withHome(async (h) => {
    const r = await get(h);
    assert.deepEqual(sameShape(readShape("setup"), r.json), []);
    assert.deepEqual(Object.keys(r.json), ["open", "show", "dismissed", "finished", "counts", "steps", "switches", "generatedAt"]);
    assert.deepEqual(r.json.steps.map((s) => s.id), ["basics", "brand", "models", "books", "task"]);
    assert.deepEqual(r.json.steps.map((s) => s.id), [...STEP_IDS]);
    assert.deepEqual(r.json.switches.map((s) => s.id), ["web", "generation", "viewer", "apps", "brain"]);
    assert.deepEqual(r.json.switches.map((s) => s.id), [...SWITCH_IDS]);
    assert.equal(r.json.counts.total, 5);
    assert.deepEqual(r.json.steps.map((s) => s.canSkip), [true, true, false, true, false]);
    for (const s of r.json.steps) {
      assert.deepEqual(Object.keys(s), ["id", "title", "state", "canSkip", "skipped", "line", "why", "notes", "links", "commands", "facts"]);
      for (const l of s.links) assert.match(l.href, /^#\//);
      for (const c of s.commands) assert.ok(Object.values(COMMANDS).includes(c.command));
    }
    // Every switch is off in a fresh home, with its pinned line.
    for (const s of r.json.switches) {
      assert.equal(s.on, false);
      assert.equal(s.line, WORDS.switches[s.id].off);
      assert.equal(s.href, s.id === "apps" ? "#/apps" : "#/settings");
    }
    assert.equal(r.json.dismissed, false);
    assert.equal(r.json.finished, false);
    assert.equal(r.json.show, true);
  });
});

// 2
test("basics: none, two and all nine filled", async () => {
  await withHome(async (h) => {
    clearBasics(h);
    let b = stepOf((await get(h)).json, "basics");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "0 of 9 basics filled.");
    assert.deepEqual(b.notes, []);
    assert.deepEqual(b.facts, { filled: 0, total: 9, missing: BASICS.map((x) => x.title) });
    assert.deepEqual(b.links, [{ label: "Open Files", href: "#/files" }]);

    fillBasics(h, 2);
    b = stepOf((await get(h)).json, "basics");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "2 of 9 basics filled.");
    assert.deepEqual(b.notes, ["Still to fill: What we never say, What we sell, Terms, Refunds, Our support promise, Team and Ideal customer."]);
    assert.equal(b.facts.filled, 2);

    fillBasics(h, 8);
    b = stepOf((await get(h)).json, "basics");
    assert.deepEqual(b.notes, ["Still to fill: Ideal customer."]);

    fillBasics(h, 9);
    b = stepOf((await get(h)).json, "basics");
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
    let s = stepOf((await get(h)).json, "brand");
    assert.equal(s.state, "todo");
    assert.equal(s.line, "No brand kit yet.");
    assert.deepEqual(s.facts, { saved: false });
    assert.deepEqual(s.links, [{ label: "Open the brand kit", href: "#/files/brand-kit" }]);

    mkdirSync(dirname(kit), { recursive: true });
    writeFileSync(kit, JSON.stringify({ name: "Test", colours: [] }));
    s = stepOf((await get(h)).json, "brand");
    assert.equal(s.state, "done");
    assert.equal(s.line, "Your brand kit is saved.");
    assert.deepEqual(s.facts, { saved: true });

    writeFileSync(kit, "not json");
    s = stepOf((await get(h)).json, "brand");
    assert.equal(s.state, "unknown");
    assert.equal(s.line, "The brand kit could not be read. Open it and save it again.");
  });
});

// 4
test("models, plans: the two logins are judged by existence only, never opened", async () => {
  await withHome(async (h) => {
    const env = join(h.state, "agent.env");
    const auth = join(h.state, "codex-home", "auth.json");
    const outside = join(dirname(h.state), "owner-codex-auth.json");
    const models = async () => stepOf((await get(h)).json, "models");
    try {
      let m = await models();
      assert.equal(m.state, "todo");
      assert.equal(m.line, "Plans mode is on, but the Claude agents have no login of their own yet.");
      assert.deepEqual(m.commands, [{ lead: LEADS.only, command: "engine/fence/login-wizard.sh" }]);
      assert.deepEqual(m.links, [{ label: "Open Settings", href: "#/settings" }]);
      assert.deepEqual(m.facts, { mode: "plans", ready: false, checkerOwnLogin: false });

      writeFileSync(env, "made up\n", { mode: 0o600 });
      m = await models();
      assert.equal(m.state, "todo");
      assert.equal(m.line, "Plans mode is on, but the Checker has no Codex login yet.");
      assert.deepEqual(m.commands, [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/fence/login-wizard.sh codex" }]);

      // A link to a file outside the state: the owner's own login, for now.
      mkdirSync(dirname(auth), { recursive: true, mode: 0o700 });
      writeFileSync(outside, "{}\n", { mode: 0o600 });
      symlinkSync(outside, auth);
      m = await models();
      assert.equal(m.state, "done");
      assert.equal(m.line, "Plans mode is on and ready: your agents use your Claude and Codex plans.");
      assert.deepEqual(m.notes, ["The Checker is using your own Codex login for now. Giving it its own is a step only you can do."]);
      assert.deepEqual(m.commands, [{ lead: "When you are ready, open Terminal and run:", command: "engine/fence/login-wizard.sh codex" }]);
      assert.deepEqual(m.facts, { mode: "plans", ready: true, checkerOwnLogin: false });
      const linked = JSON.stringify(m);
      chmodSync(env, 0o000);
      chmodSync(outside, 0o000);
      assert.equal(JSON.stringify(await models()), linked);
      chmodSync(env, 0o600);
      chmodSync(outside, 0o600);

      // A plain file inside the state: its own login.
      rmSync(auth);
      writeFileSync(auth, "{}\n", { mode: 0o600 });
      m = await models();
      assert.equal(m.state, "done");
      assert.deepEqual(m.notes, []);
      assert.deepEqual(m.commands, []);
      assert.deepEqual(m.facts, { mode: "plans", ready: true, checkerOwnLogin: true });
      const own = JSON.stringify(m);
      chmodSync(env, 0o000);
      chmodSync(auth, 0o000);
      assert.equal(JSON.stringify(await models()), own);
    } finally {
      for (const f of [env, auth, outside]) { try { chmodSync(f, 0o600); } catch { /* not there */ } }
    }
  });
});

// 5
test("models, provider: the saved test result gives the line, and the key is never opened or sent", async () => {
  await withHome(async (h) => {
    const p = h.config.paths;
    // The test writes the state without its key scrub, so even the test never opens the key file.
    const noKey = { ...h.config, paths: { ...p, providerKey: join(h.state, "no-such-key") } };
    const save = (keyState) => {
      const s = freshState();
      s.mode = "provider";
      s.key = { savedAt: "2026-11-18T09:00:00.000Z", state: keyState, checkedAt: "2026-11-18T09:00:00.000Z" };
      writeState(noKey, s);
    };
    save("ok");
    let m = stepOf((await get(h)).json, "models");
    assert.equal(m.state, "todo");
    assert.equal(m.line, "Omega Plus is on, but no key is saved. Open Settings.");
    assert.deepEqual(m.facts, { mode: "provider", ready: false, checkerOwnLogin: null });

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
        save(keyState);
        const bytes = readFileSync(p.modelsState);
        for (let i = 0; i < 3; i += 1) {
          const r = await get(h);
          assert.ok(!r.text.includes("SECRET-MARKER"));
          m = stepOf(r.json, "models");
          assert.equal(m.state, state);
          assert.equal(m.line, line);
          assert.equal(m.facts.ready, state === "done");
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

// 6
const COMPANY = { doctype: "Company", name: "Test Company", default_holiday_list: "Holidays 2026" };
const ADDRESS = { doctype: "Address", name: "Test Company-Billing", is_your_company_address: 1, disabled: 0 };
const withDocs = (docs) => {
  const s = benchSeed();
  Object.assign(s.docs, docs);
  return s;
};

test("books: the default seed, both answers there, the address only", async () => {
  await withHome(async (h) => {
    const b = stepOf((await get(h)).json, "books");
    // The default seed holds no Company and no Address.
    assert.equal(b.state, "todo");
    assert.deepEqual(b.facts, { connection: "on", company: { address: false, holidays: false } });
  });
  await withHome(async (h) => {
    const b = stepOf((await get(h)).json, "books");
    assert.equal(b.state, "done");
    assert.equal(b.line, "The books are connected and your company's details are in them.");
    assert.deepEqual(b.links, [{ label: "Open the Books dashboard", href: "#/dashboards/books" }]);
    assert.deepEqual(b.commands, []);
    assert.deepEqual(b.facts, { connection: "on", company: { address: true, holidays: true } });
  }, { benchSeed: withDocs({ Company: [COMPANY], Address: [ADDRESS] }) });
  await withHome(async (h) => {
    const b = stepOf((await get(h)).json, "books");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "The books are connected. Your company's details are not in them yet.");
    assert.deepEqual(b.notes, [
      "It asks whether the company is registered for GST, the company's address, and the weekly days off and public holidays, then shows it all and saves it in one go.",
      "Until then invoices say \"Nil-Rated\" even where tax is charged, and leave can be drafted but not made final.",
    ]);
    assert.deepEqual(b.commands, [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/books/setup-wizard.sh" }]);
    assert.deepEqual(b.links, [{ label: "Open the Books dashboard", href: "#/dashboards/books" }]);
    assert.deepEqual(b.facts, { connection: "on", company: { address: true, holidays: false } });
    // The two reads, as pinned: GETs of Company and Address only.
    const reads = h.bench.requests.filter((r) => r.path.startsWith("/api/resource/")).map((r) => r.path).sort();
    assert.deepEqual(reads, ["/api/resource/Address", "/api/resource/Company"]);
    // A second answer within 30 seconds asks the books nothing more.
    await get(h);
    assert.equal(h.bench.requests.filter((r) => r.path.startsWith("/api/resource/")).length, 2);
  }, { benchSeed: withDocs({ Company: [{ ...COMPANY, default_holiday_list: "" }], Address: [ADDRESS] }) });
});

test("books: not installed, off, and a read that fails", async () => {
  await withHome(async (h) => {
    const b = stepOf((await get(h)).json, "books");
    assert.equal(b.state, "todo");
    assert.equal(b.line, "The books are not installed on this Mac yet.");
    assert.deepEqual(b.commands, []);
    assert.deepEqual(b.links, [{ label: "Open Health", href: "#/health" }]);
    assert.deepEqual(b.facts, { connection: "not_installed", company: null });
  }, { benchInstalled: false });
  await withHome(async (h) => {
    await h.bench.close();
    const b = stepOf((await get(h)).json, "books");
    assert.equal(b.state, "unknown");
    assert.equal(b.line, "The books are off, so the setup cannot see what they hold.");
    assert.deepEqual(b.links, [{ label: "Open Health", href: "#/health" }]);
    assert.deepEqual(b.facts, { connection: "off", company: null });
  });
  await withHome(async (h) => {
    const b = stepOf((await get(h)).json, "books");
    assert.equal(b.state, "unknown");
    assert.equal(b.line, "The books are connected, but they did not answer just now.");
    assert.deepEqual(b.facts, { connection: "on", company: null });
  }, { benchSeed: { ...benchSeed(), missingDoctypes: ["Company"] } });
});

// 7
test("task: no goal, the default seed, a question only, the board off", async () => {
  const empty = boardSeedV2();
  empty.issues = [];
  await withHome(async (h) => {
    const r = await get(h);
    const t = stepOf(r.json, "task");
    assert.equal(t.state, "todo");
    assert.equal(t.line, "No task yet.");
    assert.deepEqual(t.links, [{ label: "Choose a job", href: "#/jobs" }]);
    assert.deepEqual(t.facts, { count: 0 });
    assert.equal(r.json.open, true);
  }, { boardSeed: empty });
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
    const t = stepOf((await get(h)).json, "task");
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

// 8
test("skip for now: kept, ignored once the step is done, refused for models and bad values", async () => {
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

    for (const body of [{ step: "models", skip: true }, { step: "task", skip: true }, { step: "brand", skip: "yes" }, { step: "other", skip: true }, {}]) {
      const bad = await call(h.url, "POST", "/api/setup/skip", { body });
      assert.equal(bad.status, 400);
      assert.deepEqual(bad.json, { error: { message: "That step cannot be skipped.", next: "Do the step, or hide the setup instead.", code: "bad_step" } });
    }
    const none = await call(h.url, "POST", "/api/setup/skip");
    assert.equal(none.status, 400);
    assert.equal(none.json.error.code, "bad_step");
    assert.equal(stepOf((await get(h)).json, "models").skipped, false);
  });
});

// 9
test("hide the setup, then show it again", async () => {
  const empty = boardSeedV2();
  empty.issues = [];
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
  }, { boardSeed: empty });
});

// 10
test("finished: three steps skipped, the models ready and a task on the board", async () => {
  await withHome(async (h) => {
    clearBasics(h);
    writeFileSync(join(h.state, "agent.env"), "made up\n", { mode: 0o600 });
    mkdirSync(join(h.state, "codex-home"), { recursive: true, mode: 0o700 });
    writeFileSync(join(h.state, "codex-home", "auth.json"), "{}\n", { mode: 0o600 });
    for (const step of ["basics", "brand", "books"]) {
      const r = await call(h.url, "POST", "/api/setup/skip", { body: { step, skip: true } });
      assert.equal(r.status, 200);
    }
    const r = (await get(h)).json;
    assert.deepEqual(r.steps.map((s) => s.state), ["skipped", "skipped", "done", "skipped", "done"]);
    assert.deepEqual(r.counts, { done: 2, skipped: 3, total: 5 });
    assert.equal(r.finished, true);
    assert.equal(r.show, false);
    assert.equal(r.open, false);
    assert.equal(r.dismissed, false);
  });
});

// 11
test("the two writes change only home/decisions.json, and a GET changes nothing", async () => {
  await withHome(async (h) => {
    const start = snapshot(h.state);
    await get(h);
    await get(h);
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
  });
});

test("nothing acts: over the whole file the board and the books saw only reads", () => {
  assert.deepEqual(seen.board, []);
  assert.deepEqual(seen.bench, []);
});

// 12
test("source rule: the setup's two files name no forbidden call", () => {
  const FORBIDDEN = /\b(buildView|fillNewPicks|readKey|readSecret|updateState|updateDoors|saveSwitch|callDoor|runTest|relayProbe|readFileSync|openSync|createReadStream|child_process|writeFileSync|renameSync|mkdirSync|rmSync|unlinkSync|spawn|execFile)\b/;
  for (const rel of ["lib/setup.mjs", "routes/setup.mjs"]) {
    const text = readFileSync(join(SERVER, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    assert.equal(FORBIDDEN.exec(text), null, `${rel} names a forbidden call`);
    // The only writes: the two display records.
    const sets = text.match(/\.set\(/g) || [];
    if (rel === "routes/setup.mjs") assert.equal(sets.length, 2);
    else assert.deepEqual(text.match(/decisions\.set\(/g), null);
  }
});
