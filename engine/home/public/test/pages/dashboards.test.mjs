import { test } from "node:test";
import assert from "node:assert/strict";

const { DASHBOARDS, cardFigures, waitsLine, cardState } = await import("../../pages/dashboards.js");

test("the shelf holds the six dashboards in order, each with its department", () => {
  assert.deepEqual(DASHBOARDS.map((d) => d.id), ["books", "customers", "support", "people", "marketing", "studio"]);
  assert.deepEqual(DASHBOARDS.map((d) => d.dept), ["books", "sales", "support", "people", "marketing", "studio"]);
  for (const d of DASHBOARDS) assert.ok(d.title && d.about, `${d.id} has a title and a line`);
});

test("cardFigures takes the first three figures and caps their text", () => {
  const page = { figures: [
    { id: "a", label: "You are owed", value: "₹ 1,18,000.00", hint: "1 unpaid invoice" },
    { id: "b", label: "You owe", value: "₹ 9,440.00" },
    { id: "c", label: "Sales this month", value: "₹ 1,43,000.00" },
    { id: "d", label: "Spend this month", value: "₹ 12,980.00" },
  ] };
  assert.deepEqual(cardFigures(page).map((f) => f.id), ["a", "b", "c"]);
  assert.deepEqual(cardFigures(page, 2).map((f) => f.label), ["You are owed", "You owe"]);
  assert.equal(cardFigures({ figures: [{ id: "x", label: "L".repeat(500), value: 1 }] })[0].label.length, 80);
  assert.equal(cardFigures({ figures: [{ id: "x", label: "Open", value: 4 }] })[0].value, "4");
  assert.deepEqual(cardFigures(null), []);
  assert.deepEqual(cardFigures({ figures: "no" }), []);
  assert.deepEqual(cardFigures({ figures: [null, { id: "y" }] }), []);
});

test("waitsLine names what waits for the owner, by section", () => {
  const books = { sections: [
    { id: "drafts", rows: [{ inboxId: "a" }, { inboxId: "b" }, { name: "no item" }] },
    { id: "unpaid_invoices", rows: [{ name: "x" }] },
  ] };
  assert.equal(waitsLine(books), "2 drafts wait for you.");
  assert.equal(waitsLine({ sections: [{ id: "draft_replies", rows: [{ inboxId: "a" }] }] }), "1 reply waits for you.");
  assert.equal(waitsLine({ sections: [{ id: "leave", rows: [{ inboxId: "a" }] }, { id: "drafts", rows: [{ inboxId: "b" }] }] }),
    "1 leave request and 1 draft wait for you.");
  assert.equal(waitsLine({ sections: [{ id: "other", rows: [{ inboxId: "a" }, { inboxId: "b" }] }] }), "2 items wait for you.");
});

test("waitsLine adds the tasks being worked on, and says when nothing waits", () => {
  assert.equal(waitsLine({ sections: [], inFlight: [{ goalId: "g" }] }), "1 task is being worked on.");
  assert.equal(waitsLine({ sections: [{ id: "drafts", rows: [{ inboxId: "a" }] }], inFlight: [{}, {}] }),
    "1 draft waits for you. 2 tasks are being worked on.");
  assert.equal(waitsLine({ sections: [{ id: "drafts", rows: [] }] }), "Nothing waits for you.");
  assert.equal(waitsLine({}), "Nothing waits for you.");
  assert.equal(waitsLine({ connected: false, sections: [{ id: "drafts", rows: [{ inboxId: "a" }] }] }), null);
  assert.equal(waitsLine(null), null);
});

test("cardState gives each card its own state", () => {
  assert.equal(cardState({ data: null, error: null, loading: true }), "loading");
  assert.equal(cardState({ data: null, error: new Error("x"), loading: false }), "error");
  assert.equal(cardState({ data: { connected: false, notConnected: { reason: "r" } } }), "off");
  assert.equal(cardState({ data: { connected: true, figures: [] } }), "ready");
  // A quiet refresh that failed keeps the old answer on screen.
  assert.equal(cardState({ data: { connected: true }, error: new Error("x") }), "ready");
  assert.equal(cardState(undefined), "loading");
});

test("the landing reads each card's answer by itself and links to its dashboard", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/dashboards.js", import.meta.url), "utf8");
  assert.match(src, /useResource\(`\/api\/departments\/\$\{encodeURIComponent\(d\.id\)\}`/);
  assert.match(src, /#\/dashboards\/\$\{d\.id\}/);
  assert.match(src, /The figures and records of each department\. They are real: they come from your books\./);
  // No kind line over the title (R9: no eyebrow labels); the title says where you are.
  assert.doesNotMatch(src, /over=/);
  assert.match(src, /title="Dashboards"/);
});

test("each card wears its department's line icon and no creature or department colour (O2, O7)", async () => {
  const { readFileSync } = await import("node:fs");
  const { CARD_FACTS } = await import("../../pages/dashboards.js");
  assert.deepEqual(DASHBOARDS.map((d) => d.icon), ["book", "trend", "buoy", "team", "horn", "film"]);
  assert.equal(CARD_FACTS, 2);
  const src = readFileSync(new URL("../../pages/dashboards.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Creature|data-dept/);
  assert.match(src, /cardFigures\(page, CARD_FACTS\)/);
  const css = readFileSync(new URL("../../styles/pages/dashboards.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--dept\b|--font-serif/);
});

test("dashboards: a card's icon stands in the kit's Tile, in the tint of its department (R5-H)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/dashboards.js", import.meta.url), "utf8");
  assert.match(src, /<\$\{Tile\} icon=\$\{d\.icon\} tint=\$\{tintFor\(d\.dept\)\} size=\$\{32\} \/>/);
});

// ---- Mounted in the shared test DOM with a fake fetch (PLAN-3D-ALL U12). ----
const dom = await import("../kit/_dom.mjs");
const { html, render } = dom;
const { AppContext } = await import("../../lib/context.js");
const shelf = await import("../../pages/dashboards.js");
const fire = (el, type, ev = {}) => { for (const f of el.listeners[type] || []) f.call(el, { type, preventDefault() {}, stopPropagation() {}, ...ev }); };

// Each department's answer as the home server words it, cut to what a card reads.
const ANSWER = {
  books: { id: "books", connected: true, figures: [
    { id: "owed_to_you", label: "You are owed", value: "₹ 1,18,000.00", hint: "1 unpaid invoice" },
    { id: "you_owe", label: "You owe", value: "₹ 9,440.00", hint: "1 unpaid bill" },
    { id: "sales_month", label: "Sales this month", value: "₹ 1,43,000.00", hint: "2 invoices" },
  ], sections: [{ id: "drafts", rows: [{ name: "A", inboxId: "bench:Sales Invoice:A" }] }], inFlight: [] },
  customers: { id: "customers", connected: true, figures: [{ id: "leads_open", label: "Open leads", value: "3" }, { id: "deals_open", label: "Open deals", value: "2" }], sections: [], inFlight: [{ goalId: "g" }] },
  support: { id: "support", connected: false, notConnected: { reason: "The books are switched off.", next: "Open Health to see how to start them." }, figures: [], sections: [] },
  people: { id: "people", connected: true, figures: [], sections: [], inFlight: [] },
  marketing: { id: "marketing", connected: true, figures: [{ id: "drafts", label: "Drafts waiting", value: "2", hint: "Waiting for you" }, { id: "approved", label: "Approved", value: "1" }],
    sections: [{ id: "calendar", rows: [{ inboxId: "content:aaaaaaaaaaaa" }, { inboxId: "content:bbbbbbbbbbbb" }] }], inFlight: [] },
  studio: { id: "studio", connected: true, figures: [{ id: "films", label: "Films", value: "1" }], sections: [], inFlight: [] },
};
const seeded = (over = {}) => (path) => {
  const all = { ...Object.fromEntries(Object.entries(ANSWER).map(([k, v]) => [`/api/departments/${k}`, v])), ...over };
  return Object.hasOwn(all, path) ? all[path] : null;
};

async function mountShelf(answers) {
  dom.installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: "#/dashboards", href: "/#/dashboards", search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    const m = opts.method || "GET";
    calls.push(`${m} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    const data = answers(String(path), m);
    if (data === undefined) return new Promise(() => {});
    return data ? { ok: true, status: 200, json: async () => data }
      : { ok: false, status: 500, json: async () => ({ error: { code: "x", message: "That did not answer.", next: "Try again." } }) };
  };
  const tops = [];
  const nothing = () => {};
  const ctx = { shell: { team: [], dock: [] }, announce: nothing, openNeeds: nothing, setTop: (t) => tops.push(t), settings: { motion: "off", theme: "dark" } };
  const root = new dom.FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${shelf.default} route=${{ id: "dashboards", parts: ["dashboards"], query: new URLSearchParams("") }} /><//>`, root);
  await dom.settle();
  return { root, calls, tops, done: async () => { render(null, root); root.remove(); await dom.settle(50); globalThis.fetch = real; delete globalThis.location; } };
}

test("dashboards: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const answers of [seeded(), seeded({ "/api/departments/people": undefined, "/api/departments/studio": undefined })]) {
    const m = await mountShelf(answers);
    try { seen.push(...m.calls); } finally { await m.done(); }
  }
  // A card that could not be read, then its Try again: only that card reads again.
  const m = await mountShelf(seeded({ "/api/departments/support": null }));
  try {
    const retry = dom.elements(m.root).find((e) => e.localName === "button" && dom.textOf(e).includes("Try again"));
    fire(retry, "Click");
    await dom.settle();
    seen.push(...m.calls);
  } finally { await m.done(); }
  const six = ["books", "customers", "support", "people", "marketing", "studio"].map((d) => `GET /api/departments/${d}`);
  // Recorded on the page before PLAN-3D-ALL U12 changed it.
  const RECORDED = [...six, ...six, ...six, "GET /api/departments/support"];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const { readFileSync: readCss } = await import("node:fs");
const byCls = (root, c) => dom.elements(root).filter((e) => dom.classesOf(e).includes(c));
const textNodes = (root) => [...dom.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

test("dashboards: the title and its line stand in the room header with the building's face; one h1; the cards stay on the ground (PLAN-3D-ALL U12)", async () => {
  const m = await mountShelf(seeded());
  try {
    const band = dom.elements(m.root).filter((e) => e.localName === "header" && dom.classesOf(e).includes("k-room"));
    assert.equal(band.length, 1);
    assert.equal(band[0].getAttribute("data-glimpse"), "facade");
    const h1 = dom.elements(m.root).filter((e) => e.localName === "h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].getAttribute("id"), "page-title");
    assert.ok(textNodes(band[0]).includes("The figures and records of each department. They are real: they come from your books."));
    const img = dom.elements(m.root).filter((e) => e.localName === "img");
    assert.equal(img.length, 1, "one picture: the band's");
    assert.equal(img[0].getAttribute("src"), glimpseSrc("facade", { theme: "dark", width: 1280 }));
    assert.equal(byCls(band[0], "p-dashboards-card").length, 0, "no card in the band");
    assert.ok(!dom.elements(m.root).some((e) => e.getAttribute("data-surface")), "no paper");
  } finally { await m.done(); }
  const css = readCss(new URL("../../styles/pages/dashboards.css", import.meta.url), "utf8");
  assert.match(/\.p-dashboards > \.k-room \{([^}]*)\}/.exec(css)[1], /margin-top: calc\(-1 \* var\(--s-6\)\);/, "the band rises into the pane's top margin (D9)");
});

test("dashboards: a card's figures are the server's, whole: never cut, never made up (PLAN-3D-ALL U12, S1)", async () => {
  const flat = (s) => String(s).replace(/\s+/g, "");
  const m = await mountShelf(seeded());
  try {
    const shown = byCls(m.root, "p-dashboards-value").map((e) => flat(dom.textOf(e)));
    const sent = Object.values(ANSWER).flatMap((a) => a.figures.slice(0, 2).map((f) => flat(f.value)));
    assert.deepEqual(shown, sent);
    assert.ok(textNodes(m.root).includes("The books are switched off."), "a card that cannot read its records says why, as sent");
  } finally { await m.done(); }
  const css = readCss(new URL("../../styles/pages/dashboards.css", import.meta.url), "utf8");
  // The quiet look cut a long figure with an ellipsis; a figure is now shown whole (PLAN-3D-ALL U12).
  assert.doesNotMatch(css, /text-overflow|line-clamp|overflow: hidden/);
  assert.match(/\.p-dashboards \.p-dashboards-value \{([^}]*)\}/.exec(css)[1], /font-size: var\(--fs-stat\);[\s\S]*font-variant-numeric: tabular-nums;/);
});

test("dashboards: hostile server text stays text (PLAN-3D-ALL)", async () => {
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => dom.elements(root).filter((e) => e.localName === t).length);
  const poison = (v, k = 0) => {
    if (Array.isArray(v)) return v.map((x, i) => poison(x, k + i));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, x], i) => [kk, ["id", "inboxId", "connected"].includes(kk) ? x : poison(x, k + i)]));
    return typeof v === "string" ? bad(k) : v;
  };
  const s = await mountShelf(seeded());
  let base;
  try { base = tags(s.root); } finally { await s.done(); }
  const m = await mountShelf(seeded(Object.fromEntries(Object.entries(ANSWER).map(([k, v]) => [`/api/departments/${k}`, poison(v)]))));
  try {
    assert.deepEqual(tags(m.root), base);
    for (const e of dom.elements(m.root)) {
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
      for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
      if (e.localName === "img") assert.ok(GLIMPSES.some((k) => glimpseSrc(k, { theme: "dark", width: 1280 }) === e.getAttribute("src")));
    }
    assert.ok(textNodes(m.root).some((t) => HOSTILE.some((h) => t.startsWith(h.slice(0, 20)))), "hostile words shown as text");
  } finally { await m.done(); }
});
