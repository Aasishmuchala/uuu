// The stage on `normal`: every part answers, the walls hold, parts come and go, faults replace them, the browser
// client loads the home, and close() leaves nothing behind.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { openBrowser } from "../lib/cdp.mjs";
import { PART_NAMES } from "../lib/faults.mjs";
import { call } from "../lib/http.mjs";
import { STAGE_PREFIX, startStage } from "../lib/stage.mjs";

const BASE = Number(process.env.STRESS_CHECK_BASE || 4300);
const stagesNow = () => readdirSync("/private/tmp").filter((n) => n.startsWith(STAGE_PREFIX)).sort();
let st = null;

describe("the stage on normal", () => {
  before(async () => { st = await startStage({ base: BASE, dataset: "normal", label: "check" }); });
  after(async () => { if (st) await st.close(); });

  test("all eleven parts answer their health address, and GET /api/setup is 200", async () => {
    assert.equal(PART_NAMES.length, 11);
    for (const part of PART_NAMES) assert.equal(await st.healthy(part), true, `${part} is not healthy`);
    const r = await call(`${st.urls.home}/api/setup`);
    assert.equal(r.status, 200);
    assert.ok(r.json && Array.isArray(r.json.groups), "setup has its groups");
    const pids = JSON.parse(readFileSync(join(st.root, "pids.json"), "utf8"));
    for (const part of PART_NAMES) assert.ok(Number.isInteger(pids[part].pid) && pids[part].startedAt, `${part} is in pids.json`);
    assert.equal(pids.gate.pid, pids.gateNarrow.pid, "the gate and the narrow gate are one process, as live");
  });

  test("a taken port gives the exact refusal and starts nothing", async () => {
    const before = stagesNow();
    const pidsBefore = JSON.stringify(st.pids);
    await assert.rejects(startStage({ base: BASE, label: "taken" }), { message: `stage: port ${BASE + 1} is in use; nothing was started` });
    assert.deepEqual(stagesNow(), before, "no stage folder was made");
    assert.equal(JSON.stringify(st.pids), pidsBefore, "the running stage was not touched");
    for (const part of PART_NAMES) assert.equal(await st.healthy(part), true, `${part} still answers`);
  });

  test("kill(home) then start(home) works, and pids.json follows", async () => {
    const first = st.pids.home.pid;
    assert.equal(await st.kill("home"), true);
    assert.equal(st.pids.home, undefined, "home left pids.json");
    assert.equal(await st.healthy("home"), false);
    const second = await st.start("home");
    assert.notEqual(second, first);
    assert.equal(st.pids.home.pid, second);
    assert.equal(await st.healthy("home"), true);
  });

  test("kill of a pid not in pids.json is refused and nothing is signalled", async () => {
    await assert.rejects(st.kill(process.pid), { message: `stage: ${process.pid} is not a process this stage started; not signalled` });
    await assert.rejects(st.kill(1), { message: "stage: 1 is not a process this stage started; not signalled" });
  });

  test("a runner asked to connect to 93.184.216.34:80 is refused and the try is logged", () => {
    const r = st.probe("93.184.216.34", 80);
    assert.deepEqual(r, { refused: true, message: "stage: outside call refused: 93.184.216.34:80" });
    const live = st.probe("127.0.0.1", 3200);
    assert.equal(live.refused, true, "a live port is refused even on 127.0.0.1");
    const calls = st.outsideCalls();
    const out = calls.find((c) => c.host === "93.184.216.34");
    assert.ok(out, "the outside try is in outside-calls.jsonl");
    assert.equal(out.port, 80);
    assert.equal(out.part, "probe");
    assert.ok(out.at && Number.isInteger(out.pid) && Array.isArray(out.stack));
    assert.equal(calls.length, 2, "nothing else in the stage called out");
  });

  test("setFault(generate, html) makes the generation door answer HTML; null brings it back", async () => {
    await st.setFault("generate", "html");
    const r = await call(`${st.urls.generate}/gen/health`);
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-type"]), /text\/html/);
    assert.equal(r.text, "<html>");
    assert.equal(st.pids.generate.fault, "html");
    await st.setFault("generate", null);
    const back = await call(`${st.urls.generate}/gen/health`);
    assert.equal(back.status, 200);
    assert.equal(back.json.part, "generate");
    assert.equal(st.pids.generate.fault, undefined);
  });

  test("the browser client loads the home and reads a title", async () => {
    const b = await openBrowser();
    try {
      const page = await b.page();
      const nav = await page.goto(`${st.urls.home}/`);
      assert.equal(nav.errorText, null);
      const { result } = await page.send("Runtime.evaluate", { expression: "document.title", returnByValue: true });
      assert.ok(typeof result.value === "string" && result.value.trim().length > 0, `title: ${JSON.stringify(result.value)}`);
      const m = await page.metrics();
      assert.ok(m.Nodes > 0);
    } finally {
      await b.close();
    }
    assert.equal(existsSync(b.profileDir), false, "the profile folder is gone");
  });

  test("close() leaves no process holding the stage root and no folder", async () => {
    const root = st.root;
    const res = await st.close();
    st = null;
    assert.deepEqual(res.leftovers, []);
    assert.equal(existsSync(root), false);
    const { execFileSync } = await import("node:child_process");
    const ps = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    assert.equal(ps.split("\n").filter((l) => l.includes(root)).length, 0);
  });
});
