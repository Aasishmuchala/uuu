// Studio page (CONTRACTS 9.6): CAD parts with their measured size, other files, the not-installed notice,
// the renderer switch, and files written by agents treated as untrusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStubsHome } from "../lib/stubs.mjs";
import { call, writes } from "../lib/testing.mjs";

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}

const page = async (h) => {
  const r = await call(h.url, "GET", "/api/departments/studio");
  assert.equal(r.status, 200);
  return r.json;
};
const section = (p, id) => p.sections.find((s) => s.id === id);
const work = (h, ...parts) => join(h.state, "tasks", "company-work", ...parts);
const installTools = (h) => {
  mkdirSync(join(h.state, "cad", "venv", "bin"), { recursive: true });
  writeFileSync(join(h.state, "cad", "venv", "bin", "python"), "");
};
const part = (name, extra = {}) => JSON.stringify({
  name, units: "mm", bbox: { x: 10, y: 20, z: 3.5 }, volume_mm3: 600, script: `${name}.py`, made_at: "2026-11-11T00:00:00.000Z", ...extra,
});

test("the bracket is listed with its size, and the page has the pinned shape", async () => {
  await withHome(async (h) => {
    installTools(h);
    const p = await page(h);
    assert.equal(p.id, "studio");
    assert.equal(p.title, "Studio");
    assert.equal(p.connected, true);
    assert.equal(p.notConnected, null);
    assert.deepEqual(p.agent, { name: "Drafter", state: "free", plainState: "Free" });
    assert.deepEqual(p.inFlight, []);
    assert.deepEqual(p.figures.map((f) => f.id), ["files", "cad"]);
    assert.deepEqual(p.figures.map((f) => f.label), ["Files", "Parts"]);
    assert.deepEqual(section(p, "cad").columns.map((c) => c.label), ["Part", "Size", "Volume", "Task", "File"], "workshop words and Goal are gone (M51 F8, F10)");
    assert.equal(p.figures.find((f) => f.id === "cad").value, "1");
    assert.equal(p.figures.find((f) => f.id === "files").value, "0");
    assert.deepEqual(section(p, "cad").columns.map((c) => c.key), ["name", "size", "volume", "goal", "file"]);
    assert.deepEqual(section(p, "files").columns.map((c) => c.key), ["name", "goal", "size", "changed", "file"]);
    const rows = section(p, "cad").rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "bracket");
    assert.equal(rows[0].size, "60 × 40 × 5 mm");
    assert.equal(rows[0].volume, "11,717.26 mm³");
    assert.equal(rows[0].goal, "STH-2");
    assert.equal(rows[0].file, "bracket.step");
    const dl = await call(h.url, "GET", rows[0].fileUrl);
    assert.equal(dl.status, 200);
    assert.equal(dl.text, readFileSync(work(h, "STH-2", "cad", "bracket.step"), "utf8"));
    assert.deepEqual(p.switches, [{
      id: "renderer", label: "Show parts in 3D", on: false, explain: "Parts cannot be shown in 3D here. Open the file in your own drawing program.",
    }]);
    assert.equal(writes(h.board).length, 0);
  });
});

test("not installed: the notice, and existing files are still listed", async () => {
  await withHome(async (h) => {
    const p = await page(h);
    assert.equal(p.connected, false);
    assert.deepEqual(p.notConnected, { reason: "The Drafter's tools are not installed yet.", next: "Open Health to see how to install them." });
    assert.equal(section(p, "cad").rows.length, 1);
    assert.equal(p.switches[0].on, false);
  });
});

test("a JSON without a STEP is left out; studio files are listed with links", async () => {
  await withHome(async (h) => {
    writeFileSync(work(h, "STH-2", "cad", "lonely.json"), part("lonely"));
    mkdirSync(work(h, "STH-1", "studio"), { recursive: true });
    writeFileSync(work(h, "STH-1", "studio", "sketch notes.txt"), "a sketch");
    const p = await page(h);
    assert.deepEqual(section(p, "cad").rows.map((r) => r.name), ["bracket"]);
    const files = section(p, "files").rows;
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "sketch notes.txt");
    assert.equal(files[0].goal, "STH-1");
    assert.equal(files[0].size, "8 bytes");
    assert.match(files[0].changed, /^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    assert.equal((await call(h.url, "GET", files[0].fileUrl)).text, "a sketch");
    assert.equal(p.figures.find((f) => f.id === "files").value, "1");
  });
});

test("the board being off still lists the files", async () => {
  await withHome(async (h) => {
    await h.board.close();
    const p = await page(h);
    assert.equal(p.agent, null);
    assert.deepEqual(p.inFlight, []);
    assert.equal(section(p, "cad").rows.length, 1);
  });
});

test("files written by agents are untrusted: no links followed, size caps, only numbers used", async () => {
  const outside = mkdtempSync(join(tmpdir(), "uuu-studio-outside-"));
  try {
    mkdirSync(join(outside, "cad"), { recursive: true });
    mkdirSync(join(outside, "studio"), { recursive: true });
    writeFileSync(join(outside, "cad", "secret.json"), part("secret"));
    writeFileSync(join(outside, "cad", "secret.step"), "ISO-10303-21;");
    writeFileSync(join(outside, "studio", "secret.txt"), "secret");
    writeFileSync(join(outside, "loose.txt"), "secret");
    await withHome(async (h) => {
      // a whole goal folder that is a link to elsewhere
      symlinkSync(outside, work(h, "STH-9"));
      // cad and studio folders that are links
      mkdirSync(work(h, "STH-8"), { recursive: true });
      symlinkSync(join(outside, "cad"), work(h, "STH-8", "cad"));
      symlinkSync(join(outside, "studio"), work(h, "STH-8", "studio"));
      // linked files inside a real folder
      const cad = work(h, "STH-2", "cad");
      symlinkSync(join(outside, "cad", "secret.json"), join(cad, "linked.json"));
      writeFileSync(join(cad, "linked.step"), "x");
      writeFileSync(join(cad, "steplink.json"), part("steplink"));
      symlinkSync(join(outside, "cad", "secret.step"), join(cad, "steplink.step"));
      mkdirSync(work(h, "STH-2", "studio"), { recursive: true });
      symlinkSync(join(outside, "loose.txt"), work(h, "STH-2", "studio", "link.txt"));
      // bad JSON, too big, wrong types, odd names
      for (const [n, body] of [
        ["broken", "{ not json"],
        ["huge", part("huge", { pad: "x".repeat(70 * 1024) })],
        ["strings", part("strings", { bbox: { x: "60", y: 40, z: 5 } })],
        ["negative", part("negative", { volume_mm3: -1 })],
        ["array", "[1,2,3]"],
      ]) {
        writeFileSync(join(cad, `${n}.json`), body);
        writeFileSync(join(cad, `${n}.step`), "x");
      }
      writeFileSync(join(cad, "evil name.json"), part("evil"));
      writeFileSync(join(cad, "evil name.step"), "x");
      writeFileSync(join(cad, "shown.json"), part("<img src=x onerror=alert(1)>", { script: "../../etc/passwd" }));
      writeFileSync(join(cad, "shown.step"), "ISO");
      writeFileSync(work(h, "STH-2", "studio", ".hidden"), "x");
      writeFileSync(work(h, "STH-2", "studio", "bidi‮txt.exe"), "x");
      writeFileSync(work(h, "STH-2", "studio", "ok.txt"), "x");
      mkdirSync(work(h, "..bad"), { recursive: true });

      const p = await page(h);
      const cadRows = section(p, "cad").rows;
      assert.deepEqual(cadRows.map((r) => r.name).sort(), ["bracket", "shown"]);
      const shown = cadRows.find((r) => r.name === "shown");
      assert.equal(shown.size, "10 × 20 × 3.5 mm");
      assert.equal(shown.volume, "600 mm³");
      assert.equal(shown.file, "shown.step");
      assert.ok(!JSON.stringify(p).includes("onerror"));
      assert.ok(!JSON.stringify(p).includes("passwd"));
      assert.deepEqual(section(p, "files").rows.map((r) => r.name), ["ok.txt"]);
      assert.ok(!JSON.stringify(p).includes("secret"));
      // the download route refuses a linked file that leads out
      const tok = Buffer.from("STH-2/studio/link.txt").toString("base64url");
      assert.equal((await call(h.url, "GET", `/api/files/${tok}`)).status, 404);
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
