// The studio's mapping from data to what is shown (PLAN-3D T3, D8, D9): the lamp and door rules, the summary, the
// stack, the words, worldState over every fixture, and sceneOf, which must never carry server text into the world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD = join(HERE, "..", "..", "world");
const load = (f) => import(pathToFileURL(join(WORLD, f)).href);
const { lampOf, doorStateOf, summaryLine, stackOf, worldState, sceneOf, cut, LAMPS, DOOR_STATES } = await load("state.js");
const { WORDS, doorSettingsHref } = await load("words.js");
const F = await load("fixtures.js");

const ID = /^[a-z][a-z0-9-]{0,40}$/;
const SCENE_ENUMS = new Set([...LAMPS, ...DOOR_STATES]);
const WRONG = [null, undefined, 0, 1, "x", true, [], {}, () => 1, NaN];

// Every string anywhere in a value.
function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const sceneString = (s) => SCENE_ENUMS.has(s) || ID.test(s) || /^agent:[a-z][a-z0-9-]{0,40}$/.test(s) || /^door:[a-z][a-z0-9-]{0,40}$/.test(s);

// ---- lampOf ----

test("lampOf: the first match wins, as D8 says", () => {
  assert.equal(lampOf({ state: "working" }), "on");
  assert.equal(lampOf({ state: "working", waitingForYou: true }), "amber");
  assert.equal(lampOf({ state: "waiting_for_you" }), "amber");
  assert.equal(lampOf({ state: "problem", waitingForYou: true }), "red");
  assert.equal(lampOf({ state: "paused", waitingForYou: true }), "down");
  assert.equal(lampOf({ state: "free" }), "off");
  assert.equal(lampOf({ state: "x" }), "off");
  assert.equal(lampOf({}), "off");
  assert.equal(lampOf(null), "off");
});

test("lampOf: anything that is not an agent is off, without a throw", () => {
  for (const v of WRONG) assert.equal(lampOf(v), "off");
  assert.equal(lampOf({ state: "working", waitingForYou: "yes" }), "on", "only a real true waits");
});

// ---- doorStateOf (one argument: there is no spending state, revision R1) ----

test("doorStateOf: on is open, off is shut, off and blocked is blocked", () => {
  assert.equal(doorStateOf({ on: true, blocked: false }), "open");
  assert.equal(doorStateOf({ on: false, blocked: false }), "shut");
  assert.equal(doorStateOf({ on: false, blocked: true }), "blocked");
  assert.equal(doorStateOf({ on: true, blocked: true }), "open");
  assert.equal(doorStateOf(null), "shut");
  assert.equal(doorStateOf({}), "shut");
  for (const v of WRONG) assert.ok(DOOR_STATES.includes(doorStateOf(v)));
  assert.equal(doorStateOf.length, 1, "one argument");
});

// ---- summaryLine, stackOf ----

test("summaryLine: the pinned sentences", () => {
  assert.equal(summaryLine({ agents: 12, rooms: 7, working: 6, needsYou: 3 }), "12 agents in 7 rooms. 6 working, 3 need you.");
  assert.equal(summaryLine({ agents: 1, rooms: 1, working: 1, needsYou: 1 }), "1 agent in 1 room. 1 working, 1 needs you.");
  assert.equal(summaryLine({ agents: 3, rooms: 2, working: 0, needsYou: 0 }), "3 agents in 2 rooms. Nobody is working, nothing needs you.");
  assert.equal(summaryLine({ agents: 0, rooms: 7, working: 0, needsYou: 0 }), "No agents yet.");
  assert.equal(summaryLine({ agents: 0, rooms: 0, working: 0, needsYou: 0 }), "");
});

test("summaryLine: wrong input is the empty line", () => {
  for (const v of WRONG) assert.equal(typeof summaryLine(v), "string");
  assert.equal(summaryLine(null), "");
  assert.equal(summaryLine({ agents: "12", rooms: 7 }), "No agents yet.");
});

test("stackOf: at most twelve sheets, the rest counted", () => {
  assert.deepEqual(stackOf([]), { sheets: 0, more: 0 });
  assert.deepEqual(stackOf(new Array(7).fill({})), { sheets: 7, more: 0 });
  assert.deepEqual(stackOf(new Array(40).fill({})), { sheets: 12, more: 28 });
  assert.deepEqual(stackOf(40), { sheets: 12, more: 28 });
  for (const v of [null, undefined, "x", {}, -3, NaN]) assert.deepEqual(stackOf(v), { sheets: 0, more: 0 });
});

test("cut: one line, at most n characters, an ellipsis when cut", () => {
  assert.equal(cut("  a   b  ", 24), "a b");
  assert.equal(cut("x".repeat(30), 24), `${"x".repeat(23)}…`);
  assert.equal(cut(null, 10), "");
  assert.equal(cut({}, 10), "");
});

// ---- words ----

test("the two pages' new words are pinned", () => {
  assert.deepEqual(Object.values(WORDS), [
    "Lighting the studio", "Lighting the desk", "Who is here", "Switch off", "Switch on", "Stop this task",
    "Open in Settings", "Open this door", "Shut this door", "Yes, open this door", "Cancel", "App Studio", "Doors",
    "Waiting", "Keys: J and K move, Enter the story so far, A and D go to the buttons.",
  ]);
  assert.ok(Object.isFrozen(WORDS));
  assert.ok(!Object.values(WORDS).some((w) => /spending/i.test(w)), "no Stop or Allow spending (revision R1)");
});

test("doorSettingsHref gives the addresses of Settings' own sections", () => {
  assert.equal(doorSettingsHref("web"), "#/settings?s=web");
  assert.equal(doorSettingsHref("generation"), "#/settings?s=generation");
  assert.equal(doorSettingsHref("higgsfield"), "#/settings?s=generation");
  for (const v of ["viewer", "models", "../x", "", null, undefined, 3, {}, "__proto__", "constructor"]) assert.equal(doorSettingsHref(v), "#/settings");
  // The same addresses as pages/settings.js sectionHref: the section ids exist and the address is built the same way.
  const settings = readFileSync(join(HERE, "..", "..", "pages", "settings.js"), "utf8");
  assert.match(settings, /\{ id: "web",/);
  assert.match(settings, /\{ id: "generation",/);
  assert.match(settings, /`#\/settings\?s=\$\{id\}`/);
});

// ---- worldState ----

test("worldState: the seed, in the server's order, with the queue's agents amber", () => {
  const ws = worldState(F.seed);
  assert.deepEqual(ws.rooms.map((r) => r.id), ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
  assert.equal(ws.rooms.flatMap((r) => r.agents).length, 12);
  assert.equal(ws.summary, "12 agents in 7 rooms. 6 working, 3 need you.");
  assert.deepEqual(ws.counts, { agents: 12, rooms: 7, working: 6, needsYou: 3, queue: 3 });
  const lamp = (slug) => ws.rooms.flatMap((r) => r.agents).find((a) => a.slug === slug).lamp;
  assert.equal(lamp("builder"), "red");
  assert.equal(lamp("artist"), "amber");
  assert.equal(lamp("bookkeeper"), "amber");
  assert.equal(lamp("researcher"), "down");
  assert.equal(lamp("drafter"), "off");
  assert.equal(lamp("checker"), "on");
  assert.deepEqual(ws.stack, { sheets: 3, more: 0 });
  assert.deepEqual(ws.doors.map((d) => [d.id, d.state, d.href]), [
    ["web", "open", "#/settings?s=web"], ["generation", "open", "#/settings?s=generation"], ["higgsfield", "open", "#/settings?s=generation"],
  ]);
  assert.equal(ws.money.line, "$3.40 of $10.00 spent today.");
  assert.deepEqual(ws.money.today, { spent: 340, limit: 1000 });
  assert.equal(ws.rooms[0].href, "#/map/operations");
  assert.equal(ws.rooms[0].agents[0].plainState, "Working", "the server's word, unchanged");
});

test("worldState: a queue item makes its agent amber and gives it a tag", () => {
  const input = { world: { rooms: [{ id: "sales", agents: [{ slug: "sales", name: "Sales", state: "working" }] }] }, inbox: { items: [{ agent: { slug: "sales" } }] } };
  const a = worldState(input).rooms[0].agents[0];
  assert.equal(a.lamp, "amber");
  assert.equal(a.needsYou, true);
  assert.equal(a.tag, "Sales");
  const viaHome = worldState({ world: input.world, home: { needsYou: { total: 1, items: [{ agent: { slug: "sales" } }] } } });
  assert.equal(viaHome.rooms[0].agents[0].lamp, "amber");
  assert.equal(viaHome.counts.queue, 1);
});

test("worldState: an agent in no room is dropped, and one agent sits at one desk only", () => {
  const ws = worldState({
    world: { rooms: [
      { id: "sales", agents: [{ slug: "sales", state: "working" }, { slug: "sales", state: "free" }, { slug: "BAD slug" }] },
      { id: "books", agents: [{ slug: "sales", state: "free" }] },
    ] },
    inbox: { items: [{ agent: { slug: "ghost", name: "Ghost" } }] },
  });
  const slugs = ws.rooms.flatMap((r) => r.agents.map((a) => a.slug));
  assert.deepEqual(slugs, ["sales"]);
  assert.ok(!JSON.stringify(ws).includes("ghost"));
  assert.ok(!JSON.stringify(ws).includes("Ghost"));
  assert.equal(ws.rooms[1].agents.length, 0);
});

test("worldState: for big, names are cut to 80 and tags to 24 with an ellipsis; the list keeps the full name", () => {
  const ws = worldState(F.big);
  const agents = ws.rooms.flatMap((r) => r.agents);
  assert.equal(ws.rooms.length, 12, "the list holds every department");
  assert.equal(ws.overflow.length, 1, "one is list-only, and the state says which");
  assert.equal(ws.rooms[11].inPlan, false);
  assert.equal(ws.rooms[0].agents.length, 13, "all thirteen in the list");
  assert.equal(ws.rooms[0].more, 7);
  for (const a of agents) {
    assert.equal(a.name.length, 60, "a 60-character name is kept whole for the list");
    assert.equal(a.tag.length, 24);
    assert.ok(a.tag.endsWith("…"));
    assert.ok(a.name.startsWith(a.tag.slice(0, -1).trimEnd()));
  }
  for (const r of ws.rooms) assert.ok(r.title.length <= 80);
  const long = worldState({ world: { rooms: [{ id: "a", title: "T".repeat(500), agents: [{ slug: "b", name: "N".repeat(500) }] }] } });
  assert.equal(long.rooms[0].title.length, 80);
  assert.equal(long.rooms[0].agents[0].name.length, 80);
  assert.ok(long.rooms[0].agents[0].name.endsWith("…"));
});

test("worldState: for empty everything is empty arrays and the summary is empty", () => {
  const ws = worldState(F.empty);
  assert.deepEqual(ws.rooms, []);
  assert.deepEqual(ws.doors, []);
  assert.deepEqual(ws.apps, []);
  assert.deepEqual(ws.overflow, []);
  assert.equal(ws.summary, "");
  assert.equal(ws.plan.empty, true);
  assert.equal(ws.scene.dark, true);
  assert.deepEqual(ws.scene.rooms, []);
  assert.ok(ws.boardOff && ws.boardOff.reason);
});

test("worldState: allOff has no lamp lit, every door shut, every app dark", () => {
  const ws = worldState(F.allOff);
  for (const a of ws.rooms.flatMap((r) => r.agents)) assert.ok(a.lamp === "off" || a.lamp === "down", a.slug);
  assert.deepEqual(ws.scene.doors.map((d) => d.state), ["shut", "shut", "shut"]);
  assert.ok(ws.scene.apps.every((a) => !a.on && !a.allowance));
  assert.equal(ws.summary, "12 agents in 7 rooms. Nobody is working, nothing needs you.");
});

test("worldState: the door and app fixtures", () => {
  assert.deepEqual(worldState(F.doorOff).scene.doors.map((d) => d.state), ["shut", "open", "open"]);
  assert.deepEqual(worldState(F.doorBlocked).scene.doors.map((d) => d.state), ["open", "blocked", "open"]);
  const ws = worldState(F.app);
  assert.deepEqual(ws.scene.apps, [{ id: "lake-house-site", on: true, allowance: true }]);
  assert.equal(ws.apps[0].href, "#/apps/lake-house-site");
  assert.equal(ws.apps[0].spending.words, "Allowed today: $5.00. Spent: $1.20.", "as sent");
  const one = worldState(F.one);
  assert.equal(one.summary, "1 agent in 1 room. 1 working, nothing needs you.");
  assert.deepEqual(one.plan.floors, [["operations"]]);
});

test("worldState: money and safety sentences are kept whole, never cut", () => {
  const long = "S".repeat(3000);
  const ws = worldState({ world: {
    doors: [{ id: "web", on: true, sentence: long }],
    apps: [{ slug: "a", on: true, sentence: long, spending: { open: true, words: long } }],
    money: { ok: true, line: long }, studio: { state: "on", sentence: long },
  } });
  assert.equal(ws.doors[0].sentence, long);
  assert.equal(ws.apps[0].sentence, long);
  assert.equal(ws.apps[0].spending.words, long);
  assert.equal(ws.money.line, long);
  assert.equal(ws.studio.sentence, long);
});

test("worldState: the map's departments stand in when the world was not read", () => {
  const ws = worldState({ map: { departments: [{ id: "sales", title: "Sales", agents: [{ slug: "sales", name: "Sales" }] }], brain: { asking: { id: "q" } } } });
  assert.deepEqual(ws.rooms.map((r) => r.id), ["sales"]);
  assert.equal(ws.rooms[0].agents[0].lamp, "off");
  assert.equal(ws.asking, true);
  assert.equal(ws.scene.asking, true);
});

test("worldState: wrong input never throws and gives an empty, dark studio", () => {
  for (const v of [...WRONG, { world: "x", map: 3, home: [], inbox: null }, { world: { rooms: "x", doors: {}, apps: 7, money: [] } }]) {
    const ws = worldState(v);
    assert.deepEqual(ws.rooms, []);
    assert.equal(ws.summary, "");
    assert.equal(ws.scene.dark, true);
  }
  const odd = worldState({ world: { rooms: [null, 3, "x", { id: 5 }, { id: "ok", agents: [null, 4, { slug: 1 }, "free-agent"], counts: { working: -4, jobs: 1e12 } }] } });
  assert.deepEqual(odd.rooms.map((r) => r.id), ["ok"]);
  assert.deepEqual(odd.rooms[0].agents.map((a) => a.slug), ["free-agent"]);
  assert.deepEqual(odd.rooms[0].counts, { working: 0, needsYou: 0, jobs: 9999 });
});

// ---- sceneOf ----

test("sceneOf: for every fixture, only slugs, anchors and enums are strings", () => {
  for (const name of F.FIXTURE_NAMES) {
    const scene = worldState(F.fixtures[name]).scene;
    for (const s of strings(scene)) assert.ok(sceneString(s), `${name}: "${s.slice(0, 40)}" is not an id or an enum`);
    assert.deepEqual(sceneOf(worldState(F.fixtures[name])), scene, `${name}: the same answer twice`);
  }
});

test("sceneOf: the hostile fixture leaves none of its text in the scene, and the bad id is gone", () => {
  const ws = worldState(F.hostile);
  const text = strings(ws.scene);
  for (const h of F.HOSTILE) {
    assert.ok(!text.some((s) => s.includes(h) || (h.length > 8 && h.includes(s) && s.length > 8)), `the scene holds no "${h.slice(0, 20)}"`);
  }
  assert.ok(!JSON.stringify(ws.scene).includes(F.HOSTILE_ID));
  assert.ok(!JSON.stringify(ws.scene).includes(".."));
  assert.ok(!ws.rooms.some((r) => r.id === F.HOSTILE_ID), "the list drops it too: its id would be an address");
  assert.ok(!ws.apps.some((a) => a.slug === F.HOSTILE_ID));
  for (const r of ws.rooms) for (const a of r.agents) assert.ok(a.name.length <= 80 && a.tag.length <= 24);
  const longName = ws.rooms.flatMap((r) => r.agents).find((a) => a.name.startsWith("LLLL"));
  assert.equal(longName.name.length, 80, "the 5,000-character name is cut to its cap");
  for (const href of [...ws.rooms.map((r) => r.href), ...ws.apps.map((a) => a.href), ...ws.doors.map((d) => d.href)]) {
    assert.match(href, /^#\/(map|apps)\/[a-z][a-z0-9-]{0,40}$|^#\/settings(\?s=[a-z]+)?$/);
  }
  assert.equal(ws.money.line, F.HOSTILE[0], "the hostile line is kept as text, whole; the page shows it as a text node");
});

test("sceneOf: checks a hand-made state again and takes wrong input", () => {
  const scene = sceneOf({
    rooms: [{ id: "a", agents: [{ slug: "b", lamp: "<b>" }, { slug: "../c", lamp: "on" }] }, { id: "A b", agents: [] }],
    doors: [{ id: "web", state: "ajar" }, { id: "generation", state: "open" }],
    apps: [{ slug: "x", on: "yes", spending: { open: 1 } }, { slug: "bad slug" }],
    stack: { sheets: 400, more: -2 }, boardOff: null, asking: "yes",
  });
  assert.deepEqual(scene.rooms, [{ id: "a", dim: false, working: 0, needsYou: 0, more: 0, lamps: [{ id: "agent:b", lamp: "off" }] }]);
  assert.deepEqual(scene.doors, [{ id: "door:web", state: "shut" }, { id: "door:generation", state: "open" }, { id: "door:higgsfield", state: "shut" }]);
  assert.deepEqual(scene.apps, [{ id: "x", on: false, allowance: false }]);
  assert.deepEqual(scene.stack, { sheets: 12, more: 0 });
  assert.equal(scene.asking, false);
  for (const v of WRONG) assert.equal(sceneOf(v).dark, true);
});

test("sceneOf: at most four app benches, a room with no agents is dim", () => {
  const apps = Array.from({ length: 6 }, (_, i) => ({ slug: `app-${i}`, on: true }));
  const ws = worldState({ world: { rooms: [{ id: "empty-room", agents: [] }], apps } });
  assert.equal(ws.apps.length, 6, "all in the list");
  assert.equal(ws.scene.apps.length, 4);
  assert.equal(ws.scene.rooms[0].dim, true);
});

// ---- the sources ----

test("the world's pure modules import only each other and use no page, clock or randomness", () => {
  for (const f of ["state.js", "layout.js", "diff.js", "tags.js", "words.js", "fixtures.js"]) {
    const src = readFileSync(join(WORLD, f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.doesNotMatch(code, /\bdocument\b|\bwindow\b|Math\.random|Date\.now|new Date\b|\binnerHTML\b|\beval\(|new Function/, f);
    for (const m of code.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(/g)) {
      assert.ok(m[1] && /^\.\/(state|layout|diff|tags|words|fixtures)\.js$/.test(m[1]), `${f} imports ${m[0]}`);
    }
  }
});
