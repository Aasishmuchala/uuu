import { test } from "node:test";
import assert from "node:assert/strict";
import Page, { groupCount } from "../../pages/search.js";

test("search: the page is a component", () => {
  assert.equal(typeof Page, "function");
});

test("search: groupCount adds up results across groups", () => {
  assert.equal(groupCount([{ results: [1, 2] }, { results: [3] }, { results: [] }]), 3);
  assert.equal(groupCount([]), 0);
});

test("search: groupCount survives odd input", () => {
  assert.equal(groupCount(undefined), 0);
  assert.equal(groupCount([null, {}, { results: "x" }]), 0);
});

import { groupLabel } from "../../pages/search.js";

test("search: the groups Jobs and Files carry the owner's words", () => {
  assert.equal(groupLabel({ source: "jobs", label: "Jobs" }), "Jobs");
  assert.equal(groupLabel({ source: "brain", label: "Files" }), "Files");
  assert.equal(groupLabel({ source: "knowledge", label: "Docs" }), "Files");
  assert.equal(groupLabel({ source: "goals", label: "Goals" }), "Tasks");
  assert.equal(groupLabel({ source: "other", label: "Other" }), "Other");
  assert.equal(groupLabel(null), "");
});

test("search: results are rows under a heading, with the kit's empty states and no card", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/search.js", import.meta.url), "utf8");
  assert.match(src, /Type at least two letters\./);
  assert.match(src, /Nothing found for/);
  assert.match(src, /Not searched this time/);
  assert.doesNotMatch(src, /Card/);
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U15). ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const byCls = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));

const found = (bad = (i) => null) => ({
  groups: [
    { source: "goals", label: "Goals", results: [0, 1].map((i) => ({ title: bad(i) || `Task ${i}`, snippet: bad(i + 1) || `About ${i}`, link: { page: "task", id: `t${i}` } })) },
    { source: "brain", label: "Files", results: [{ title: bad(3) || "A file", snippet: "", link: null }] },
  ],
  notSearched: [{ source: bad(4) || "records", reason: bad(5) || "not connected" }],
});

async function mountSearch(data = found(), query = "q=brief") {
  installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: `#/search?${query}`, href: "/", search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    return { ok: true, status: 200, json: async () => data };
  };
  const ctx = { shell: { team: [], dock: [] }, setTop() {}, announce() {}, openComposer() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${Page} route=${{ id: "search", parts: ["search"], query: new URLSearchParams(query) }} /><//>`, root);
  await new Promise((r) => setTimeout(r, 300));
  return { root, calls, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; } };
}

test("search: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const query of ["q=brief", "q=a", ""]) {
    const m = await mountSearch(found(), query);
    try { seen.push(...m.calls); } finally { m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U15 changed it.
  const RECORDED = ["GET /api/search?q=brief"];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

test("search: the title and the field stand in the room header with the shelves; one h1; results in the lamp's pool (PLAN-3D-ALL U15)", async () => {
  const m = await mountSearch();
  try {
    const band = elements(m.root).filter((e) => e.localName === "header" && classesOf(e).includes("k-room"));
    assert.equal(band.length, 1);
    assert.equal(band[0].getAttribute("data-glimpse"), "shelves");
    const h1 = elements(m.root).filter((e) => e.localName === "h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].getAttribute("id"), "page-title");
    assert.equal(byCls(band[0], "p-search__form").length, 1, "the field is in the band");
    const img = elements(m.root).filter((e) => e.localName === "img");
    assert.equal(img.length, 1);
    assert.equal(img[0].getAttribute("src"), glimpseSrc("shelves", { theme: "dark", width: 1280 }));
    assert.equal(byCls(m.root, "k-page-header").length, 0);
    assert.equal(byCls(m.root, "p-search__item").length, 3);
  } finally { m.done(); }
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../styles/pages/search.css", import.meta.url), "utf8");
  assert.match(css, /\.p-search \.p-search__item:hover, \.p-search \.p-search__item:focus-within \{ background-color: var\(--lamp-pool\); \}/);
  // PLAN-3D-ALL U17: the layer and the pull are the kit's (U16); the band is given `pull` instead of the sheet copying
  // "margin-top: calc(-1 * var(--s-6)); … z-index: 1".
  assert.match(css, /\.p-search \.k-room \{ margin-bottom: var\(--s-4\); \}/);
  assert.match((await import("node:fs")).readFileSync(new URL("../../pages/search.js", import.meta.url), "utf8"), /<\$\{RoomHeader\} glimpse=\$\{glimpseFor\("search"\)\} pull\b/);
  assert.match(css, /\.p-search \.k-room \.k-room__scrim \{ opacity: 0\.8; \}/);
});

test("search: hostile server text stays text, links are our own pages (PLAN-3D-ALL U15)", async () => {
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => elements(root).filter((e) => e.localName === t).length);
  const s = await mountSearch();
  let base;
  try { base = tags(s.root); } finally { s.done(); }
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const data = found(bad);
  data.groups[0].results[0].link = { page: bad(2), id: bad(3) };
  data.groups[0].source = "goals";
  const m = await mountSearch(data);
  try {
    assert.deepEqual(tags(m.root), base);
    for (const e of elements(m.root)) {
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
      for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
      if (e.localName === "img") assert.ok(GLIMPSES.some((k) => ["dark", "light"].some((t) => [1280, 390].some((w) => glimpseSrc(k, { theme: t, width: w }) === e.getAttribute("src")))));
    }
    const nodes = [...walkDom(m.root)].filter((n) => n.nodeType === 3).map((n) => n.data);
    assert.ok(nodes.includes(bad(0)), "a hostile title is a text node");
  } finally { m.done(); }
});
