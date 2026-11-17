// The Map as the lit studio (PLAN-3D T9), mounted in the test DOM with a fake fetch. There is no WebGL2 here, so the
// stage keeps its drawn studio (the fallback path). The mirrored list follows the fixture; the server's words are
// whole text nodes; Switch off and Stop this task ask once and post what they always posted; the list twin loads no
// studio; every fixture draws; the hostile fixture stays text; every word the old page offered is still offered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, classesOf, textOf, walkDom } from "../kit/_dom.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (f) => import(pathToFileURL(join(PUBLIC, f)).href);
const page = await load("pages/map.js");
const Page = page.default;
const { AppContext } = await load("lib/context.js");
const F = await load("world/fixtures.js");
const { WORDS: W } = await load("world/words.js");

Object.defineProperty(FakeElement.prototype, "innerHTML", { set(v) { throw new Error(`innerHTML was set: ${v}`); }, configurable: true });

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName}.${classesOf(el).join(".")} listens for ${type}`);
  for (const f of el.listeners[key]) f.call(el, { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra });
}
const byWords = (root, words) => elements(root).filter((e) => (e.localName === "button" || e.localName === "a") && textOf(e).trim() === words);
const withClass = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
const onlyText = (el) => (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.childNodes[0].data : null);

// The answers of /api/map and /api/home that go with a fixture's /api/world, in today's shapes.
const mapOf = (world) => ({
  company: world.company, boardOff: world.boardOff, counts: { running: 2, needsYou: 3 }, brain: { files: 12, basics: { filled: 4, total: 9 }, asking: null },
  departments: world.rooms.map((r) => ({ id: r.id, title: r.title, line: r.line, counts: r.counts, agents: r.agents.map((a) => ({ slug: a.slug, name: a.name })), clusters: [] })),
});
const homeOf = (fx) => ({
  needsYou: { total: fx.inbox.items.length, items: fx.inbox.items },
  running: fx.world.rooms.flatMap((r) => r.agents.filter((a) => a.state === "working" && a.doing)
    .map((a) => ({ taskId: `t-${a.slug}`, identifier: `STH-${a.slug.length}`, title: a.doing.title, who: { slug: a.slug, name: a.name }, live: true }))),
});

async function mountMap(fx, { parts = ["map"], query = "", narrow = false, post } = {}) {
  installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: `#/${parts.join("/")}`, search: "", replace(h) { this.hash = h; } };
  globalThis.matchMedia = narrow ? () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) : undefined;
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push({ path, method: opts.method, body: opts.body === undefined ? undefined : JSON.parse(opts.body) });
    let a = { status: 200, body: {} };
    if (opts.method === "POST") a = post ? post(path) : { status: 200, body: { ok: true } };
    else if (path === "/api/world") a = { status: 200, body: fx.world };
    else if (path === "/api/map") a = { status: 200, body: mapOf(fx.world) };
    else if (path === "/api/home") a = { status: 200, body: homeOf(fx) };
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  const tops = [];
  const said = [];
  const ctx = { shell: null, announce: (s) => said.push(s), setTop: (t) => tops.push(t), openNeeds() {}, openComposer() {}, refreshShell() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${Page} route=${{ id: "map", parts, query: new URLSearchParams(query) }} /><//>`, root);
  await settle();
  return {
    root, calls, tops, said,
    posts: () => calls.filter((c) => c.method === "POST"),
    done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.matchMedia; },
  };
}

test("the studio's own words are pinned", () => {
  assert.deepEqual({ ...page.STUDIO_WORDS }, {
    rooms: "Rooms and who is in them", overflow: "Only in this list: the studio has room for eleven.", nobody: "Nobody works here yet.",
    doorOpen: "Open", doorShut: "Shut", appOpen: "Open", tasks: "Tasks", answer: "Answer", openTask: "Open the task", close: "Close",
    switchOffAsk: "Switch it off? It stops what it is working on now.", switchOffYes: "Yes, switch it off",
    switchedOff: "It is switched off.", switchedOn: "It is switched on.",
    stopAsk: "Stop this task? Agents stop working on it.", stopYes: "Yes, stop it",
    stopped: "The task is stopped. Agents will not work on it any more.", skip: "Skip the map, show it as a list",
  });
  assert.ok(Object.isFrozen(page.STUDIO_WORDS));
  for (const w of Object.values(page.STUDIO_WORDS)) assert.doesNotMatch(w, /—/, "no em dash");
});

test("the free rectangle: right of the rail, left of the panel, above the foot", () => {
  const stage = { left: 100, top: 48, width: 1180, height: 852 };
  assert.deepEqual(page.safeRectOf(stage, { rail: { right: 440 }, side: { left: 872 }, foot: { top: 800 } }), { x: 340, y: 0, w: 432, h: 752 });
  assert.deepEqual(page.safeRectOf(stage, {}), { x: 0, y: 0, w: 1180, h: 852 });
  assert.equal(page.safeRectOf(null), null);
  assert.equal(page.safeRectOf({ left: 0, top: 0, width: 0, height: 10 }), null);
});

test("the list mirrors the seed: seven rooms, twelve agents, three doors; App Studio's app in `app`", async () => {
  const m = await mountMap(F.seed);
  try {
    assert.ok(withClass(m.root, "w-stage").length === 1, "the studio is drawn");
    assert.equal(withClass(m.root, "w-stage")[0].getAttribute("data-world"), "fallback");
    const list = elements(m.root).find((e) => e.localName === "ul" && e.getAttribute("aria-label") === page.STUDIO_WORDS.rooms);
    assert.equal(list.getAttribute("role"), "list");
    const secs = withClass(m.root, "p-map__room-sec");
    assert.deepEqual(secs.map((s) => s.getAttribute("data-section")), ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
    const heads = withClass(m.root, "p-map__room");
    assert.deepEqual(heads.map((h) => [h.getAttribute("data-node"), h.getAttribute("href")]), secs.map((s) => [s.getAttribute("data-section"), `#/map/${s.getAttribute("data-section")}`]));
    assert.equal(withClass(m.root, "p-map__agent").length, 12);
    assert.deepEqual(withClass(m.root, "p-map__door").map((d) => d.getAttribute("data-door")), ["web", "generation", "higgsfield"]);
    assert.ok(textNodes(m.root).includes("Postcards"));
  } finally { m.done(); }
  const a = await mountMap(F.app);
  try {
    const apps = withClass(a.root, "p-map__app");
    assert.equal(apps.length, 1);
    assert.ok(textOf(apps[0]).includes("Lake House site"));
    assert.equal(byWords(apps[0], page.STUDIO_WORDS.appOpen)[0].getAttribute("href"), "#/apps/lake-house-site");
    // The Map offers no Turn on and no allowance for an app (ADR 0016).
    assert.doesNotMatch(textOf(a.root), /Turn on|Allow spending|Stop spending/);
  } finally { a.done(); }
});

test("each agent row's state is the server's plainState, whole; doors' and apps' sentences are whole text nodes", async () => {
  const m = await mountMap(F.app);
  try {
    const want = F.app.world.rooms.flatMap((r) => r.agents.map((a) => a.plainState));
    const got = withClass(m.root, "p-map__agent-state").map(onlyText);
    assert.deepEqual(got, want);
    const lines = withClass(m.root, "p-map__door-line").map(onlyText);
    assert.deepEqual(lines, F.app.world.doors.map((d) => d.sentence));
    const app = F.app.world.apps[0];
    const appLines = withClass(m.root, "p-map__app-line").map(onlyText);
    assert.deepEqual(appLines, [app.sentence, app.spending.words]);
  } finally { m.done(); }
});

// PLAN-3D-ALL U17: the lamp and the words agree. An agent with something in the queue is amber while the server's
// state reads "Free" or "Working"; its row keeps the server's words whole and says "Waiting for you" too.
test("an amber lamp's row says Waiting for you when the server's state words do not; no other row does", async () => {
  const fx = { ...F.seed, world: { ...F.seed.world, rooms: F.seed.world.rooms.map((r, i) => (i === 0
    ? { ...r, agents: r.agents.map((a, j) => (j === 0 ? { ...a, state: "free", plainState: "Free", waitingForYou: true } : { ...a, waitingForYou: false })) }
    : r)) } };
  const m = await mountMap(fx);
  try {
    const rows = withClass(m.root, "p-map__agent");
    assert.ok(rows.length > 1);
    let amber = 0;
    for (const row of rows) {
      const lamp = withClass(row, "p-map__lamp")[0];
      const words = withClass(row, "p-map__agent-state").map(onlyText)[0] || "";
      const wait = withClass(row, "p-map__agent-wait").map(onlyText);
      if (classesOf(lamp).includes("p-map__lamp--amber") && !/wait/i.test(words)) { amber++; assert.deepEqual(wait, ["Waiting for you"]); }
      else assert.deepEqual(wait, [], "only an amber lamp whose words say otherwise");
    }
    assert.ok(amber >= 1, "the queued agent is amber and says so");
  } finally { m.done(); }
});

test("the money line goes to the top bar whole; under 860 px it is also the page's own line, whole", async () => {
  const m = await mountMap(F.seed);
  try {
    assert.ok(m.tops.some((t) => t && t.note === "$3.40 of $10.00 spent today."));
  } finally { m.done(); }
  const n = await mountMap(F.doorOff, { narrow: true });
  try {
    const money = withClass(n.root, "p-map__money");
    assert.equal(money.length, 1);
    assert.equal(onlyText(money[0]), "$3.40 of $10.00 spent today.");
    // The doors' rows are on the phone too, their sentences whole.
    assert.deepEqual(withClass(n.root, "p-map__door-line").map(onlyText), F.doorOff.world.doors.map((d) => d.sentence));
    assert.ok(withClass(n.root, "p-map__phone-stage").length === 1, "the studio's picture above the rows");
  } finally { n.done(); }
});

test("Switch off on a working agent asks once, then posts {} to /api/company/agents/<id>/pause; Switch on resumes", async () => {
  const m = await mountMap(F.seed, { parts: ["map", "operations"] });
  try {
    assert.ok(textNodes(m.root).includes(W.whoIsHere));
    const rows = withClass(m.root, "p-map__who-row");
    assert.equal(rows.length, 4);
    const chief = rows.find((r) => textOf(r).includes("Chief of staff"));
    fire(byWords(chief, W.switchOff)[0], "click");
    await settle(150);
    assert.equal(m.posts().length, 0, "asks first");
    assert.ok(textNodes(m.root).includes(page.STUDIO_WORDS.switchOffAsk));
    fire(byWords(m.root, page.STUDIO_WORDS.switchOffYes)[0], "click");
    await settle();
    assert.deepEqual(m.posts().map((c) => [c.path, c.body]), [["/api/company/agents/agent-chief-of-staff/pause", {}]]);
    assert.ok(m.said.includes(page.STUDIO_WORDS.switchedOff));
  } finally { m.done(); }
  const n = await mountMap(F.seed, { parts: ["map", "marketing"] });
  try {
    const researcher = withClass(n.root, "p-map__who-row").find((r) => textOf(r).includes("Researcher"));
    fire(byWords(researcher, W.switchOn)[0], "click");
    await settle();
    assert.deepEqual(n.posts().map((c) => [c.path, c.body]), [["/api/company/agents/agent-researcher/resume", {}]]);
  } finally { n.done(); }
});

test("Stop this task asks once, then posts {} to /api/goals/<id>/stop; Answer goes to the item in the queue", async () => {
  const m = await mountMap(F.seed, { parts: ["map", "operations"] });
  try {
    const stops = byWords(m.root, W.stopTask);
    assert.ok(stops.length >= 1);
    fire(stops[0], "click");
    await settle(150);
    assert.equal(m.posts().length, 0);
    assert.ok(textNodes(m.root).includes(page.STUDIO_WORDS.stopAsk));
    fire(byWords(m.root, page.STUDIO_WORDS.stopYes)[0], "click");
    await settle();
    const posts = m.posts();
    assert.equal(posts.length, 1);
    assert.match(posts[0].path, /^\/api\/goals\/t-[a-z-]+\/stop$/);
    assert.deepEqual(posts[0].body, {});
    const answer = byWords(m.root, page.STUDIO_WORDS.answer);
    assert.ok(answer.length >= 1, "an item that waits offers Answer");
    assert.match(answer[0].getAttribute("href"), /^#\/needs-you/);
    assert.ok(byWords(m.root, page.STUDIO_WORDS.openTask).length >= 1);
    assert.equal(byWords(m.root, "Open the department")[0].getAttribute("href"), "#/departments/operations");
  } finally { m.done(); }
});

test("?view=list draws no studio and reads no /api/world", async () => {
  const m = await mountMap(F.seed, { query: "view=list" });
  try {
    assert.equal(withClass(m.root, "w-stage").length, 0);
    assert.ok(!m.calls.some((c) => c.path === "/api/world"));
  } finally { m.done(); }
});

test("empty, allOff, big and hostile draw, wide and narrow, with a room open", async () => {
  for (const name of ["empty", "allOff", "big", "hostile", "doorBlocked", "one"]) {
    for (const narrow of [false, true]) {
      const fx = F[name];
      const first = fx.world.rooms[0];
      for (const parts of [["map"], ...(first ? [["map", first.id]] : [])]) {
        const m = await mountMap(fx, { narrow, parts });
        try {
          assert.equal(withClass(m.root, "w-stage").length, 1, `${name} ${narrow} ${parts.join("/")}`);
        } finally { m.done(); }
      }
    }
  }
  const big = await mountMap(F.big);
  try {
    assert.equal(withClass(big.root, "p-map__room-sec").length, 12, "every department is in the list");
    assert.equal(withClass(big.root, "p-map__room-note").length, 1, "the twelfth says it is only in the list");
  } finally { big.done(); }
});

test("hostile: no script, img, iframe or object beyond the seed's, no on* attribute, no fixture text in href, src or style", async () => {
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => elements(root).filter((e) => e.localName === t).length);
  const s = await mountMap(F.seed);
  let base;
  try { base = tags(s.root); } finally { s.done(); }
  for (const parts of [["map"], ["map", "h-room-0"]]) {
    for (const narrow of [false, true]) {
      const m = await mountMap(F.hostile, { parts, narrow });
      try {
        assert.deepEqual(tags(m.root), base);
        for (const e of elements(m.root)) {
          for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
          for (const h of F.HOSTILE) {
            for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
          }
          assert.ok(!String(e.getAttribute("data-node") || "").includes(".."), "the bad id is dropped");
        }
        const nodes = textNodes(m.root);
        // Money and safety sentences whole, as text.
        assert.ok(nodes.includes(F.hostile.world.money.line) || narrow === false, "the money line is a text node on a phone");
        for (const d of F.hostile.world.doors) assert.ok(nodes.includes(d.sentence), "a door's sentence, whole, as text");
      } finally { m.done(); }
    }
  }
});

test("every word the old page offered is still offered where its state applies (MAP_WORDS)", async () => {
  const seen = new Set();
  const collect = (root) => {
    for (const n of walkDom(root)) {
      if (n.nodeType === 3) seen.add(n.data.trim());
      else if (n.nodeType === 1) for (const k of ["aria-label", "title"]) if (n.getAttribute(k)) seen.add(n.getAttribute(k));
    }
  };
  for (const [fx, opts] of [[F.seed, {}], [F.seed, { parts: ["map", "operations"] }], [F.allOff, {}], [F.allOff, { parts: ["map", "people"] }], [F.empty, {}], [F.seed, { query: "ask=e0000000-0000-4000-8000-000000000019" }]]) {
    const m = await mountMap(fx, opts);
    try { collect(m.root); } finally { m.done(); }
  }
  // "Agents" and "No agents yet." were the old rail's block of a department's agents; "Who is here" replaces it (D13).
  // "The whole company" and "Department" were the old stage layout's kind lines; the stage's label is still "Company map".
  const replaced = new Set(["agents", "noAgents", "company", "department"]);
  for (const [k, w] of Object.entries(page.MAP_WORDS)) {
    if (replaced.has(k)) continue;
    assert.ok([...seen].some((t) => t === w || t.startsWith(w)), `${k}: "${w}"`);
  }
});
