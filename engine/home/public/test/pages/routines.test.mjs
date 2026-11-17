// Routines page: its helpers are pure and are checked here; the page itself loads in Node.
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../pages/routines.js");

test("routines: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("routines: limitWords says the limit in words", () => {
  assert.equal(mod.limitWords(1), "1 minute");
  assert.equal(mod.limitWords(10), "10 minutes");
  assert.equal(mod.limitWords(60), "1 hour");
  assert.equal(mod.limitWords(90), "1 hour 30 minutes");
  assert.equal(mod.limitWords(120), "2 hours");
  assert.equal(mod.limitWords(null), "");
  assert.equal(mod.limitWords(0), "");
  assert.equal(mod.limitWords("soon"), "");
});

test("routines: runLine gives the state and the time", () => {
  assert.equal(mod.runLine(null), "");
  const line = mod.runLine({ at: "2020-01-05T03:30:00.000Z", plainState: "Finished", state: "finished" });
  assert.ok(line.startsWith("Finished, "), line);
  assert.equal(mod.runLine({ plainState: "Failed" }), "Failed");
});

test("routines: the page keeps its states and holds no address", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/routines.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /https?:\/\//);
  assert.match(src, /NotConnected/);
  assert.match(src, /No routines yet/);
  assert.match(src, /Left out/);
});

test("routines: the last run is named by its task's title, never by a ref alone (M52 F7)", async () => {
  const m = await import("../../pages/routines.js");
  assert.equal(m.runLinkLabel({ taskId: "x", identifier: "STH-14", title: "Daily brief" }), "Daily brief");
  assert.equal(m.runLinkLabel({ taskId: "x", identifier: "STH-14" }), "Open the last run");
});

test("routines: the list is rows grouped by state, each with its last run as a St", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/routines.js", import.meta.url), "utf8");
  assert.match(src, /function RoutineRow/);
  assert.match(src, /<\$\{St\} tone=/);
  assert.match(src, /Switch on/);
  assert.match(src, /Run now/);
  assert.match(src, /Not set up yet\./);
  assert.match(src, /No run yet/);
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U15). ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const byCls = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));

const routine = (id, state, more = {}) => ({
  id, title: `Routine ${id}`, state, plainState: state, who: null, when: { plain: "Every day at 03:30", next: "2026-11-18T03:30:00.000Z" },
  lastRun: { state: "finished", plainState: "Finished", at: "2026-11-17T03:30:00.000Z", taskId: "t1", title: "Daily brief" },
  ask: "Do the thing.", produces: ["a file"], runMinutes: 30, ...more,
});
const routinesData = (more = (i) => ({})) => ({ connected: true, routines: [routine("a", "on", more(0)), routine("b", "paused", more(1)), routine("c", "not_applied", more(2))], problems: [{ file: "x.json", problem: "no title" }] });
const oneData = (more = {}) => ({ routine: routine("a", "on", more), runs: [{ id: "r1", state: "finished", plainState: "Finished", at: "2026-11-17T03:30:00.000Z", source: "schedule", taskId: "t1", title: "Daily brief", note: "ok" }] });

async function mountRoutines(data = routinesData(), { id = "" } = {}) {
  installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: `#/routines${id ? `/${id}` : ""}`, href: "/", search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    return { ok: true, status: 200, json: async () => data };
  };
  const ctx = { shell: { team: [], dock: [] }, setTop() {}, announce() {}, openComposer() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${mod.default} route=${{ id: "routines", parts: id ? ["routines", id] : ["routines"], query: new URLSearchParams("") }} /><//>`, root);
  await new Promise((r) => setTimeout(r, 300));
  return { root, calls, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; } };
}

test("routines: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const [data, id] of [[routinesData(), ""], [oneData(), "a"]]) {
    const m = await mountRoutines(data, { id });
    try { seen.push(...m.calls); } finally { m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U15 changed it.
  const RECORDED = ["GET /api/routines", "GET /api/routines/a"];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

test("routines: the title and its line stand in the room header with the facade; one h1; rows on the ground in the lamp's pool (PLAN-3D-ALL U15)", async () => {
  for (const [data, id] of [[routinesData(), ""], [oneData(), "a"]]) {
    const m = await mountRoutines(data, { id });
    try {
      const band = elements(m.root).filter((e) => e.localName === "header" && classesOf(e).includes("k-room"));
      assert.equal(band.length, 1);
      assert.equal(band[0].getAttribute("data-glimpse"), "facade");
      const h1 = elements(m.root).filter((e) => e.localName === "h1");
      assert.equal(h1.length, 1);
      assert.equal(h1[0].getAttribute("id"), "page-title");
      const img = elements(m.root).filter((e) => e.localName === "img");
      assert.equal(img.length, 1);
      assert.equal(img[0].getAttribute("src"), glimpseSrc("facade", { theme: "dark", width: 1280 }));
      assert.equal(byCls(m.root, "k-page-header").length, 0);
      if (!id) assert.equal(byCls(m.root, "p-routines__row").length, 3);
    } finally { m.done(); }
  }
  const css = (await import("node:fs")).readFileSync(new URL("../../styles/pages/routines.css", import.meta.url), "utf8");
  assert.match(css, /\.p-routines \.p-routines__row:hover, \.p-routines \.p-routines__row:focus-within \{ background-color: var\(--lamp-pool\); \}/);
  // PLAN-3D-ALL U17: the layer and the pull are the kit's (U16); the band is given `pull` instead of the sheet copying
  // "margin-top: calc(-1 * var(--s-6)); … z-index: 1".
  assert.match(css, /\.p-routines \.k-room \{ margin-bottom: var\(--s-4\); \}/);
  assert.match((await import("node:fs")).readFileSync(new URL("../../pages/routines.js", import.meta.url), "utf8"), /<\$\{RoomHeader\} glimpse=\$\{glimpseFor\("routines"\)\} pull\b/);
  assert.match(css, /\.p-routines \.k-room \.k-room__scrim \{ opacity: 0\.8; \}/);
});

test("routines: hostile server text stays text (PLAN-3D-ALL U15)", async () => {
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => elements(root).filter((e) => e.localName === t).length);
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const more = (i) => ({ title: bad(i), plainState: bad(i + 1), when: { plain: bad(i + 2), next: bad(i + 3) }, lastRun: { state: bad(i), plainState: bad(i + 4), at: bad(i + 5), taskId: "t1", title: bad(i + 3) }, ask: bad(i + 2), produces: [bad(i)] });
  for (const [clean, dirty, id] of [[routinesData(), routinesData(more), ""], [oneData(), { ...oneData(more(0)), runs: [{ id: "r", state: bad(1), plainState: bad(2), at: bad(3), source: bad(4), taskId: "t1", title: bad(6), note: bad(0), identifier: bad(1) }] }, "a"]]) {
    const s = await mountRoutines(clean, { id });
    let base;
    try { base = tags(s.root); } finally { s.done(); }
    const m = await mountRoutines(dirty, { id });
    try {
      assert.deepEqual(tags(m.root), base);
      for (const e of elements(m.root)) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
        for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
        if (e.localName === "img") assert.ok(GLIMPSES.some((k) => ["dark", "light"].some((t) => [1280, 390].some((w) => glimpseSrc(k, { theme: t, width: w }) === e.getAttribute("src")))));
      }
      const nodes = [...walkDom(m.root)].filter((n) => n.nodeType === 3).map((n) => n.data);
      assert.ok(nodes.some((t) => t.includes(bad(0)) || t.includes(bad(1))), "hostile text is a text node");
    } finally { m.done(); }
  }
});
